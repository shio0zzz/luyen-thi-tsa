import { Hono } from 'hono'
import { renderer } from './renderer'
import api from './routes/api'
import { requireAuth, issueToken, COOKIE_NAME, COOKIE_MAX_AGE, setCookie, deleteCookie } from './auth'
import type { Bindings } from './types'

const app = new Hono<{ Bindings: Bindings }>()

// Passcode gate (enabled only when APP_PASSCODE secret is set)
app.use('*', requireAuth)

app.use(renderer)
app.route('/api', api)

// Serve uploaded images from R2 at /uploads/*
// Kept outside /api/* on purpose so <img src="/uploads/..."> works nicely.
// Requires auth (same gate as the rest of the site), so your questions stay private.
app.get('/uploads/*', async (c) => {
  const url = new URL(c.req.url)
  const key = decodeURIComponent(url.pathname.replace(/^\/uploads\//, ''))
  if (!key) return c.notFound()
  const obj = await c.env.R2.get(key)
  if (!obj) return c.notFound()
  const headers = new Headers()
  headers.set('content-type', obj.httpMetadata?.contentType || 'application/octet-stream')
  headers.set('cache-control', 'private, max-age=31536000, immutable')
  headers.set('etag', obj.httpEtag)
  return new Response(obj.body, { headers })
})

/* ---------- Login / Logout ---------- */

app.get('/login', (c) => {
  const err = c.req.query('err')
  const back = c.req.query('back') ?? '/'
  const gateOff = !c.env.APP_PASSCODE
  return c.render(
    <div class="min-h-screen grid place-items-center p-6">
      <div class="exam-card p-8 w-full max-w-md">
        <div class="flex items-center gap-3 mb-6">
          <div class="w-10 h-10 bg-blue-600 text-white rounded-lg grid place-items-center font-bold">EL</div>
          <div>
            <h1 class="text-xl font-bold">Exam Lab</h1>
            <p class="text-xs text-slate-500">Enter passcode to continue</p>
          </div>
        </div>
        {gateOff ? (
          <div class="mb-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded text-sm">
            Passcode is not set on this server (local dev). You can just click <b>Enter</b>.
          </div>
        ) : null}
        {err ? (
          <div class="mb-4 p-3 bg-red-50 border border-red-200 text-red-800 rounded text-sm">
            Wrong passcode. Try again.
          </div>
        ) : null}
        <form method="POST" action="/login" class="space-y-3">
          <input type="hidden" name="back" value={back} />
          <input
            type="password"
            name="passcode"
            autofocus
            placeholder="Passcode"
            class="w-full border border-slate-300 rounded-md px-3 py-2 text-base focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <button
            type="submit"
            class="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-semibold"
          >
            <i class="fas fa-unlock-alt mr-1"></i> Enter
          </button>
        </form>

      </div>
    </div>
  )
})

app.post('/login', async (c) => {
  const form = await c.req.parseBody()
  const passcode = String(form.passcode ?? '')
  const back = String(form.back ?? '/') || '/'
  const secret = c.env.APP_PASSCODE
  if (!secret) {
    // No gate configured — issue nothing, just bounce back
    return c.redirect(back.startsWith('/') ? back : '/')
  }
  if (passcode !== secret) {
    const safeBack = encodeURIComponent(back)
    return c.redirect(`/login?err=1&back=${safeBack}`)
  }
  const token = await issueToken(secret)
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: new URL(c.req.url).protocol === 'https:',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  })
  return c.redirect(back.startsWith('/') ? back : '/')
})

app.post('/logout', (c) => {
  deleteCookie(c, COOKIE_NAME, { path: '/' })
  return c.redirect('/login')
})

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
          <div class="flex items-center gap-2">
            <button
              id="new-exam-btn"
              class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2"
            >
              <i class="fas fa-plus"></i> New exam
            </button>
            <form method="POST" action="/logout" class="inline">
              <button
                type="submit"
                class="bg-white border border-slate-300 hover:bg-slate-50 text-slate-600 px-3 py-2 rounded-md text-sm"
                title="Sign out (only visible when passcode is enabled)"
              >
                <i class="fas fa-sign-out-alt"></i>
              </button>
            </form>
          </div>
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
