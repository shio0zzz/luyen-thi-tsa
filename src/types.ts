export type Bindings = {
  DB: D1Database
}

export type QuestionType = 'mcq' | 'multi' | 'tf' | 'fill' | 'matching' | 'short'

export interface ExamRow {
  id: number
  title: string
  description: string | null
  duration_minutes: number
  source_pdf_name: string | null
  created_at: string
  updated_at: string
}

export interface QuestionRow {
  id: number
  exam_id: number
  section_id: number | null
  number: number
  type: QuestionType
  body: string
  data: string // JSON
  correct_answer: string | null
  points: number
  explanation: string | null
}

export interface AttemptRow {
  id: number
  exam_id: number
  candidate_name: string | null
  status: 'in_progress' | 'submitted' | 'marked'
  started_at: string
  submitted_at: string | null
  marked_at: string | null
  time_spent_seconds: number
  score: number | null
  max_score: number | null
}

export interface AnswerRow {
  id: number
  attempt_id: number
  question_id: number
  answer: string | null
  is_correct: number | null
  score_awarded: number | null
  marker_note: string | null
  updated_at: string
}
