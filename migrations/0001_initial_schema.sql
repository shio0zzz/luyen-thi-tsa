-- Exams table: a container for a set of questions (e.g., "TSA Đề số 02")
CREATE TABLE IF NOT EXISTS exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  duration_minutes INTEGER DEFAULT 60,
  source_pdf_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Sections within an exam (e.g., "Tư duy Toán học", "Đọc hiểu", "Khoa học")
CREATE TABLE IF NOT EXISTS sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  position INTEGER DEFAULT 0,
  FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
);

-- Questions table — supports many question types
-- type: 'mcq' (single answer), 'multi' (multiple answer), 'tf' (true/false group),
--       'fill' (fill-in-the-blank), 'matching' (left-right pairs), 'short' (short answer)
-- body: HTML / Markdown of the question stem (supports images, math)
-- data: JSON with type-specific payload (options, pairs, blanks, correct answer)
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL,
  section_id INTEGER,
  number INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('mcq','multi','tf','fill','matching','short')),
  body TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  correct_answer TEXT,
  points REAL DEFAULT 1,
  explanation TEXT,
  FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
  FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_questions_exam ON questions(exam_id);
CREATE INDEX IF NOT EXISTS idx_questions_number ON questions(exam_id, number);

-- Attempts: a single sit at an exam
-- status: 'in_progress' (answers editable), 'submitted' (locked), 'marked' (has grade)
CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL,
  candidate_name TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','submitted','marked')),
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  submitted_at DATETIME,
  marked_at DATETIME,
  time_spent_seconds INTEGER DEFAULT 0,
  score REAL,
  max_score REAL,
  FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attempts_exam ON attempts(exam_id);
CREATE INDEX IF NOT EXISTS idx_attempts_status ON attempts(status);

-- Individual answers for a question in an attempt
-- answer: JSON string (format depends on question type)
-- is_correct / score_awarded: filled during marking (can be null until marked)
CREATE TABLE IF NOT EXISTS answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL,
  answer TEXT,
  is_correct INTEGER,
  score_awarded REAL,
  marker_note TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(attempt_id, question_id),
  FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE CASCADE,
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_answers_attempt ON answers(attempt_id);
