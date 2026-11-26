import { api, renderMath, escapeHtml } from '/static/common.js';
import { autoImportPdf } from '/static/pdf-import.js';

const app = document.getElementById('app');
const examId = Number(app.dataset.examId);

let state = { exam: null, questions: [], editing: null };

async function load() {
  const { exam, questions } = await api.get(`/api/exams/${examId}`);
  state.exam = exam;
  state.questions = questions.map((q) => ({ ...q, data: safeJson(q.data) }));
  render();
}

function safeJson(s) { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return s; } }

function render() {
  app.innerHTML = `
    <header class="bg-white border-b border-slate-200">
      <div class="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <a href="/" class="w-9 h-9 bg-blue-600 text-white rounded grid place-items-center font-bold text-sm">EL</a>
          <div>
            <div class="text-xs text-slate-500">Editing exam</div>
            <div class="font-semibold">${escapeHtml(state.exam.title)}</div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <label class="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-md text-sm font-medium cursor-pointer">
            <i class="fas fa-wand-magic-sparkles mr-1"></i> Auto-import PDF
            <input type="file" accept="application/pdf" id="pdf-input" class="hidden" />
          </label>
          <button id="add-btn" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium">
            <i class="fas fa-plus mr-1"></i> Add question
          </button>
        </div>
      </div>
    </header>
    <main class="max-w-6xl mx-auto p-6 grid grid-cols-[320px_1fr] gap-6">
      <aside class="exam-card p-3 h-fit sticky top-4 max-h-[85vh] overflow-auto">
        <div class="text-xs font-semibold text-slate-500 px-2 mb-2">${state.questions.length} questions</div>
        <ul class="space-y-1">
          ${state.questions.map((q) => `
            <li>
              <button data-edit="${q.id}" class="w-full text-left px-3 py-2 rounded hover:bg-slate-100 flex items-center gap-2 ${state.editing?.id === q.id ? 'bg-blue-50' : ''}">
                <span class="text-xs font-semibold text-slate-500 w-6">#${q.number}</span>
                <span class="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600 uppercase">${q.type}</span>
                <span class="text-sm truncate">${escapeHtml(q.body.slice(0, 60))}</span>
              </button>
            </li>`).join('')}
        </ul>
      </aside>
      <section class="exam-card p-6">
        ${state.editing ? editor(state.editing) : '<div class="text-slate-500 text-sm">Select a question on the left, click <b>Add question</b>, or import a PDF.</div>'}
      </section>
    </main>`;
  bind();
  renderMath(app);
}

function editor(q) {
  return `
    <div class="flex items-center justify-between mb-4">
      <div class="flex items-center gap-2">
        <input id="f-number" type="number" value="${q.number}" class="w-20 border border-slate-300 rounded px-2 py-1" />
        <select id="f-type" class="border border-slate-300 rounded px-2 py-1">
          ${['mcq','multi','tf','fill','matching','short','image'].map((t) => `<option value="${t}" ${q.type === t ? 'selected' : ''}>${t.toUpperCase()}</option>`).join('')}
        </select>
        <label class="text-sm">Points
          <input id="f-points" type="number" step="0.5" min="0" value="${q.points}" class="w-20 border border-slate-300 rounded px-2 py-1 ml-1" />
        </label>
      </div>
      <div class="flex items-center gap-2">
        <button id="save-btn" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium">
          <i class="fas fa-save mr-1"></i> Save
        </button>
        <button id="del-btn" class="bg-white border border-red-300 text-red-600 hover:bg-red-50 px-3 py-2 rounded-md text-sm">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    </div>
    <label class="block text-xs font-semibold text-slate-500 mb-1">Question body</label>
    <textarea id="f-body" rows="5" class="w-full border border-slate-300 rounded px-3 py-2 mb-4 font-mono text-sm">${escapeHtml(q.body)}</textarea>
    <div id="f-data">${typeEditor(q)}</div>
    <label class="block text-xs font-semibold text-slate-500 mb-1 mt-4">Correct answer (JSON or plain)</label>
    <input id="f-correct" type="text" class="w-full border border-slate-300 rounded px-3 py-2 font-mono text-sm" value="${escapeHtml(q.correct_answer ?? '')}" />
    <p class="text-xs text-slate-400 mt-1">MCQ: a single letter like <code>B</code>. Multi: JSON array like <code>["A","C"]</code>. True/False: JSON like <code>{"a":true,"b":false}</code>. Fill: a string or JSON array.</p>
  `;
}

function typeEditor(q) {
  if (q.type === 'mcq' || q.type === 'multi') {
    const opts = q.data?.options || [{ key: 'A', text: '' }, { key: 'B', text: '' }, { key: 'C', text: '' }, { key: 'D', text: '' }];
    return `
      <label class="block text-xs font-semibold text-slate-500 mb-1">Options</label>
      <div id="opt-list" class="space-y-2">
        ${opts.map((o, i) => `
          <div class="flex gap-2">
            <input data-opt-key="${i}" value="${escapeHtml(o.key)}" class="w-16 border border-slate-300 rounded px-2 py-1 text-sm" />
            <input data-opt-text="${i}" value="${escapeHtml(o.text)}" class="flex-1 border border-slate-300 rounded px-2 py-1 text-sm" />
            <button data-opt-del="${i}" class="text-slate-400 hover:text-red-500 px-2"><i class="fas fa-times"></i></button>
          </div>`).join('')}
      </div>
      <button id="opt-add" class="mt-2 text-sm text-blue-600 hover:underline"><i class="fas fa-plus mr-1"></i>Add option</button>`;
  }
  if (q.type === 'tf') {
    const stms = q.data?.statements || [{ key: 'a', text: '' }, { key: 'b', text: '' }];
    return `
      <label class="block text-xs font-semibold text-slate-500 mb-1">Statements (each can be Đúng/Sai)</label>
      <div id="stm-list" class="space-y-2">
        ${stms.map((s, i) => `
          <div class="flex gap-2">
            <input data-stm-key="${i}" value="${escapeHtml(s.key)}" class="w-16 border border-slate-300 rounded px-2 py-1 text-sm" />
            <input data-stm-text="${i}" value="${escapeHtml(s.text)}" class="flex-1 border border-slate-300 rounded px-2 py-1 text-sm" />
            <button data-stm-del="${i}" class="text-slate-400 hover:text-red-500 px-2"><i class="fas fa-times"></i></button>
          </div>`).join('')}
      </div>
      <button id="stm-add" class="mt-2 text-sm text-blue-600 hover:underline"><i class="fas fa-plus mr-1"></i>Add statement</button>`;
  }
  if (q.type === 'fill') {
    const n = q.data?.blanks || 1;
    return `<label class="block text-xs font-semibold text-slate-500 mb-1">Number of blanks</label>
      <input id="f-blanks" type="number" min="1" value="${n}" class="w-24 border border-slate-300 rounded px-2 py-1 text-sm" />
      <p class="text-xs text-slate-400 mt-1">Use <code>___</code> in the question body where the blank should appear.</p>`;
  }
  if (q.type === 'matching') {
    const left = q.data?.left || [{ key: 'L1', text: '' }];
    const right = q.data?.right || [{ key: 'R1', text: '' }];
    return `
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-xs font-semibold text-slate-500 mb-1">Left</label>
          <div id="left-list" class="space-y-1">
            ${left.map((o, i) => `<div class="flex gap-2"><input data-left-key="${i}" value="${escapeHtml(o.key)}" class="w-16 border border-slate-300 rounded px-2 py-1 text-sm" /><input data-left-text="${i}" value="${escapeHtml(o.text)}" class="flex-1 border border-slate-300 rounded px-2 py-1 text-sm" /></div>`).join('')}
          </div>
          <button id="left-add" class="mt-1 text-xs text-blue-600 hover:underline"><i class="fas fa-plus mr-1"></i>Add</button>
        </div>
        <div>
          <label class="block text-xs font-semibold text-slate-500 mb-1">Right</label>
          <div id="right-list" class="space-y-1">
            ${right.map((o, i) => `<div class="flex gap-2"><input data-right-key="${i}" value="${escapeHtml(o.key)}" class="w-16 border border-slate-300 rounded px-2 py-1 text-sm" /><input data-right-text="${i}" value="${escapeHtml(o.text)}" class="flex-1 border border-slate-300 rounded px-2 py-1 text-sm" /></div>`).join('')}
          </div>
          <button id="right-add" class="mt-1 text-xs text-blue-600 hover:underline"><i class="fas fa-plus mr-1"></i>Add</button>
        </div>
      </div>
      <p class="text-xs text-slate-400 mt-2">Correct answer format: JSON like <code>{"L1":"R2","L2":"R1"}</code>.</p>`;
  }
  if (q.type === 'image') {
    const url = q.data?.image_url || '';
    return `
      <label class="block text-xs font-semibold text-slate-500 mb-1">Image URL</label>
      <input id="f-image-url" type="text" value="${escapeHtml(url)}" placeholder="/uploads/..." class="w-full border border-slate-300 rounded px-3 py-2 text-sm font-mono mb-2" />
      ${url ? `<img src="${url}" alt="preview" class="max-w-full h-auto rounded border border-slate-200" />` : '<p class="text-xs text-slate-400">No image yet. Use <b>Import PDF (crop)</b> to add image questions, or paste a URL above.</p>'}
      <p class="text-xs text-slate-400 mt-1">Image-type questions have no auto-grade — they are marked manually.</p>`;
  }
  return '<p class="text-xs text-slate-500">Short-answer: no extra fields.</p>';
}

function collectEditor() {
  const type = document.getElementById('f-type').value;
  const q = {
    id: state.editing.id,
    number: Number(document.getElementById('f-number').value) || 1,
    type,
    body: document.getElementById('f-body').value,
    points: Number(document.getElementById('f-points').value) || 1,
    correct_answer: document.getElementById('f-correct').value || null,
    data: {},
  };
  if (type === 'mcq' || type === 'multi') {
    const opts = [];
    document.querySelectorAll('[data-opt-key]').forEach((el, i) => {
      const text = document.querySelector(`[data-opt-text="${i}"]`)?.value || '';
      opts.push({ key: el.value, text });
    });
    q.data.options = opts;
  } else if (type === 'tf') {
    const stms = [];
    document.querySelectorAll('[data-stm-key]').forEach((el, i) => {
      const text = document.querySelector(`[data-stm-text="${i}"]`)?.value || '';
      stms.push({ key: el.value, text });
    });
    q.data.statements = stms;
  } else if (type === 'fill') {
    q.data.blanks = Number(document.getElementById('f-blanks').value) || 1;
  } else if (type === 'matching') {
    const left = [], right = [];
    document.querySelectorAll('[data-left-key]').forEach((el, i) => left.push({ key: el.value, text: document.querySelector(`[data-left-text="${i}"]`)?.value || '' }));
    document.querySelectorAll('[data-right-key]').forEach((el, i) => right.push({ key: el.value, text: document.querySelector(`[data-right-text="${i}"]`)?.value || '' }));
    q.data.left = left; q.data.right = right;
  } else if (type === 'image') {
    const url = document.getElementById('f-image-url')?.value || '';
    q.data.image_url = url;
  }
  return q;
}

function bind() {
  app.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => {
      state.editing = state.questions.find((q) => q.id === Number(b.dataset.edit));
      render();
    })
  );

  document.getElementById('add-btn').addEventListener('click', async () => {
    const nextNum = (state.questions[state.questions.length - 1]?.number || 0) + 1;
    const q = { number: nextNum, type: 'mcq', body: 'New question', data: { options: [{ key: 'A', text: '' }, { key: 'B', text: '' }] }, points: 1 };
    const res = await fetch(`/api/exams/${examId}/questions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(q) });
    if (res.ok) { await load(); state.editing = state.questions.find((x) => x.number === nextNum); render(); }
  });

  document.getElementById('pdf-input')?.addEventListener('change', onPdf);

  if (!state.editing) return;

  document.getElementById('f-type').addEventListener('change', () => {
    const q = collectEditor();
    // reset data when changing type
    q.data = {};
    state.editing = { ...state.editing, type: q.type, data: {} };
    // re-render the type-specific panel
    const panel = document.getElementById('f-data');
    if (panel) panel.innerHTML = typeEditor(state.editing);
    bindOptionRows();
  });

  document.getElementById('save-btn').addEventListener('click', async () => {
    const q = collectEditor();
    await api.put(`/api/questions/${q.id}`, q);
    await load();
  });

  document.getElementById('del-btn').addEventListener('click', async () => {
    if (!confirm('Delete this question?')) return;
    await api.del(`/api/questions/${state.editing.id}`);
    state.editing = null;
    await load();
  });

  bindOptionRows();
}

function bindOptionRows() {
  document.getElementById('opt-add')?.addEventListener('click', () => {
    const list = document.getElementById('opt-list');
    const i = list.children.length;
    const next = String.fromCharCode('A'.charCodeAt(0) + i);
    const div = document.createElement('div');
    div.className = 'flex gap-2';
    div.innerHTML = `<input data-opt-key="${i}" value="${next}" class="w-16 border border-slate-300 rounded px-2 py-1 text-sm" />
      <input data-opt-text="${i}" value="" class="flex-1 border border-slate-300 rounded px-2 py-1 text-sm" />
      <button data-opt-del="${i}" class="text-slate-400 hover:text-red-500 px-2"><i class="fas fa-times"></i></button>`;
    list.appendChild(div);
    bindOptionRows();
  });
  document.querySelectorAll('[data-opt-del]').forEach((b) =>
    b.addEventListener('click', () => b.parentElement.remove())
  );
  document.getElementById('stm-add')?.addEventListener('click', () => {
    const list = document.getElementById('stm-list');
    const i = list.children.length;
    const next = String.fromCharCode('a'.charCodeAt(0) + i);
    const div = document.createElement('div');
    div.className = 'flex gap-2';
    div.innerHTML = `<input data-stm-key="${i}" value="${next}" class="w-16 border border-slate-300 rounded px-2 py-1 text-sm" />
      <input data-stm-text="${i}" value="" class="flex-1 border border-slate-300 rounded px-2 py-1 text-sm" />
      <button data-stm-del="${i}" class="text-slate-400 hover:text-red-500 px-2"><i class="fas fa-times"></i></button>`;
    list.appendChild(div);
    bindOptionRows();
  });
  document.querySelectorAll('[data-stm-del]').forEach((b) =>
    b.addEventListener('click', () => b.parentElement.remove())
  );
  document.getElementById('left-add')?.addEventListener('click', () => {
    const list = document.getElementById('left-list');
    const i = list.children.length;
    const div = document.createElement('div');
    div.className = 'flex gap-2';
    div.innerHTML = `<input data-left-key="${i}" value="L${i+1}" class="w-16 border border-slate-300 rounded px-2 py-1 text-sm" /><input data-left-text="${i}" value="" class="flex-1 border border-slate-300 rounded px-2 py-1 text-sm" />`;
    list.appendChild(div);
  });
  document.getElementById('right-add')?.addEventListener('click', () => {
    const list = document.getElementById('right-list');
    const i = list.children.length;
    const div = document.createElement('div');
    div.className = 'flex gap-2';
    div.innerHTML = `<input data-right-key="${i}" value="R${i+1}" class="w-16 border border-slate-300 rounded px-2 py-1 text-sm" /><input data-right-text="${i}" value="" class="flex-1 border border-slate-300 rounded px-2 py-1 text-sm" />`;
    list.appendChild(div);
  });
}

async function onPdf(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  // Progress overlay (updated by autoImportPdf via onProgress callback)
  const loader = document.createElement('div');
  loader.className = 'fixed inset-0 bg-black/50 grid place-items-center z-[90]';
  loader.innerHTML = `
    <div class="bg-white p-6 rounded-lg shadow-xl max-w-md w-full">
      <div class="font-semibold mb-2"><i class="fas fa-wand-magic-sparkles mr-2 text-emerald-600"></i>Auto-importing PDF…</div>
      <div class="text-sm text-slate-500" id="loader-msg">Starting…</div>
    </div>`;
  document.body.appendChild(loader);
  const setMsg = (m) => { const el = loader.querySelector('#loader-msg'); if (el) el.textContent = m; };

  try {
    const created = await autoImportPdf(file, {
      startingNumber: (state.questions[state.questions.length - 1]?.number || 0) + 1,
      onProgress: setMsg,
      onImport: async (picked, onBatchProgress) => {
        // Hide the main loader while the preview dialog is open; show again for uploads.
        loader.style.display = 'none';

        // Give the preview dialog time to close before swapping overlays
        await new Promise((r) => setTimeout(r, 50));
        loader.style.display = '';
        setMsg(`Uploading ${picked.length} question${picked.length === 1 ? '' : 's'}…`);

        const made = [];
        for (let i = 0; i < picked.length; i++) {
          const c = picked[i];
          onBatchProgress(i + 1, picked.length);
          setMsg(`Uploading ${i + 1} / ${picked.length}…`);
          try {
            const resp = await fetch('/api/uploads', {
              method: 'POST',
              headers: { 'content-type': c.contentType },
              body: await c.blob.arrayBuffer(),
            });
            if (!resp.ok) {
              const txt = await resp.text();
              throw new Error(`upload #${i + 1} failed: ${resp.status} ${txt}`);
            }
            const upload = await resp.json();
            made.push({
              number: c.number,
              type: 'image',
              body: '', // the image IS the question
              data: { image_url: upload.url, width: c.width, height: c.height },
              correct_answer: null,
              points: 1,
            });
          } catch (err) {
            console.error('upload error for crop', i, err);
            throw err; // surface to outer catch so user sees it
          }
        }
        if (made.length) {
          setMsg('Saving questions to database…');
          const resp = await fetch(`/api/exams/${examId}/questions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(made),
          });
          if (!resp.ok) {
            const txt = await resp.text();
            throw new Error(`save failed: ${resp.status} ${txt}`);
          }
        }
        return made.length;
      },
    });
    if (created > 0) {
      setMsg(`Imported ${created} question${created === 1 ? '' : 's'}.`);
      await load();
    }
  } catch (err) {
    console.error(err);
    alert('PDF import failed: ' + err.message);
  } finally {
    loader.remove();
    e.target.value = '';
  }
}

load();
