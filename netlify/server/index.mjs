// "Ask my CV" — a small streaming API grounded in data/cv.json.
// Runs as a Netlify Server on /api/* only; Hugo's static site serves everything else.
import Anthropic from '@anthropic-ai/sdk'
import { buildSystemPrompt } from './prompt.mjs'

export const config = { path: '/api/*' }

const anthropic = new Anthropic()
const MODEL = 'claude-haiku-5-5'
const SYSTEM = buildSystemPrompt()

const MAX_MESSAGES = 10
const MAX_CHARS = 6000

// Best-effort, per-instance throttle so a single visitor can't burn through AI credits.
// It resets on cold starts; that is fine for a soft guard.
const WINDOW_MS = 10 * 60 * 1000
const LIMIT = 25
const hits = new Map()
function throttled(ip) {
  const now = Date.now()
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS)
  recent.push(now)
  hits.set(ip, recent)
  if (hits.size > 5000) hits.clear()
  return recent.length > LIMIT
}

function allowedOrigin(req) {
  const origin = req.headers.get('origin')
  if (!origin) return false
  try {
    const o = new URL(origin).hostname
    const self = new URL(req.url).hostname
    return o === self || o === 'allanrey.es' || o === 'localhost' || o.endsWith('--allanreyes.netlify.app') || o === 'allanreyes.netlify.app'
  } catch {
    return false
  }
}

function cleanMessages(input) {
  if (!Array.isArray(input)) return null
  const out = []
  for (const m of input.slice(-MAX_MESSAGES)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') continue
    const content = m.content.slice(0, MAX_CHARS).trim()
    if (!content) continue
    const last = out[out.length - 1]
    if (last && last.role === m.role) last.content += `\n\n${content}`
    else out.push({ role: m.role, content })
  }
  while (out.length && out[0].role !== 'user') out.shift()
  if (!out.length || out[out.length - 1].role !== 'user') return null
  return out
}

const json = (status, body) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

export default async function handler(req) {
  const { pathname } = new URL(req.url)

  if (pathname === '/api/health') return json(200, { ok: true })
  if (pathname !== '/api/ask') return json(404, { error: 'Not found' })
  if (req.method !== 'POST') return json(405, { error: 'Use POST' })
  if (!allowedOrigin(req)) return json(403, { error: 'Forbidden' })

  const ip = req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || 'unknown'
  if (throttled(ip)) return json(429, { error: 'Too many questions, try again in a few minutes.' })

  let body
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'Invalid JSON' })
  }
  const messages = cleanMessages(body?.messages)
  if (!messages) return json(400, { error: 'Send at least one question.' })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const events = await anthropic.messages.create({
          model: MODEL,
          max_tokens: 700,
          system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
          messages,
          stream: true,
        })
        for await (const event of events) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            controller.enqueue(encoder.encode(event.delta.text))
          }
        }
      } catch (err) {
        console.error('ask: model call failed', err?.status || '', err?.message || err)
        controller.enqueue(encoder.encode('\n\nSorry, I lost my train of thought. Please try again.'))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}
