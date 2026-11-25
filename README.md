# Exam Lab

A personal online exam platform inspired by the TSA (Vietnamese "Đánh giá Tư duy") exam interface. Lets you import questions from PDF, take exams with auto-save and pause/resume, then manually mark yourself and track best scores.

## 🌐 Live site

- **URL:** https://1319c18e-76db-420e-b6cb-0eef3671868b.vip.gensparksite.com
- **Passcode:** `momongauongnuocdua` (change via `gsk hosted secret_put --name APP_PASSCODE --value '<new>'`)
- **GitHub:** https://github.com/shio0zzz/luyen-thi-tsa

## Features

| Area | Feature |
|---|---|
| **Exams** | Create, edit, delete exams. Sections, questions, points per question |
| **Question types** | Multiple choice, multiple answers, True/False table (TSA-style), fill-in-the-blank, matching, short answer |
| **Import** | Drag a PDF → client-side extraction with PDF.js → heuristic parser detects `Câu 1.` / `Q1.` + `A. B. C. D.` options → preview dialog to review before saving |
| **Taking exams** | Sidebar question navigator, live timer, flag questions, auto-save on every change, math rendering (KaTeX) |
| **Pause & resume** | Click **Pause** → elapsed time is saved to the server; the exam shows **Resume** on the home page; timer picks up where you left off |
| **Edit while in progress** | Answers stay editable until you Submit |
| **Submit = lock** | After Submit, answers are read-only. **Reopen** button re-unlocks for editing and clears marks |
| **Manual marking** | Side-by-side candidate + correct answer; auto-suggests Correct/Wrong where a correct answer is set; per-question score + marker note; total score |
| **Best mark on home** | After marking, the best score for each exam shows next to the title as a chip (e.g. `🏆 3 / 5 (60%)`) |
| **Passcode gate** | Optional single-passcode login via the `APP_PASSCODE` secret. Leave unset ⇒ fully open (useful locally). Change anytime via one secret — no code changes |
| **Storage** | Cloudflare D1 (SQLite). Local SQLite in dev, real D1 on deploy |

## Tech stack

- Hono + Cloudflare Pages (edge runtime)
- D1 (SQLite) for persistence
- Vite build + Wrangler dev
- Tailwind CSS + Font Awesome via CDN
- KaTeX for math rendering
- PDF.js for in-browser PDF text extraction

## Project paths / URLs

| Path | What |
|---|---|
| `/` | Home — exam list, best scores, Resume button |
| `/exams/:id/manage` | Question editor + PDF import |
| `/attempts/:id/take` | Take exam (TSA-style UI) |
| `/attempts/:id/mark` | Manual marking view |
| `/login` | Passcode login (only when `APP_PASSCODE` is set) |
| `/api/exams` | List exams (includes `best_score`, `resume_attempt_id`, `in_progress_count`) |
| `/api/exams/:id` | Get an exam + its questions |
| `POST /api/exams` | Create exam `{ title, duration_minutes }` |
| `POST /api/exams/:id/questions` | Insert one question or an array |
| `PUT /api/questions/:id` | Update a question |
| `POST /api/exams/:id/attempts` | Start a new attempt |
| `GET /api/attempts/:id` | Attempt + answers |
| `PUT /api/attempts/:id/answers/:qid` | Save/update an answer. Returns 409 if attempt is locked |
| `POST /api/attempts/:id/pause` | Snapshot elapsed time |
| `POST /api/attempts/:id/submit` | Lock answers (status `submitted`) |
| `POST /api/attempts/:id/reopen` | Unlock for editing, clear marks |
| `POST /api/attempts/:id/mark` | Save grades `{ grades: [{question_id, is_correct, score_awarded, marker_note}] }` |

## Local development

```bash
# 1. Install deps (already done in Genspark sandbox)
npm install

# 2. Apply D1 migrations to the local SQLite
npx wrangler d1 migrations apply webapp-production --local

# 3. Seed sample questions (optional)
npx wrangler d1 execute webapp-production --local --file=./seed.sql

# 4. Build and run with PM2
npm run build
pm2 start ecosystem.config.cjs

# visit http://localhost:3000
```

### Enabling the passcode gate locally

Create `.dev.vars` (gitignored):

```
APP_PASSCODE=whatever-you-want
```

Restart the server. Unset the var to turn the gate off again.

## Changing the passcode in production

The passcode is a single Cloudflare secret called `APP_PASSCODE`.

- **BYOK (your own Cloudflare account):**
  ```bash
  npx wrangler pages secret put APP_PASSCODE --project-name <project>
  ```
  You'll be prompted for the value. Change it anytime by running the same command again.

- **Genspark Hosted deploy:** set/change the `APP_PASSCODE` environment variable in the project's Deploy → Secrets panel, then redeploy.

Unsetting the secret turns the gate off entirely (the login page becomes informational and lets you right in).

## Importing a PDF

1. Open an exam → **Edit**.
2. Click **Import PDF**, pick your file.
3. PDF.js extracts text in your browser (no upload to Cloudflare).
4. The parser splits by `Câu 1.`, `Câu 2.`, … or `1.`, `2.`, …
5. MCQ options `A. / B. / C. / D.` are auto-detected.
6. Vietnamese True/False sets (`a) / b) / c) / d)` + "Đúng/Sai") become a TF table question.
7. Review the preview dialog, edit/deselect, then **Import selected**.
8. Questions that didn't parse cleanly (e.g. the one with the cylindrical-coordinates image): add them manually in the editor.

## Deployment

Two deploy paths are available; both support D1. **Please pick one** — I'll walk you through either:

- **BYOK** — deploy to your own Cloudflare account (`*.pages.dev`). You own the resources.
- **Genspark Hosted** — deploy on Genspark's managed account (`*.vip.gensparksite.com`). No Cloudflare token needed.

## Data model

- `exams` — title, duration, description
- `sections` — optional groupings inside an exam
- `questions` — `type` ∈ {mcq, multi, tf, fill, matching, short}, `body`, `data` (JSON), `correct_answer`, `points`
- `attempts` — `status` ∈ {in_progress, submitted, marked}, `time_spent_seconds`, `score`, `max_score`
- `answers` — one row per (attempt, question): `answer` JSON, `is_correct`, `score_awarded`, `marker_note`
