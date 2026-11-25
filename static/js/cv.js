// Allan Reyes — CV site interactions. No framework, no build step.

const root = document.documentElement;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Theme toggle (light-dark() does the rest in CSS) ---------- */
document.querySelector('.theme-toggle')?.addEventListener('click', () => {
  const current = root.dataset.theme
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  const apply = () => {
    root.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch {}
  };
  document.startViewTransition && !reduceMotion ? document.startViewTransition(apply) : apply();
});

/* ---------- Name "decodes" from noise, like a model settling on an answer ---------- */
const decodeEl = document.querySelector('[data-decode]');
if (decodeEl && !reduceMotion) {
  const target = decodeEl.textContent;
  const glyphs = '01<>/{}[]#*+=~^ABCDEFGHJKLMNPRSTVXYZ';
  decodeEl.setAttribute('aria-label', target);
  let frame = 0;
  const total = 26;
  const tick = () => {
    frame++;
    decodeEl.textContent = [...target].map((ch, i) => {
      if (ch === ' ') return ' ';
      return frame / total > i / target.length ? ch : glyphs[(Math.random() * glyphs.length) | 0];
    }).join('');
    if (frame < total) requestAnimationFrame(tick);
    else decodeEl.textContent = target;
  };
  requestAnimationFrame(tick);
}

/* ---------- Ask my CV ---------- */
const dialog = document.getElementById('ask');
const form = document.getElementById('ask-form');
const input = document.getElementById('ask-input');
const log = document.getElementById('ask-log');
const send = form?.querySelector('.ask__send');
const history = []; // { role, content } — lives only in this tab
let busy = false;

const open = () => {
  contactDialog?.open && contactDialog.close();
  if (!dialog.open) dialog.showModal();
  input.focus();
};
document.querySelectorAll('[data-ask]').forEach((b) => b.addEventListener('click', open));
addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    dialog.open ? dialog.close() : open();
  }
});
// Click on the backdrop closes
dialog?.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

log?.addEventListener('click', (e) => {
  const chip = e.target.closest('button[data-prompt], button[data-fill]');
  if (!chip) return;
  if (chip.dataset.prompt) { input.value = chip.dataset.prompt; form.requestSubmit(); }
  else { input.value = chip.dataset.fill; input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
});

input?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
});

// Tiny, safe markdown: escape first, then allow **bold**, `code`, [links](/path), lists and paragraphs.
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inline = (s) => s
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\[([^\]]+)\]\(((?:https:\/\/|\/)[^\s)]*)\)/g, '<a href="$2">$1</a>');
function render(md) {
  const lines = escapeHtml(md).split('\n');
  let html = '', list = false, para = [];
  const flush = () => { if (para.length) { html += `<p>${inline(para.join(' '))}</p>`; para = []; } };
  for (const raw of lines) {
    const line = raw.trim();
    const item = line.match(/^(?:[-*•–]|\d+\.)\s+(.*)/);
    if (item) { flush(); if (!list) { html += '<ul>'; list = true; } html += `<li>${inline(item[1])}</li>`; continue; }
    if (list) { html += '</ul>'; list = false; }
    if (!line) { flush(); continue; }
    para.push(line.replace(/^#+\s*/, ''));
  }
  flush();
  if (list) html += '</ul>';
  return html;
}

const bubble = (cls, text = '') => {
  log.querySelector('.ask__empty')?.remove();
  const el = document.createElement('div');
  el.className = `msg ${cls}`;
  el.textContent = text;
  log.append(el);
  log.scrollTop = log.scrollHeight;
  return el;
};

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q || busy) return;
  busy = true; send.disabled = true;
  input.value = '';
  bubble('msg--user', q);
  history.push({ role: 'user', content: q });
  const out = bubble('msg--bot msg--thinking');
  let answer = '';

  try {
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: history.slice(-10) }),
    });
    if (!res.ok || !res.body) {
      const msg = res.status === 429
        ? 'Lots of questions at once. Give it a minute and try again.'
        : 'The assistant is unavailable right now.';
      throw new Error(msg);
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      answer += value;
      out.innerHTML = render(answer);
      log.scrollTop = log.scrollHeight;
    }
    if (!answer.trim()) throw new Error('No answer came back. Try rephrasing.');
    history.push({ role: 'assistant', content: answer });
  } catch (err) {
    history.pop();
    out.classList.add('msg--error');
    out.innerHTML = `${escapeHtml(err.message || 'Something went wrong.')} You can also use the <a href="/#contact">contact form</a>.`;
  } finally {
    out.classList.remove('msg--thinking');
    busy = false; send.disabled = false;
    input.focus();
  }
});

/* ---------- Contact me dialog (Netlify Forms, submitted in place) ---------- */
const contactDialog = document.getElementById('contact-dialog');
const contactForm = contactDialog?.querySelector('form[name="contact"]');
const openContact = () => {
  if (!contactDialog) return;
  if (dialog?.open) dialog.close();
  if (!contactDialog.open) contactDialog.showModal();
  contactForm.querySelector('input[name="name"]').focus();
};
document.querySelectorAll('[data-contact]').forEach((b) => b.addEventListener('click', openContact));
contactDialog?.addEventListener('click', (e) => { if (e.target === contactDialog) contactDialog.close(); });
// Links to #contact (from the assistant, llms.txt or old /contact URLs) open the dialog
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href$="#contact"]');
  if (!a || new URL(a.href).pathname !== '/') return;
  e.preventDefault();
  openContact();
});
if (location.hash === '#contact') openContact();
addEventListener('hashchange', () => { if (location.hash === '#contact') openContact(); });

contactForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = contactForm.querySelector('.contact-form__status');
  const button = contactForm.querySelector('button[type="submit"]');
  const data = new FormData(contactForm);
  if (!data.has('form-name')) data.set('form-name', 'contact');
  button.disabled = true;
  status.className = 'contact-form__status small';
  status.textContent = 'Sending…';
  try {
    const res = await fetch('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(data).toString(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    contactForm.reset();
    status.classList.add('is-done');
    status.textContent = "Thanks, it's on its way. I'll reply by email.";
  } catch {
    status.classList.add('is-error');
    status.textContent = "Sorry, that didn't go through. Please try again, or reach me on LinkedIn.";
  } finally {
    button.disabled = false;
  }
});
