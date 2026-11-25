import { api, statusChip, escapeHtml } from '/static/common.js';

function formatScore(n) {
  const num = Number(n);
  return Number.isInteger(num) ? String(num) : num.toFixed(2);
}
function pct(score, max) {
  if (!max) return 0;
  return Math.round((Number(score) / Number(max)) * 100);
}

async function load() {
  const { exams } = await api.get('/api/exams');
  const list = document.getElementById('exam-list');
  if (!exams.length) {
    list.innerHTML = `
      <div class="exam-card p-8 text-center text-slate-500">
        <i class="fas fa-file-pdf text-3xl mb-3 text-slate-400"></i>
        <p>No exams yet. Click <b>New exam</b> to create one.</p>
      </div>`;
    return;
  }
  list.innerHTML = exams.map((e) => {
    // Best mark next to title (only when at least one attempt is marked)
    const best = (e.best_score != null && e.best_max_score != null)
      ? `<span class="chip chip-marked" title="Best mark across ${e.attempt_count} attempt${e.attempt_count === 1 ? '' : 's'}">
           <i class="fas fa-trophy"></i> ${formatScore(e.best_score)} / ${formatScore(e.best_max_score)} (${pct(e.best_score, e.best_max_score)}%)
         </span>` : '';
    const paused = e.in_progress_count > 0
      ? `<span class="chip chip-in-progress" title="You have an unfinished attempt"><i class="fas fa-pause"></i> ${e.in_progress_count} paused</span>` : '';
    const resumeBtn = e.resume_attempt_id
      ? `<a href="/attempts/${e.resume_attempt_id}/take" class="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-md text-sm font-medium">
           <i class="fas fa-play mr-1"></i> Resume
         </a>`
      : '';
    return `
    <div class="exam-card p-5 flex items-center justify-between gap-6">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-3 mb-1 flex-wrap">
          <h3 class="text-lg font-semibold text-slate-800 truncate">${escapeHtml(e.title)}</h3>
          ${best}
          ${paused}
        </div>
        <p class="text-sm text-slate-500 truncate">${escapeHtml(e.description ?? '')}</p>
        <p class="text-xs text-slate-400 mt-1">${e.question_count} questions · ${e.duration_minutes} min · ${e.attempt_count} attempt${e.attempt_count === 1 ? '' : 's'}</p>
      </div>
      <div class="flex items-center gap-2">
        ${resumeBtn}
        <button data-start="${e.id}" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium">
          <i class="fas fa-play mr-1"></i> ${e.resume_attempt_id ? 'New attempt' : 'Start'}
        </button>
        <a href="/exams/${e.id}/manage" class="bg-white border border-slate-300 hover:bg-slate-50 px-4 py-2 rounded-md text-sm font-medium">
          <i class="fas fa-pen mr-1"></i> Edit
        </a>
        <button data-attempts="${e.id}" class="bg-white border border-slate-300 hover:bg-slate-50 px-3 py-2 rounded-md text-sm" title="View all attempts">
          <i class="fas fa-list"></i>
        </button>
        <button data-del="${e.id}" class="text-slate-400 hover:text-red-500 px-2" title="Delete exam">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('[data-start]').forEach((b) =>
    b.addEventListener('click', async () => {
      const id = b.dataset.start;
      const { id: attemptId } = await api.post(`/api/exams/${id}/attempts`, {});
      location.href = `/attempts/${attemptId}/take`;
    })
  );
  list.querySelectorAll('[data-attempts]').forEach((b) =>
    b.addEventListener('click', async () => {
      const id = b.dataset.attempts;
      const { attempts } = await api.get(`/api/exams/${id}/attempts`);
      showAttemptsModal(attempts);
    })
  );
  list.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Delete this exam and all its attempts?')) return;
      await api.del(`/api/exams/${b.dataset.del}`);
      load();
    })
  );
}

function showAttemptsModal(attempts) {
  const rows = attempts.length
    ? attempts.map((a) => `
        <tr class="border-t border-slate-200">
          <td class="p-2">#${a.id}</td>
          <td class="p-2">${statusChip(a.status)}</td>
          <td class="p-2 text-sm">${a.score != null ? `${a.score} / ${a.max_score}` : '—'}</td>
          <td class="p-2 text-xs text-slate-500">${a.started_at}</td>
          <td class="p-2 flex gap-2">
            <a href="/attempts/${a.id}/take" class="text-blue-600 hover:underline text-sm">Open</a>
            <a href="/attempts/${a.id}/mark" class="text-emerald-600 hover:underline text-sm">Mark</a>
            <button data-del-attempt="${a.id}" class="text-red-500 hover:underline text-sm">Delete</button>
          </td>
        </tr>`).join('')
    : `<tr><td colspan="5" class="p-4 text-center text-slate-500 text-sm">No attempts yet.</td></tr>`;
  const html = `
    <div class="fixed inset-0 bg-black/40 flex items-center justify-center z-50" id="modal">
      <div class="bg-white rounded-xl shadow-xl w-full max-w-2xl">
        <div class="flex items-center justify-between p-4 border-b border-slate-200">
          <h3 class="font-semibold">Attempts</h3>
          <button id="modal-close" class="text-slate-400 hover:text-slate-700"><i class="fas fa-times"></i></button>
        </div>
        <div class="p-4 overflow-auto max-h-[70vh]">
          <table class="w-full text-left">
            <thead class="text-xs text-slate-500">
              <tr><th class="p-2">ID</th><th class="p-2">Status</th><th class="p-2">Score</th><th class="p-2">Started</th><th class="p-2">Actions</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    </div>`;
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector('#modal-close').onclick = close;
  wrap.querySelector('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') close(); });
  wrap.querySelectorAll('[data-del-attempt]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Delete this attempt?')) return;
      await api.del(`/api/attempts/${b.dataset.delAttempt}`);
      close();
      load();
    })
  );
}

document.getElementById('new-exam-btn').addEventListener('click', async () => {
  const title = prompt('Exam title (e.g. "TSA Đề số 03"):');
  if (!title) return;
  const duration = Number(prompt('Duration in minutes:', '60') || '60');
  const { id } = await api.post('/api/exams', { title, duration_minutes: duration });
  location.href = `/exams/${id}/manage`;
});

load();
