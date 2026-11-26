import { Hono } from 'hono'
import type { Bindings, QuestionRow, AttemptRow, AnswerRow, ExamRow } from '../types'

const api = new Hono<{ Bindings: Bindings }>()

/* ---------- Uploads (R2) ---------- */

// Upload one image (raw bytes) → returns the public URL under /uploads/<key>
// We accept raw bytes (not multipart) so the client can stream canvas-rendered
// PNG/JPEG blobs directly with a single fetch + arrayBuffer.
api.post('/uploads', async (c) => {
  const contentType = c.req.header('content-type') || 'application/octet-stream'
  const ext = contentType.includes('png') ? 'png'
            : contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg'
            : contentType.includes('webp') ? 'webp'
            : 'bin'
  // Random, collision-resistant key under `uploads/YYYY/MM/<rand>.<ext>`
  const now = new Date()
  // Key is relative to the bucket — no leading "uploads/" so the public URL doesn't double-nest.
  const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.${ext}`
  const body = await c.req.arrayBuffer()
  if (!body || body.byteLength === 0) return c.json({ error: 'empty body' }, 400)
  if (body.byteLength > 10 * 1024 * 1024) return c.json({ error: 'file too large (>10MB)' }, 413)
  await c.env.R2.put(key, body, { httpMetadata: { contentType } })
  return c.json({ key, url: `/uploads/${key}`, size: body.byteLength, contentType })
})

/* ---------- Exams ---------- */

api.get('/exams', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT e.*,
       (SELECT COUNT(*) FROM questions q WHERE q.exam_id = e.id) AS question_count,
       (SELECT COUNT(*) FROM attempts a WHERE a.exam_id = e.id) AS attempt_count,
       (SELECT COUNT(*) FROM attempts a WHERE a.exam_id = e.id AND a.status = 'in_progress') AS in_progress_count,
       (SELECT MAX(id) FROM attempts a WHERE a.exam_id = e.id AND a.status = 'in_progress') AS resume_attempt_id,
       (SELECT MAX(a.score) FROM attempts a WHERE a.exam_id = e.id AND a.status = 'marked') AS best_score,
       (SELECT a.max_score FROM attempts a WHERE a.exam_id = e.id AND a.status = 'marked'
          ORDER BY a.score DESC, a.marked_at DESC LIMIT 1) AS best_max_score,
       (SELECT a.marked_at FROM attempts a WHERE a.exam_id = e.id AND a.status = 'marked'
          ORDER BY a.score DESC, a.marked_at DESC LIMIT 1) AS best_marked_at
     FROM exams e ORDER BY e.id DESC`
  ).all()
  return c.json({ exams: results })
})

api.post('/exams', async (c) => {
  const { title, description, duration_minutes, source_pdf_name } = await c.req.json<any>()
  if (!title) return c.json({ error: 'title required' }, 400)
  const res = await c.env.DB.prepare(
    `INSERT INTO exams (title, description, duration_minutes, source_pdf_name)
     VALUES (?, ?, ?, ?)`
  )
    .bind(title, description ?? null, duration_minutes ?? 60, source_pdf_name ?? null)
    .run()
  return c.json({ id: res.meta.last_row_id })
})

api.get('/exams/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const exam = await c.env.DB.prepare('SELECT * FROM exams WHERE id = ?').bind(id).first<ExamRow>()
  if (!exam) return c.json({ error: 'not found' }, 404)
  const { results: questions } = await c.env.DB.prepare(
    'SELECT * FROM questions WHERE exam_id = ? ORDER BY number ASC'
  )
    .bind(id)
    .all<QuestionRow>()
  const { results: sections } = await c.env.DB.prepare(
    'SELECT * FROM sections WHERE exam_id = ? ORDER BY position ASC'
  )
    .bind(id)
    .all()
  return c.json({ exam, sections, questions })
})

api.delete('/exams/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare('DELETE FROM exams WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

/* ---------- Questions ---------- */

api.post('/exams/:id/questions', async (c) => {
  const examId = Number(c.req.param('id'))
  const body = await c.req.json<any>()
  const questions = Array.isArray(body) ? body : [body]
  const stmt = c.env.DB.prepare(
    `INSERT INTO questions (exam_id, section_id, number, type, body, data, correct_answer, points, explanation)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const batch = questions.map((q) =>
    stmt.bind(
      examId,
      q.section_id ?? null,
      q.number,
      q.type,
      q.body,
      typeof q.data === 'string' ? q.data : JSON.stringify(q.data ?? {}),
      q.correct_answer ?? null,
      q.points ?? 1,
      q.explanation ?? null
    )
  )
  await c.env.DB.batch(batch)
  return c.json({ ok: true, inserted: batch.length })
})

api.put('/questions/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const q = await c.req.json<any>()
  await c.env.DB.prepare(
    `UPDATE questions SET number=?, type=?, body=?, data=?, correct_answer=?, points=?, explanation=? WHERE id=?`
  )
    .bind(
      q.number,
      q.type,
      q.body,
      typeof q.data === 'string' ? q.data : JSON.stringify(q.data ?? {}),
      q.correct_answer ?? null,
      q.points ?? 1,
      q.explanation ?? null,
      id
    )
    .run()
  return c.json({ ok: true })
})

api.delete('/questions/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare('DELETE FROM questions WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

/* ---------- Attempts ---------- */

api.get('/exams/:id/attempts', async (c) => {
  const examId = Number(c.req.param('id'))
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM attempts WHERE exam_id = ? ORDER BY started_at DESC'
  )
    .bind(examId)
    .all()
  return c.json({ attempts: results })
})

api.post('/exams/:id/attempts', async (c) => {
  const examId = Number(c.req.param('id'))
  const { candidate_name } = await c.req.json<any>().catch(() => ({}))
  const res = await c.env.DB.prepare(
    `INSERT INTO attempts (exam_id, candidate_name) VALUES (?, ?)`
  )
    .bind(examId, candidate_name ?? null)
    .run()
  return c.json({ id: res.meta.last_row_id })
})

api.get('/attempts/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const attempt = await c.env.DB.prepare('SELECT * FROM attempts WHERE id = ?')
    .bind(id)
    .first<AttemptRow>()
  if (!attempt) return c.json({ error: 'not found' }, 404)
  const { results: answers } = await c.env.DB.prepare(
    'SELECT * FROM answers WHERE attempt_id = ?'
  )
    .bind(id)
    .all<AnswerRow>()
  return c.json({ attempt, answers })
})

api.delete('/attempts/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare('DELETE FROM attempts WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

/* ---------- Answers (save/upsert; blocked if attempt is submitted) ---------- */

api.put('/attempts/:id/answers/:qid', async (c) => {
  const attemptId = Number(c.req.param('id'))
  const qid = Number(c.req.param('qid'))
  const body = await c.req.json<any>()
  const attempt = await c.env.DB.prepare('SELECT * FROM attempts WHERE id = ?')
    .bind(attemptId)
    .first<AttemptRow>()
  if (!attempt) return c.json({ error: 'attempt not found' }, 404)
  if (attempt.status !== 'in_progress') {
    return c.json({ error: 'attempt is locked (submitted / marked)' }, 409)
  }
  const payload =
    typeof body.answer === 'string' ? body.answer : JSON.stringify(body.answer ?? null)
  await c.env.DB.prepare(
    `INSERT INTO answers (attempt_id, question_id, answer, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(attempt_id, question_id)
     DO UPDATE SET answer = excluded.answer, updated_at = CURRENT_TIMESTAMP`
  )
    .bind(attemptId, qid, payload)
    .run()
  return c.json({ ok: true })
})

/* ---------- Submit / lock ---------- */

api.post('/attempts/:id/submit', async (c) => {
  const id = Number(c.req.param('id'))
  const { time_spent_seconds } = await c.req.json<any>().catch(() => ({}))
  await c.env.DB.prepare(
    `UPDATE attempts SET status='submitted', submitted_at=CURRENT_TIMESTAMP,
       time_spent_seconds=COALESCE(?, time_spent_seconds)
     WHERE id=? AND status='in_progress'`
  )
    .bind(time_spent_seconds ?? null, id)
    .run()
  return c.json({ ok: true })
})

// Pause = snapshot elapsed time to server so the next resume continues from there.
// Status stays 'in_progress' so answers remain editable on resume.
api.post('/attempts/:id/pause', async (c) => {
  const id = Number(c.req.param('id'))
  const { time_spent_seconds } = await c.req.json<any>().catch(() => ({}))
  await c.env.DB.prepare(
    `UPDATE attempts SET time_spent_seconds = COALESCE(?, time_spent_seconds)
     WHERE id = ? AND status = 'in_progress'`
  )
    .bind(time_spent_seconds ?? null, id)
    .run()
  return c.json({ ok: true })
})

api.post('/attempts/:id/reopen', async (c) => {
  // allow re-editing (manual override)
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare(
    `UPDATE attempts SET status='in_progress', submitted_at=NULL, marked_at=NULL,
       score=NULL, max_score=NULL WHERE id=?`
  )
    .bind(id)
    .run()
  return c.json({ ok: true })
})

/* ---------- Marking (manual + auto-suggest) ---------- */

api.post('/attempts/:id/mark', async (c) => {
  const attemptId = Number(c.req.param('id'))
  const body = await c.req.json<any>().catch(() => ({} as any))
  // body = { grades: [ { question_id, is_correct, score_awarded, marker_note } ] }
  const grades: Array<{
    question_id: number
    is_correct: boolean | null
    score_awarded: number | null
    marker_note?: string | null
  }> = body.grades ?? []

  if (grades.length > 0) {
    const stmt = c.env.DB.prepare(
      `UPDATE answers SET is_correct=?, score_awarded=?, marker_note=?
       WHERE attempt_id=? AND question_id=?`
    )
    await c.env.DB.batch(
      grades.map((g) =>
        stmt.bind(
          g.is_correct === null ? null : g.is_correct ? 1 : 0,
          g.score_awarded ?? null,
          g.marker_note ?? null,
          attemptId,
          g.question_id
        )
      )
    )
  }

  // Recompute totals
  const totals = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(a.score_awarded),0) AS score,
            (SELECT COALESCE(SUM(points),0) FROM questions q
               WHERE q.exam_id = (SELECT exam_id FROM attempts WHERE id=?)) AS max_score
     FROM answers a WHERE a.attempt_id=?`
  )
    .bind(attemptId, attemptId)
    .first<{ score: number; max_score: number }>()

  await c.env.DB.prepare(
    `UPDATE attempts SET status='marked', marked_at=CURRENT_TIMESTAMP,
       score=?, max_score=? WHERE id=?`
  )
    .bind(totals?.score ?? 0, totals?.max_score ?? 0, attemptId)
    .run()

  return c.json({ ok: true, score: totals?.score, max_score: totals?.max_score })
})

export default api
