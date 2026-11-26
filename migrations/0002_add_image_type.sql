-- Add 'image' to the questions.type CHECK constraint.
-- SQLite can't ALTER a CHECK; we rebuild the table and keep all data.
-- Safe to re-run: if the constraint already allows 'image', this is a no-op
-- because the CREATE/INSERT/DROP/RENAME sequence rebuilds to the same shape.

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS questions_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL,
  section_id INTEGER,
  number INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('mcq','multi','tf','fill','matching','short','image')),
  body TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  correct_answer TEXT,
  points REAL DEFAULT 1,
  explanation TEXT,
  FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
  FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE SET NULL
);

INSERT INTO questions_new (id, exam_id, section_id, number, type, body, data, correct_answer, points, explanation)
SELECT id, exam_id, section_id, number, type, body, data, correct_answer, points, explanation FROM questions;

DROP TABLE questions;

ALTER TABLE questions_new RENAME TO questions;

CREATE INDEX IF NOT EXISTS idx_questions_exam ON questions(exam_id);
CREATE INDEX IF NOT EXISTS idx_questions_number ON questions(exam_id, number);

PRAGMA foreign_keys = ON;
