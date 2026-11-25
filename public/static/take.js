import { api, renderMath, fmtDuration, escapeHtml, debounce } from '/static/common.js';

const app = document.getElementById('app');
const attemptId = Number(app.dataset.attemptId);

let state = {
  exam: null,
  questions: [],
  answers: {}, // question_id -> parsed answer
  flagged: new Set(), // client-side only (localStorage)
  currentIdx: 0,
  attempt: null,
  startTs: Date.now(),
  timerInt: null,
};

const FLAG_KEY = `examlab:flags:${attemptId}`;
try {
  state.flagged = new Set(JSON.parse(localStorage.getItem(FLAG_KEY) || '[]'));
} catch {}

async function load() {
  const { attempt, answers } = await api.get(`/api/attempts/${attemptId}`);
  state.attempt = attempt;
  const { exam, questions } = await api.get(`/api/exams/${attempt.exam_id}`);
  state.exam = exam;
  state.questions = questions.map((q) => ({ ...q, data: safeJson(q.data) }));
  for (const a of answers) {
    state.answers[a.question_id] = a.answer == null ? null : safeJson(a.answer);
  }
  // resume timer from recorded time
  state.startTs = Date.now() - (attempt.time_spent_seconds || 0) * 1000;
  render();
}

function safeJson(s) {
  if (s == null) return null;
  try { return JSON.parse(s); } catch { return s; }
}

function totalSeconds() {
  return Math.floor((Date.now() - state.startTs) / 1000);
}
function remainingSeconds() {
  const total = (state.exam?.duration_minutes || 60) * 60;
  return Math.max(0, total - totalSeconds());
}

function render() {
  const q = state.questions[state.currentIdx];
  const locked = state.attempt.status !== 'in_progress';
  app.innerHTML = `
    <div class="min-h-screen flex flex-col">
      ${header()}
      <div class="flex-1 max-w-7xl mx-auto w-full grid grid-cols-[1fr_280px] gap-6 p-6">
        <main class="exam-card p-6">
          ${locked ? `<div class="mb-4 p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded text-sm">
            <i class="fas fa-lock mr-1"></i> This attempt is <b>${state.attempt.status}</b> — answers are no longer editable.
            <button id="reopen-btn" class="underline ml-2">Reopen for editing</button>
          </div>` : ''}
          ${q ? questionBlock(q, locked) : '<p>No questions.</p>'}
          ${navButtons(locked)}
        </main>
        <aside class="space-y-4">
          ${sidebar()}
        </aside>
      </div>
    </div>`;
  bind();
  renderMath(app);
  startTimer();
}

function header() {
  return `
    <header class="bg-white border-b border-slate-200">
      <div class="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <a href="/" class="w-9 h-9 bg-blue-600 text-white rounded grid place-items-center font-bold text-sm">EL</a>
          <div>
            <div class="text-xs text-slate-500">${escapeHtml(state.exam?.title ?? '')}</div>
            <div class="font-semibold">Question ${state.currentIdx + 1} of ${state.questions.length}</div>
          </div>
        </div>
        <div class="flex items-center gap-4">
          <div class="text-sm text-slate-600">Time left</div>
          <div id="timer" class="text-2xl font-mono font-bold text-slate-800 tabular-nums">00:00:00</div>
          <button id="submit-btn" class="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-md text-sm font-medium">
            <i class="fas fa-paper-plane mr-1"></i> Submit
          </button>
        </div>
      </div>
    </header>`;
}

function questionBlock(q, locked) {
  const idx = state.currentIdx;
  const flagged = state.flagged.has(q.id);
  return `
    <div class="mb-6 flex items-start gap-3">
      <div class="w-9 h-9 bg-slate-800 text-white rounded-md grid place-items-center font-bold shrink-0">${q.number}</div>
      <div class="flex-1 exam-body text-slate-800">${escapeHtml(q.body)}</div>
      <button id="flag-btn" class="text-sm ${flagged ? 'text-amber-500' : 'text-slate-400'} hover:text-amber-500">
        <i class="fas fa-flag"></i>
      </button>
    </div>
    <div>${renderQuestionBody(q, locked)}</div>`;
}

function renderQuestionBody(q, locked) {
  const val = state.answers[q.id];
  const dis = locked ? 'disabled' : '';
  switch (q.type) {
    case 'mcq':
      return `<div class="space-y-2">${(q.data?.options || []).map((opt) => `
        <label class="flex items-center gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 ${val === opt.key ? 'ring-2 ring-blue-500 bg-blue-50' : ''}">
          <input type="radio" name="opt" value="${opt.key}" ${val === opt.key ? 'checked' : ''} ${dis} />
          <span class="font-semibold text-slate-700">${opt.key}.</span>
          <span>${escapeHtml(opt.text)}</span>
        </label>`).join('')}</div>`;
    case 'multi':
      const mset = new Set(Array.isArray(val) ? val : []);
      return `<div class="space-y-2">${(q.data?.options || []).map((opt) => `
        <label class="flex items-center gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 ${mset.has(opt.key) ? 'ring-2 ring-blue-500 bg-blue-50' : ''}">
          <input type="checkbox" name="opt" value="${opt.key}" ${mset.has(opt.key) ? 'checked' : ''} ${dis} />
          <span class="font-semibold text-slate-700">${opt.key}.</span>
          <span>${escapeHtml(opt.text)}</span>
        </label>`).join('')}</div>`;
    case 'tf':
      const tfVal = val || {};
      return `
        <table class="w-full tf-table border border-slate-200 rounded-lg overflow-hidden">
          <thead><tr><th class="text-left">Mệnh đề</th><th class="text-center w-24">Đúng</th><th class="text-center w-24">Sai</th></tr></thead>
          <tbody>${(q.data?.statements || []).map((s) => `
            <tr>
              <td>${escapeHtml(s.text)}</td>
              <td class="text-center">
                <input type="radio" name="tf-${s.key}" data-key="${s.key}" value="true"  ${tfVal[s.key] === true ? 'checked' : ''} ${dis} />
              </td>
              <td class="text-center">
                <input type="radio" name="tf-${s.key}" data-key="${s.key}" value="false" ${tfVal[s.key] === false ? 'checked' : ''} ${dis} />
              </td>
            </tr>`).join('')}</tbody>
        </table>`;
    case 'fill':
      const blanks = q.data?.blanks || 1;
      const vals = Array.isArray(val) ? val : (val ? [val] : []);
      return `<div class="space-y-2">${Array.from({ length: blanks }, (_, i) => `
        <input type="text" class="w-full border border-slate-300 rounded-md px-3 py-2 text-base focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          data-blank="${i}" placeholder="Answer ${blanks > 1 ? `#${i + 1}` : ''}" value="${escapeHtml(vals[i] ?? '')}" ${dis} />`).join('')}</div>`;
    case 'matching':
      const lefts = q.data?.left || [];
      const rights = q.data?.right || [];
      const mv = val || {};
      return `<div class="space-y-2">${lefts.map((l) => `
        <div class="flex items-center gap-3">
          <div class="flex-1 p-2 bg-slate-50 rounded">${escapeHtml(l.text)}</div>
          <select data-left="${l.key}" class="border border-slate-300 rounded-md px-2 py-1 w-56" ${dis}>
            <option value="">— choose —</option>
            ${rights.map((r) => `<option value="${r.key}" ${mv[l.key] === r.key ? 'selected' : ''}>${escapeHtml(r.text)}</option>`).join('')}
          </select>
        </div>`).join('')}</div>`;
    case 'short':
    default:
      return `<textarea class="w-full border border-slate-300 rounded-md px-3 py-2" rows="4" placeholder="Your answer…" ${dis}>${escapeHtml(val ?? '')}</textarea>`;
  }
}

function navButtons(locked) {
  return `
    <div class="mt-8 flex justify-between items-center">
      <button id="prev-btn" class="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 rounded-md text-sm font-medium" ${state.currentIdx === 0 ? 'disabled' : ''}>
        <i class="fas fa-chevron-left mr-1"></i> Previous
      </button>
      <div class="text-xs text-slate-500">${locked ? 'View only' : 'Auto-saves as you type'}</div>
      <button id="next-btn" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium" ${state.currentIdx === state.questions.length - 1 ? 'disabled' : ''}>
        Next <i class="fas fa-chevron-right ml-1"></i>
      </button>
    </div>`;
}

function sidebar() {
  const answered = state.questions.filter((q) => hasAnswer(state.answers[q.id])).length;
  return `
    <div class="exam-card p-4">
      <div class="text-sm font-semibold mb-2">Candidate</div>
      <div class="text-xs text-slate-500 mb-3">Attempt #${state.attempt.id}</div>
      <div class="text-sm font-semibold mb-2">Legend</div>
      <div class="flex flex-wrap gap-2 text-xs mb-3">
        <span class="chip chip-submitted">Answered</span>
        <span class="chip chip-in-progress">Flagged</span>
        <span class="chip" style="background:#f1f5f9;color:#475569">Unanswered</span>
      </div>
      <div class="text-sm font-semibold mb-2">Questions (${answered}/${state.questions.length})</div>
      <div class="grid grid-cols-5 gap-2">
        ${state.questions.map((q, i) => {
          const classes = ['q-nav-btn'];
          if (hasAnswer(state.answers[q.id])) classes.push('answered');
          if (state.flagged.has(q.id)) classes.push('flagged');
          if (i === state.currentIdx) classes.push('current');
          return `<button class="${classes.join(' ')}" data-goto="${i}">${q.number}</button>`;
        }).join('')}
      </div>
    </div>
    <div class="exam-card p-4 text-xs text-slate-500 space-y-1">
      <div><i class="fas fa-save mr-1"></i> Answers auto-save on change.</div>
      <div><i class="fas fa-flag mr-1"></i> Flag questions to revisit.</div>
      <div><i class="fas fa-unlock mr-1"></i> Submission locks edits; you can reopen manually.</div>
    </div>`;
}

function hasAnswer(v) {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.filter((x) => x != null && String(x).length).length > 0;
  if (typeof v === 'object') return Object.values(v).some((x) => x !== null && x !== undefined && x !== '');
  return true;
}

const saveAnswer = debounce(async (qid, val) => {
  try {
    await api.put(`/api/attempts/${attemptId}/answers/${qid}`, { answer: val });
    const dot = document.querySelector(`[data-goto="${state.questions.findIndex((q) => q.id === qid)}"]`);
    if (dot) hasAnswer(val) ? dot.classList.add('answered') : dot.classList.remove('answered');
  } catch (e) { console.warn('save failed', e); }
}, 350);

function bind() {
  const q = state.questions[state.currentIdx];
  if (!q) return;
  const locked = state.attempt.status !== 'in_progress';

  // Navigation
  app.querySelectorAll('[data-goto]').forEach((b) =>
    b.addEventListener('click', () => { state.currentIdx = Number(b.dataset.goto); render(); })
  );
  document.getElementById('prev-btn')?.addEventListener('click', () => { if (state.currentIdx > 0) { state.currentIdx--; render(); } });
  document.getElementById('next-btn')?.addEventListener('click', () => { if (state.currentIdx < state.questions.length - 1) { state.currentIdx++; render(); } });

  document.getElementById('flag-btn')?.addEventListener('click', () => {
    if (state.flagged.has(q.id)) state.flagged.delete(q.id); else state.flagged.add(q.id);
    localStorage.setItem(FLAG_KEY, JSON.stringify([...state.flagged]));
    render();
  });

  document.getElementById('submit-btn')?.addEventListener('click', submitAttempt);
  document.getElementById('reopen-btn')?.addEventListener('click', reopenAttempt);

  if (locked) return;

  // Inputs
  if (q.type === 'mcq') {
    app.querySelectorAll('input[name="opt"]').forEach((el) =>
      el.addEventListener('change', (e) => {
        state.answers[q.id] = e.target.value;
        saveAnswer(q.id, e.target.value);
        render();
      })
    );
  } else if (q.type === 'multi') {
    app.querySelectorAll('input[name="opt"]').forEach((el) =>
      el.addEventListener('change', () => {
        const picks = [...app.querySelectorAll('input[name="opt"]:checked')].map((x) => x.value);
        state.answers[q.id] = picks;
        saveAnswer(q.id, picks);
        render();
      })
    );
  } else if (q.type === 'tf') {
    app.querySelectorAll('input[type="radio"][data-key]').forEach((el) =>
      el.addEventListener('change', (e) => {
        const key = e.target.dataset.key;
        const cur = { ...(state.answers[q.id] || {}) };
        cur[key] = e.target.value === 'true';
        state.answers[q.id] = cur;
        saveAnswer(q.id, cur);
        render();
      })
    );
  } else if (q.type === 'fill') {
    app.querySelectorAll('input[data-blank]').forEach((el) =>
      el.addEventListener('input', () => {
        const blanks = q.data?.blanks || 1;
        const vals = [];
        for (let i = 0; i < blanks; i++) vals.push(app.querySelector(`input[data-blank="${i}"]`).value);
        const payload = blanks === 1 ? vals[0] : vals;
        state.answers[q.id] = payload;
        saveAnswer(q.id, payload);
      })
    );
  } else if (q.type === 'matching') {
    app.querySelectorAll('select[data-left]').forEach((el) =>
      el.addEventListener('change', () => {
        const map = {};
        app.querySelectorAll('select[data-left]').forEach((s) => { if (s.value) map[s.dataset.left] = s.value; });
        state.answers[q.id] = map;
        saveAnswer(q.id, map);
      })
    );
  } else if (q.type === 'short') {
    const ta = app.querySelector('textarea');
    ta?.addEventListener('input', () => {
      state.answers[q.id] = ta.value;
      saveAnswer(q.id, ta.value);
    });
  }
}

function startTimer() {
  clearInterval(state.timerInt);
  const el = document.getElementById('timer');
  if (!el) return;
  const update = () => {
    const rem = remainingSeconds();
    el.textContent = fmtDuration(rem);
    if (rem === 0) { clearInterval(state.timerInt); submitAttempt(true); }
  };
  update();
  state.timerInt = setInterval(update, 1000);
}

async function submitAttempt(auto = false) {
  if (!auto && !confirm('Submit this attempt? Answers will be locked (you can reopen to edit).')) return;
  await api.post(`/api/attempts/${attemptId}/submit`, { time_spent_seconds: totalSeconds() });
  location.href = `/attempts/${attemptId}/mark`;
}

async function reopenAttempt() {
  if (!confirm('Reopen this attempt for editing? Any marks will be cleared.')) return;
  await api.post(`/api/attempts/${attemptId}/reopen`, {});
  location.reload();
}

load();
