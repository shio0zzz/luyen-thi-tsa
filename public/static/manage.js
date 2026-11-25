import { api, renderMath, escapeHtml } from '/static/common.js';
import { parsePdfToQuestions } from '/static/pdf-import.js';

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
            <i class="fas fa-file-pdf mr-1"></i> Import PDF
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
          ${['mcq','multi','tf','fill','matching','short'].map((t) => `<option value="${t}" ${q.type === t ? 'selected' : ''}>${t.toUpperCase()}</option>`).join('')}
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
  const loader = document.createElement('div');
  loader.className = 'fixed inset-0 bg-black/40 grid place-items-center z-50';
  loader.innerHTML = `<div class="bg-white p-6 rounded-lg shadow max-w-md w-full">
    <div class="font-semibold mb-2"><i class="fas fa-spinner fa-spin mr-2"></i>Parsing PDF…</div>
    <div class="text-sm text-slate-500" id="loader-msg">Extracting text with PDF.js</div>
  </div>`;
  document.body.appendChild(loader);
  try {
    const msg = loader.querySelector('#loader-msg');
    msg.textContent = 'Extracting text…';
    const questions = await parsePdfToQuestions(file, (m) => msg.textContent = m);
    if (!questions.length) { alert('No questions detected. You can add them manually.'); return; }
    showImportPreview(questions);
  } catch (err) {
    console.error(err);
    alert('PDF parsing failed: ' + err.message);
  } finally {
    loader.remove();
    e.target.value = '';
  }
}

function showImportPreview(questions) {
  const wrap = document.createElement('div');
  wrap.className = 'fixed inset-0 bg-black/40 z-50 grid place-items-center';
  wrap.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
      <div class="p-4 border-b border-slate-200 flex items-center justify-between">
        <div>
          <div class="font-semibold">Import preview — ${questions.length} questions detected</div>
          <div class="text-xs text-slate-500">Review, edit, or deselect before importing. You can refine any question in the editor afterwards.</div>
        </div>
        <button id="close-preview" class="text-slate-400 hover:text-slate-700"><i class="fas fa-times"></i></button>
      </div>
      <div class="p-4 overflow-auto flex-1 space-y-3">
        ${questions.map((q, i) => `
          <div class="border border-slate-200 rounded p-3">
            <div class="flex items-center gap-2 mb-2 text-xs">
              <label class="flex items-center gap-1"><input type="checkbox" data-imp-sel="${i}" checked /> include</label>
              <span class="px-2 py-0.5 bg-slate-100 rounded uppercase font-semibold">${q.type}</span>
              <input type="number" data-imp-num="${i}" value="${q.number}" class="w-16 border border-slate-300 rounded px-1 py-0.5" />
              <span class="text-slate-400">#${q.number}</span>
            </div>
            <textarea data-imp-body="${i}" rows="3" class="w-full border border-slate-300 rounded px-2 py-1 text-sm font-mono">${escapeHtml(q.body)}</textarea>
            ${q.type === 'mcq' ? `
              <div class="mt-2 grid grid-cols-2 gap-1 text-sm">
                ${(q.data?.options || []).map((o, oi) => `
                  <div class="flex gap-1">
                    <input type="text" value="${escapeHtml(o.key)}" data-imp-opt-key="${i}-${oi}" class="w-10 border border-slate-300 rounded px-1 py-0.5" />
                    <input type="text" value="${escapeHtml(o.text)}" data-imp-opt-text="${i}-${oi}" class="flex-1 border border-slate-300 rounded px-1 py-0.5" />
                  </div>`).join('')}
              </div>` : ''}
            <div class="mt-2 text-xs flex items-center gap-2">
              <span class="text-slate-500">Correct answer:</span>
              <input type="text" data-imp-correct="${i}" value="${escapeHtml(q.correct_answer ?? '')}" placeholder="e.g. B" class="flex-1 border border-slate-300 rounded px-2 py-0.5" />
            </div>
          </div>`).join('')}
      </div>
      <div class="p-4 border-t border-slate-200 flex justify-end gap-2">
        <button id="cancel-import" class="px-4 py-2 border border-slate-300 rounded hover:bg-slate-50 text-sm">Cancel</button>
        <button id="confirm-import" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-semibold">Import selected</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.querySelector('#close-preview').onclick = () => wrap.remove();
  wrap.querySelector('#cancel-import').onclick = () => wrap.remove();
  wrap.querySelector('#confirm-import').onclick = async () => {
    const sel = [];
    questions.forEach((q, i) => {
      if (!wrap.querySelector(`[data-imp-sel="${i}"]`).checked) return;
      const q2 = { ...q };
      q2.number = Number(wrap.querySelector(`[data-imp-num="${i}"]`).value);
      q2.body = wrap.querySelector(`[data-imp-body="${i}"]`).value;
      q2.correct_answer = wrap.querySelector(`[data-imp-correct="${i}"]`).value || null;
      if (q.type === 'mcq' && q.data?.options) {
        q2.data = { options: q.data.options.map((o, oi) => ({
          key: wrap.querySelector(`[data-imp-opt-key="${i}-${oi}"]`).value,
          text: wrap.querySelector(`[data-imp-opt-text="${i}-${oi}"]`).value,
        })) };
      }
      sel.push(q2);
    });
    if (!sel.length) { alert('Nothing selected'); return; }
    await fetch(`/api/exams/${examId}/questions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sel),
    });
    wrap.remove();
    await load();
  };
}

load();
