import { api, renderMath, escapeHtml, statusChip } from '/static/common.js';

const app = document.getElementById('app');
const attemptId = Number(app.dataset.attemptId);

let state = {
  attempt: null,
  exam: null,
  questions: [],
  answers: {}, // qid -> { raw, is_correct (from DB), score_awarded (from DB), marker_note (from DB) }
  grades: {},  // qid -> { is_correct, score_awarded, marker_note }  (live editable state)
  dirty: false,
};

async function load() {
  const { attempt, answers } = await api.get(`/api/attempts/${attemptId}`);
  state.attempt = attempt;
  const { exam, questions } = await api.get(`/api/exams/${attempt.exam_id}`);
  state.exam = exam;
  state.questions = questions.map((q) => ({ ...q, data: safeJson(q.data) }));
  for (const a of answers) {
    state.answers[a.question_id] = {
      raw: a.answer == null ? null : safeJson(a.answer),
      is_correct: a.is_correct,
      score_awarded: a.score_awarded,
      marker_note: a.marker_note,
    };
  }
  initGrades();
  render();
}

function safeJson(s) { try { return JSON.parse(s); } catch { return s; } }

/** Seed state.grades from the DB. If a grade was never saved, auto-SUGGEST (not force) one. */
function initGrades() {
  for (const q of state.questions) {
    const ans = state.answers[q.id];
    // If already marked, respect the saved mark exactly.
    if (ans && ans.is_correct != null) {
      state.grades[q.id] = {
        is_correct: !!ans.is_correct,
        score_awarded: ans.score_awarded ?? (ans.is_correct ? q.points : 0),
        marker_note: ans.marker_note || '',
        auto: false,
      };
      continue;
    }
    // Otherwise, compute an auto-suggestion.
    const suggested = suggestGrade(q, ans?.raw);
    state.grades[q.id] = {
      is_correct: suggested.is_correct,
      score_awarded: suggested.is_correct === null ? 0 : (suggested.is_correct ? q.points : 0),
      marker_note: '',
      auto: true, // flag so the UI can show "auto-suggested"
    };
  }
}

function suggestGrade(q, raw) {
  if (q.type === 'image') return { is_correct: null }; // pure manual
  if (raw == null || raw === '') return { is_correct: null };
  const correct = q.correct_answer ? safeJson(q.correct_answer) : null;
  if (correct == null) return { is_correct: null };
  const norm = (s) => String(s ?? '').trim().toLowerCase();
  if (q.type === 'mcq') return { is_correct: String(raw).trim() === String(correct).trim() };
  if (q.type === 'multi') {
    const a = (Array.isArray(raw) ? raw : [raw]).slice().sort().join(',');
    const c = (Array.isArray(correct) ? correct : String(correct).split(',')).slice().sort().join(',');
    return { is_correct: a === c };
  }
  if (q.type === 'tf') {
    const c = typeof correct === 'object' ? correct : {};
    const a = raw || {};
    const keys = Object.keys(c);
    if (keys.length === 0) return { is_correct: null };
    return { is_correct: keys.every((k) => a[k] === c[k]) };
  }
  if (q.type === 'fill') {
    if (Array.isArray(correct)) {
      const a = Array.isArray(raw) ? raw : [raw];
      return { is_correct: correct.every((c, i) => norm(a[i]) === norm(c)) };
    }
    return { is_correct: norm(raw) === norm(correct) };
  }
  // matching / short — no reliable auto-grade
  return { is_correct: null };
}

/* ---------- rendering (built once; small UI pieces update in place) ---------- */

function render() {
  app.innerHTML = `
    <header class="bg-white border-b border-slate-200 sticky top-0 z-30">
      <div class="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between gap-3">
        <div class="flex items-center gap-3 min-w-0">
          <a href="/" class="w-9 h-9 bg-blue-600 text-white rounded grid place-items-center font-bold text-sm">EL</a>
          <div class="min-w-0">
            <div class="text-xs text-slate-500 truncate">${escapeHtml(state.exam?.title ?? '')}</div>
            <div class="font-semibold truncate">Mark attempt #${state.attempt.id} ${statusChip(state.attempt.status)}</div>
          </div>
        </div>
        <div class="flex items-center gap-2 flex-wrap justify-end">
          <div class="text-sm">
            Score: <b id="total-score">0.00</b> <span class="text-slate-400">/</span> <span id="total-max">0.00</span>
            <span id="total-pct" class="text-slate-500 text-xs ml-1"></span>
            <span id="dirty-flag" class="ml-2 text-xs text-amber-600 hidden"><i class="fas fa-circle text-[6px] mr-1"></i>unsaved</span>
          </div>
          <button id="clear-all-btn" class="px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 rounded-md text-sm" title="Clear every grade on this page (doesn't save until you click Save)">
            <i class="fas fa-eraser mr-1"></i> Clear all
          </button>
          <button id="full-all-btn" class="px-3 py-2 bg-white border border-emerald-300 text-emerald-700 hover:bg-emerald-50 rounded-md text-sm" title="Mark every question Correct with full points">
            <i class="fas fa-check-double mr-1"></i> All correct
          </button>
          <a href="/attempts/${state.attempt.id}/take" class="px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 rounded-md text-sm">
            <i class="fas fa-eye mr-1"></i> View
          </a>
          <button id="reopen-btn" class="px-3 py-2 bg-white border border-amber-300 text-amber-700 hover:bg-amber-50 rounded-md text-sm">
            <i class="fas fa-unlock mr-1"></i> Reopen
          </button>
          <button id="save-btn" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-sm font-semibold">
            <i class="fas fa-save mr-1"></i> Save marks
          </button>
        </div>
      </div>
    </header>
    <main class="max-w-6xl mx-auto p-6 space-y-4 pb-24">
      ${state.questions.map((q) => markBlock(q)).join('')}
    </main>
    <div class="fixed bottom-4 right-4 z-40">
      <button id="save-btn-sticky" class="px-5 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full shadow-lg text-sm font-semibold">
        <i class="fas fa-save mr-1"></i> Save marks
      </button>
    </div>`;
  bind();
  updateTotals();
  renderMath(app);
}

function markBlock(q) {
  const g = state.grades[q.id];
  const ans = state.answers[q.id]?.raw;
  const correct = q.correct_answer ? safeJson(q.correct_answer) : null;
  const autoBadge = g.auto
    ? `<span class="text-xs px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full">auto-suggested</span>`
    : '';
  // Image questions: the question IS the image, no stored correct answer — pure manual grade.
  const stem = q.type === 'image' && q.data?.image_url
    ? `<div class="flex-1"><img src="${q.data.image_url}" alt="Question ${q.number}" class="max-w-full h-auto rounded border border-slate-200" /></div>`
    : `<div class="flex-1"><div class="exam-body text-slate-800">${escapeHtml(q.body)}</div></div>`;
  const showCorrectPanel = q.type !== 'image';
  return `
    <section class="exam-card p-5" data-q="${q.id}">
      <div class="flex items-start gap-3 mb-3">
        <div class="w-8 h-8 bg-slate-800 text-white rounded-md grid place-items-center font-bold shrink-0 text-sm">${q.number}</div>
        ${stem}
        <div class="text-xs text-slate-500 shrink-0">${q.points} pt${q.points === 1 ? '' : 's'}</div>
      </div>
      <div class="grid ${showCorrectPanel ? 'md:grid-cols-2' : 'grid-cols-1'} gap-4">
        <div>
          <div class="text-xs font-semibold text-slate-500 mb-1">Candidate's answer</div>
          <div class="p-3 bg-slate-50 rounded border border-slate-200 text-sm min-h-[60px] whitespace-pre-wrap">${formatAnswer(q, ans)}</div>
        </div>
        ${showCorrectPanel ? `
          <div>
            <div class="text-xs font-semibold text-slate-500 mb-1">Correct answer</div>
            <div class="p-3 bg-emerald-50 rounded border border-emerald-200 text-sm min-h-[60px] whitespace-pre-wrap">${formatAnswer(q, correct) || '<span class="text-slate-400">(none set — mark by hand)</span>'}</div>
          </div>` : ''}
      </div>
      <div class="mt-4 grid gap-3 items-center" style="grid-template-columns: auto auto auto 1fr auto;">
        <div class="flex items-center gap-2 text-sm">
          <button type="button" data-verdict-correct="${q.id}"
            class="px-3 py-1.5 rounded-md border text-sm font-medium transition
              ${g.is_correct === true ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-emerald-700 border-emerald-300 hover:bg-emerald-50'}">
            <i class="fas fa-check mr-1"></i>Correct
          </button>
          <button type="button" data-verdict-wrong="${q.id}"
            class="px-3 py-1.5 rounded-md border text-sm font-medium transition
              ${g.is_correct === false ? 'bg-red-600 text-white border-red-600' : 'bg-white text-red-700 border-red-300 hover:bg-red-50'}">
            <i class="fas fa-times mr-1"></i>Wrong
          </button>
          <button type="button" data-verdict-clear="${q.id}"
            class="px-3 py-1.5 rounded-md border text-sm transition
              ${g.is_correct === null ? 'bg-slate-200 text-slate-700 border-slate-300' : 'bg-white text-slate-500 border-slate-300 hover:bg-slate-50'}">
            <i class="fas fa-circle-dot mr-1"></i>Unmarked
          </button>
        </div>
        <label class="text-sm flex items-center gap-2 whitespace-nowrap">Score:
          <input type="number" step="0.25" min="0" max="${q.points}" value="${formatNum(g.score_awarded)}"
            data-score="${q.id}" class="w-20 border border-slate-300 rounded px-2 py-1" />
          <span class="text-slate-400 text-xs">/ ${q.points}</span>
        </label>
        <div class="flex items-center gap-1">
          <button type="button" data-full="${q.id}" class="text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-50" title="Full points">Full</button>
          <button type="button" data-half="${q.id}" class="text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-50" title="Half points">½</button>
          <button type="button" data-zero="${q.id}" class="text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-50" title="Zero">0</button>
        </div>
        <input type="text" placeholder="Note (optional, just for you)" value="${escapeHtml(g.marker_note || '')}"
          data-note="${q.id}" class="border border-slate-300 rounded px-2 py-1 text-sm" />
        <div>${autoBadge}</div>
      </div>
    </section>`;
}

function formatNum(n) {
  const num = Number(n ?? 0);
  return Number.isInteger(num) ? String(num) : String(num);
}

function formatAnswer(q, v) {
  if (v == null || v === '') return '<span class="text-slate-400">(no answer)</span>';
  if (q.type === 'image' || q.type === 'short') {
    return escapeHtml(v);
  }
  if (q.type === 'mcq') {
    const opt = (q.data?.options || []).find((o) => o.key === v);
    return `<b>${escapeHtml(v)}.</b> ${opt ? escapeHtml(opt.text) : ''}`;
  }
  if (q.type === 'multi') {
    const arr = Array.isArray(v) ? v : [v];
    return arr.map((k) => `<b>${escapeHtml(k)}.</b> ${escapeHtml((q.data?.options || []).find((o) => o.key === k)?.text || '')}`).join('<br>');
  }
  if (q.type === 'tf') {
    const o = typeof v === 'object' ? v : {};
    return (q.data?.statements || []).map((s) =>
      `<div><b>${escapeHtml(s.key)}.</b> ${escapeHtml(s.text)} → <b class="${o[s.key] === true ? 'text-emerald-700' : o[s.key] === false ? 'text-red-700' : 'text-slate-400'}">${o[s.key] === true ? 'Đúng' : o[s.key] === false ? 'Sai' : '—'}</b></div>`
    ).join('');
  }
  if (q.type === 'matching') {
    const o = typeof v === 'object' ? v : {};
    return Object.entries(o).map(([l, r]) => `${escapeHtml(l)} → ${escapeHtml(r)}`).join('<br>');
  }
  if (Array.isArray(v)) return v.map(escapeHtml).join(' | ');
  return escapeHtml(v);
}

/* ---------- in-place updates ---------- */

function markDirty() {
  state.dirty = true;
  const el = document.getElementById('dirty-flag');
  if (el) el.classList.remove('hidden');
}

function updateTotals() {
  const max = state.questions.reduce((s, q) => s + (q.points || 0), 0);
  const score = Object.values(state.grades).reduce((s, g) => s + (Number(g.score_awarded) || 0), 0);
  const scoreEl = document.getElementById('total-score');
  const maxEl = document.getElementById('total-max');
  const pctEl = document.getElementById('total-pct');
  if (scoreEl) scoreEl.textContent = score.toFixed(2);
  if (maxEl) maxEl.textContent = max.toFixed(2);
  if (pctEl) pctEl.textContent = max > 0 ? `(${Math.round((score / max) * 100)}%)` : '';
}

/** Refresh one question's verdict buttons and auto-badge in place (no full re-render). */
function refreshVerdict(qid) {
  const g = state.grades[qid];
  const section = document.querySelector(`[data-q="${qid}"]`);
  if (!section) return;
  const btnC = section.querySelector(`[data-verdict-correct="${qid}"]`);
  const btnW = section.querySelector(`[data-verdict-wrong="${qid}"]`);
  const btnU = section.querySelector(`[data-verdict-clear="${qid}"]`);
  // reset classes
  btnC.className = 'px-3 py-1.5 rounded-md border text-sm font-medium transition ' +
    (g.is_correct === true ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-emerald-700 border-emerald-300 hover:bg-emerald-50');
  btnW.className = 'px-3 py-1.5 rounded-md border text-sm font-medium transition ' +
    (g.is_correct === false ? 'bg-red-600 text-white border-red-600' : 'bg-white text-red-700 border-red-300 hover:bg-red-50');
  btnU.className = 'px-3 py-1.5 rounded-md border text-sm transition ' +
    (g.is_correct === null ? 'bg-slate-200 text-slate-700 border-slate-300' : 'bg-white text-slate-500 border-slate-300 hover:bg-slate-50');
  // auto-badge disappears once touched
  if (!g.auto) {
    const badge = section.querySelector('.bg-slate-100.text-slate-500.rounded-full');
    if (badge) badge.remove();
  }
}

function setScoreInput(qid, value) {
  const el = document.querySelector(`input[data-score="${qid}"]`);
  if (el) el.value = formatNum(value);
}

/* ---------- bindings ---------- */

function bind() {
  // Verdict buttons: Correct / Wrong / Unmarked
  app.querySelectorAll('[data-verdict-correct]').forEach((b) =>
    b.addEventListener('click', () => setVerdict(Number(b.dataset.verdictCorrect), true))
  );
  app.querySelectorAll('[data-verdict-wrong]').forEach((b) =>
    b.addEventListener('click', () => setVerdict(Number(b.dataset.verdictWrong), false))
  );
  app.querySelectorAll('[data-verdict-clear]').forEach((b) =>
    b.addEventListener('click', () => setVerdict(Number(b.dataset.verdictClear), null))
  );

  // Score input — does NOT re-render, just updates state + totals.
  // IMPORTANT: typing in the score box no longer flips the verdict radio.
  //            → you can set "Correct but 0.5 pts", "Wrong but 0.25 pts", etc.
  app.querySelectorAll('input[data-score]').forEach((el) => {
    el.addEventListener('input', (e) => {
      const qid = Number(e.target.dataset.score);
      state.grades[qid].score_awarded = Number(e.target.value || 0);
      state.grades[qid].auto = false;
      markDirty();
      updateTotals();
    });
  });

  // Quick-fill score chips
  app.querySelectorAll('[data-full]').forEach((b) =>
    b.addEventListener('click', () => setScore(Number(b.dataset.full), questionById(Number(b.dataset.full)).points))
  );
  app.querySelectorAll('[data-half]').forEach((b) =>
    b.addEventListener('click', () => setScore(Number(b.dataset.half), questionById(Number(b.dataset.half)).points / 2))
  );
  app.querySelectorAll('[data-zero]').forEach((b) =>
    b.addEventListener('click', () => setScore(Number(b.dataset.zero), 0))
  );

  // Notes
  app.querySelectorAll('input[data-note]').forEach((el) => {
    el.addEventListener('input', (e) => {
      const qid = Number(e.target.dataset.note);
      state.grades[qid].marker_note = e.target.value;
      state.grades[qid].auto = false;
      markDirty();
    });
  });

  // Bulk actions
  document.getElementById('clear-all-btn').addEventListener('click', () => {
    if (!confirm('Clear all grades on this page? (Not saved until you click Save marks.)')) return;
    for (const q of state.questions) {
      state.grades[q.id].is_correct = null;
      state.grades[q.id].score_awarded = 0;
      state.grades[q.id].auto = false;
      refreshVerdict(q.id);
      setScoreInput(q.id, 0);
    }
    markDirty();
    updateTotals();
  });
  document.getElementById('full-all-btn').addEventListener('click', () => {
    if (!confirm('Mark every question Correct with full points?')) return;
    for (const q of state.questions) {
      state.grades[q.id].is_correct = true;
      state.grades[q.id].score_awarded = q.points;
      state.grades[q.id].auto = false;
      refreshVerdict(q.id);
      setScoreInput(q.id, q.points);
    }
    markDirty();
    updateTotals();
  });

  // Save (two buttons — header + sticky)
  document.getElementById('save-btn').addEventListener('click', saveMarks);
  document.getElementById('save-btn-sticky').addEventListener('click', saveMarks);

  // Reopen
  document.getElementById('reopen-btn').addEventListener('click', async () => {
    if (!confirm('Reopen attempt for editing? This will clear the current marks (on the server).')) return;
    await api.post(`/api/attempts/${attemptId}/reopen`, {});
    location.href = `/attempts/${attemptId}/take`;
  });

  // Warn before leaving if unsaved
  window.addEventListener('beforeunload', (e) => {
    if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
  });
}

function questionById(qid) { return state.questions.find((q) => q.id === qid); }

function setVerdict(qid, verdict) {
  const g = state.grades[qid];
  const q = questionById(qid);
  g.is_correct = verdict;
  g.auto = false;
  // Suggest a score ONLY if the user hasn't typed a custom one yet
  // (we detect that via g.auto before this click; after, keep the user's score).
  // Simpler rule: Correct → full; Wrong → 0; Unmarked → 0. You can still override.
  if (verdict === true)  g.score_awarded = q.points;
  else if (verdict === false) g.score_awarded = 0;
  else g.score_awarded = 0;
  refreshVerdict(qid);
  setScoreInput(qid, g.score_awarded);
  markDirty();
  updateTotals();
}

function setScore(qid, value) {
  state.grades[qid].score_awarded = value;
  state.grades[qid].auto = false;
  // If a positive partial score is set and no verdict is picked, call it Correct by convention.
  // User can override by clicking Wrong/Unmarked.
  setScoreInput(qid, value);
  markDirty();
  updateTotals();
}

async function saveMarks() {
  const grades = Object.entries(state.grades).map(([qid, g]) => ({
    question_id: Number(qid),
    is_correct: g.is_correct,
    score_awarded: Number(g.score_awarded) || 0,
    marker_note: g.marker_note || null,
  }));
  const res = await api.post(`/api/attempts/${attemptId}/mark`, { grades });
  state.dirty = false;
  const el = document.getElementById('dirty-flag');
  if (el) el.classList.add('hidden');
  // Flash a confirmation instead of alert()
  flash(`Saved. Score: ${res.score} / ${res.max_score}`);
}

function flash(msg) {
  const el = document.createElement('div');
  el.className = 'fixed bottom-20 right-4 z-50 bg-slate-800 text-white text-sm px-4 py-2 rounded-lg shadow-lg';
  el.innerHTML = `<i class="fas fa-check-circle mr-2 text-emerald-400"></i>${escapeHtml(msg)}`;
  document.body.appendChild(el);
  setTimeout(() => el.style.opacity = '0', 1500);
  setTimeout(() => el.remove(), 2000);
}

load();
