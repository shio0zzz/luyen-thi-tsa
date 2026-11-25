import { Hono } from 'hono'
import { renderer } from './renderer'
import api from './routes/api'
import type { Bindings } from './types'

const app = new Hono<{ Bindings: Bindings }>()

app.use(renderer)
app.route('/api', api)

/* ---------- Pages ---------- */

app.get('/', (c) => {
  return c.render(
    <div id="app" class="min-h-screen">
      <HomePage />
    </div>
  )
})

app.get('/exams/:id/manage', (c) => {
  const id = c.req.param('id')
  return c.render(
    <div id="app" class="min-h-screen" data-exam-id={id}>
      <div class="p-6 text-slate-500">Loading editor…</div>
      <script type="module" src="/static/manage.js"></script>
    </div>
  )
})

app.get('/attempts/:id/take', (c) => {
  const id = c.req.param('id')
  return c.render(
    <div id="app" class="min-h-screen" data-attempt-id={id}>
      <div class="p-6 text-slate-500">Loading exam…</div>
      <script type="module" src="/static/take.js"></script>
    </div>
  )
})

app.get('/attempts/:id/mark', (c) => {
  const id = c.req.param('id')
  return c.render(
    <div id="app" class="min-h-screen" data-attempt-id={id}>
      <div class="p-6 text-slate-500">Loading marking view…</div>
      <script type="module" src="/static/mark.js"></script>
    </div>
  )
})

function HomePage() {
  return (
    <>
      <header class="bg-white border-b border-slate-200">
        <div class="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 bg-blue-600 text-white rounded-lg grid place-items-center font-bold">
              EL
            </div>
            <div>
              <h1 class="text-xl font-bold">Exam Lab</h1>
              <p class="text-xs text-slate-500">Personal online exam platform</p>
            </div>
          </div>
          <button
            id="new-exam-btn"
            class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2"
          >
            <i class="fas fa-plus"></i> New exam
          </button>
        </div>
      </header>
      <main class="max-w-6xl mx-auto p-6">
        <div id="exam-list" class="grid gap-4"></div>
      </main>
      <script type="module" src="/static/home.js"></script>
    </>
  )
}

export default app
