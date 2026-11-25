import { api, renderMath, escapeHtml, statusChip } from '/static/common.js';

const app = document.getElementById('app');
const attemptId = Number(app.dataset.attemptId);

let state = { attempt: null, exam: null, questions: [], answers: {}, grades: {} };

async function load() {
  const { attempt, answers } = await api.get(`/api/attempts/${attemptId}`);
  state.attempt = attempt;
  const { exam, questions } = await api.get(`/api/exams/${attempt.exam_id}`);
  state.exam = exam;
  state.questions = questions.map((q) => ({ ...q, data: safeJson(q.data) }));
  for (const a of answers) {
    state.answers[a.question_id] = { raw: a.answer == null ? null : safeJson(a.answer), is_correct: a.is_correct, score_awarded: a.score_awarded, marker_note: a.marker_note };
  }
  autoSuggest();
  render();
}

function safeJson(s) { try { return JSON.parse(s); } catch { return s; } }

function autoSuggest() {
  // Pre-fill grades by comparing with correct_answer where possible
  for (const q of state.questions) {
    const ans = state.answers[q.id];
    if (!ans) { state.grades[q.id] = { is_correct: null, score_awarded: 0, marker_note: '' }; continue; }
    const correct = q.correct_answer ? safeJson(q.correct_answer) : null;
    let isCorrect = null;
    if (correct != null) {
      if (q.type === 'mcq') {
        isCorrect = String(ans.raw).trim() === String(correct).trim();
      } else if (q.type === 'tf') {
        const c = typeof correct === 'object' ? correct : {};
        const a = ans.raw || {};
        isCorrect = Object.keys(c).every((k) => a[k] === c[k]);
      } else if (q.type === 'multi') {
        const a = (ans.raw || []).slice().sort().join(',');
        const c = (Array.isArray(correct) ? correct : String(correct).split(',')).slice().sort().join(',');
        isCorrect = a === c;
      } else if (q.type === 'fill') {
        const norm = (s) => String(s ?? '').trim().toLowerCase();
        if (Array.isArray(correct)) {
          const a = Array.isArray(ans.raw) ? ans.raw : [ans.raw];
          isCorrect = correct.every((c, i) => norm(a[i]) === norm(c));
        } else {
          isCorrect = norm(ans.raw) === norm(correct);
        }
      }
    }
    const existing = { is_correct: ans.is_correct, score_awarded: ans.score_awarded, marker_note: ans.marker_note || '' };
    state.grades[q.id] = existing.is_correct != null
      ? { is_correct: !!existing.is_correct, score_awarded: existing.score_awarded ?? (existing.is_correct ? q.points : 0), marker_note: existing.marker_note }
      : { is_correct: isCorrect, score_awarded: isCorrect === null ? 0 : (isCorrect ? q.points : 0), marker_note: '' };
  }
}

function render() {
  const totals = computeTotals();
  app.innerHTML = `
    <header class="bg-white border-b border-slate-200">
      <div class="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <a href="/" class="w-9 h-9 bg-blue-600 text-white rounded grid place-items-center font-bold text-sm">EL</a>
          <div>
            <div class="text-xs text-slate-500">${escapeHtml(state.exam?.title ?? '')}</div>
            <div class="font-semibold">Mark attempt #${state.attempt.id} ${statusChip(state.attempt.status)}</div>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <div class="text-sm">Score: <b>${totals.score.toFixed(2)}</b> / ${totals.max.toFixed(2)}</div>
          <a href="/attempts/${state.attempt.id}/take" class="px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 rounded-md text-sm">
            <i class="fas fa-eye mr-1"></i> View answers
          </a>
          <button id="reopen-btn" class="px-3 py-2 bg-white border border-amber-300 text-amber-700 hover:bg-amber-50 rounded-md text-sm">
            <i class="fas fa-unlock mr-1"></i> Reopen
          </button>
          <button id="save-btn" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-sm font-semibold">
            <i class="fas fa-check-double mr-1"></i> Save marks
          </button>
        </div>
      </div>
    </header>
    <main class="max-w-6xl mx-auto p-6 space-y-4">
      ${state.questions.map((q) => markBlock(q)).join('')}
    </main>`;
  bind();
  renderMath(app);
}

function computeTotals() {
  const max = state.questions.reduce((s, q) => s + (q.points || 0), 0);
  const score = Object.values(state.grades).reduce((s, g) => s + (Number(g.score_awarded) || 0), 0);
  return { score, max };
}

function markBlock(q) {
  const g = state.grades[q.id];
  const ans = state.answers[q.id]?.raw;
  const correct = q.correct_answer ? safeJson(q.correct_answer) : null;
  return `
    <section class="exam-card p-5">
      <div class="flex items-start gap-3 mb-3">
        <div class="w-8 h-8 bg-slate-800 text-white rounded-md grid place-items-center font-bold shrink-0 text-sm">${q.number}</div>
        <div class="flex-1">
          <div class="exam-body text-slate-800">${escapeHtml(q.body)}</div>
        </div>
        <div class="text-xs text-slate-500">${q.points} pt${q.points === 1 ? '' : 's'}</div>
      </div>
      <div class="grid md:grid-cols-2 gap-4">
        <div>
          <div class="text-xs font-semibold text-slate-500 mb-1">Candidate's answer</div>
          <div class="p-3 bg-slate-50 rounded border border-slate-200 text-sm min-h-[60px] whitespace-pre-wrap">${formatAnswer(q, ans)}</div>
        </div>
        <div>
          <div class="text-xs font-semibold text-slate-500 mb-1">Correct answer</div>
          <div class="p-3 bg-emerald-50 rounded border border-emerald-200 text-sm min-h-[60px] whitespace-pre-wrap">${formatAnswer(q, correct) || '<span class="text-slate-400">(none set)</span>'}</div>
        </div>
      </div>
      <div class="mt-4 flex items-center gap-3 flex-wrap">
        <div class="flex items-center gap-2 text-sm">
          <label class="flex items-center gap-1"><input type="radio" name="g-${q.id}" value="true"  ${g.is_correct === true  ? 'checked' : ''}/> <span class="text-emerald-700">Correct</span></label>
          <label class="flex items-center gap-1"><input type="radio" name="g-${q.id}" value="false" ${g.is_correct === false ? 'checked' : ''}/> <span class="text-red-700">Wrong</span></label>
          <label class="flex items-center gap-1"><input type="radio" name="g-${q.id}" value="null"  ${g.is_correct === null  ? 'checked' : ''}/> <span class="text-slate-500">Unmarked</span></label>
        </div>
        <label class="text-sm flex items-center gap-2">Score:
          <input type="number" step="0.25" min="0" max="${q.points}" value="${g.score_awarded ?? 0}" data-score="${q.id}" class="w-20 border border-slate-300 rounded px-2 py-1" />
          <span class="text-slate-400 text-xs">/ ${q.points}</span>
        </label>
        <input type="text" placeholder="Note (optional)" value="${escapeHtml(g.marker_note || '')}" data-note="${q.id}" class="flex-1 min-w-[180px] border border-slate-300 rounded px-2 py-1 text-sm" />
      </div>
    </section>`;
}

function formatAnswer(q, v) {
  if (v == null || v === '') return '<span class="text-slate-400">(no answer)</span>';
  if (q.type === 'mcq') {
    const opt = (q.data?.options || []).find((o) => o.key === v);
    return `${escapeHtml(v)}. ${opt ? escapeHtml(opt.text) : ''}`;
  }
  if (q.type === 'multi') {
    const arr = Array.isArray(v) ? v : [v];
    return arr.map((k) => `${escapeHtml(k)}. ${escapeHtml((q.data?.options || []).find((o) => o.key === k)?.text || '')}`).join('<br>');
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

function bind() {
  app.querySelectorAll('input[type="radio"][name^="g-"]').forEach((el) => {
    el.addEventListener('change', (e) => {
      const qid = Number(e.target.name.replace('g-', ''));
      const val = e.target.value;
      const q = state.questions.find((x) => x.id === qid);
      const g = state.grades[qid];
      if (val === 'true') { g.is_correct = true;  g.score_awarded = q.points; }
      else if (val === 'false') { g.is_correct = false; g.score_awarded = 0; }
      else { g.is_correct = null; g.score_awarded = 0; }
      render();
    });
  });
  app.querySelectorAll('input[data-score]').forEach((el) => {
    el.addEventListener('change', (e) => {
      const qid = Number(e.target.dataset.score);
      state.grades[qid].score_awarded = Number(e.target.value || 0);
      render();
    });
  });
  app.querySelectorAll('input[data-note]').forEach((el) => {
    el.addEventListener('input', (e) => {
      const qid = Number(e.target.dataset.note);
      state.grades[qid].marker_note = e.target.value;
    });
  });
  document.getElementById('save-btn').addEventListener('click', saveMarks);
  document.getElementById('reopen-btn').addEventListener('click', async () => {
    if (!confirm('Reopen attempt for editing? This will clear the current marks.')) return;
    await api.post(`/api/attempts/${attemptId}/reopen`, {});
    location.href = `/attempts/${attemptId}/take`;
  });
}

async function saveMarks() {
  const grades = Object.entries(state.grades).map(([qid, g]) => ({
    question_id: Number(qid),
    is_correct: g.is_correct,
    score_awarded: Number(g.score_awarded) || 0,
    marker_note: g.marker_note || null,
  }));
  const res = await api.post(`/api/attempts/${attemptId}/mark`, { grades });
  alert(`Saved. Score: ${res.score} / ${res.max_score}`);
  load();
}

load();
