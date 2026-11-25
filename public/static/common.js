// Shared helpers
export const api = {
  async get(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async post(url, body) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async put(url, body) {
    const r = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async del(url) {
    const r = await fetch(url, { method: 'DELETE' });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
};

export function renderMath(root = document.body) {
  if (window.renderMathInElement) {
    window.renderMathInElement(root, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false },
        { left: '\\(', right: '\\)', display: false },
        { left: '\\[', right: '\\]', display: true },
      ],
      throwOnError: false,
    });
  }
}

export function fmtDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

export function statusChip(status) {
  const map = {
    in_progress: ['chip-in-progress', 'In progress'],
    submitted: ['chip-submitted', 'Submitted'],
    marked: ['chip-marked', 'Marked'],
  };
  const [cls, label] = map[status] ?? ['', status];
  return `<span class="chip ${cls}">${label}</span>`;
}

export function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

/** Debounce */
export function debounce(fn, ms = 400) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
