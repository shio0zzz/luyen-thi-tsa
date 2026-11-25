import type { MiddlewareHandler } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { Bindings } from './types'

const COOKIE_NAME = 'examlab_auth'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 days

// Edge-friendly HMAC token: base64(payload).base64(hmac)
// payload = JSON { exp: unix } — short so readable
async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return btoa(payload) + '.' + btoa(String.fromCharCode(...new Uint8Array(sig)))
}

async function verify(token: string, secret: string): Promise<boolean> {
  const [b64p, b64s] = token.split('.')
  if (!b64p || !b64s) return false
  let payload: string
  try { payload = atob(b64p) } catch { return false }
  const expected = await sign(payload, secret)
  // constant-time compare is overkill here (edge can't measure it), but we still avoid early-return bias
  if (expected.length !== token.length) return false
  let ok = 0
  for (let i = 0; i < expected.length; i++) ok |= expected.charCodeAt(i) ^ token.charCodeAt(i)
  if (ok !== 0) return false
  try {
    const { exp } = JSON.parse(payload)
    return typeof exp === 'number' && exp > Math.floor(Date.now() / 1000)
  } catch { return false }
}

export async function issueToken(secret: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE
  return sign(JSON.stringify({ exp }), secret)
}

/** Require a valid session cookie. If APP_PASSCODE is unset, auth is disabled (local dev). */
export const requireAuth: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
  const secret = c.env.APP_PASSCODE
  if (!secret) return next() // no passcode configured → open access (local dev)
  // Login & assets never require auth
  const p = new URL(c.req.url).pathname
  if (p.startsWith('/login') || p.startsWith('/static/') || p === '/favicon.ico') return next()

  const token = getCookie(c, COOKIE_NAME)
  if (token && (await verify(token, secret))) return next()

  // API calls get 401 JSON; page requests redirect to /login
  if (p.startsWith('/api/')) return c.json({ error: 'unauthorized' }, 401)
  const back = encodeURIComponent(p + (new URL(c.req.url).search || ''))
  return c.redirect(`/login?back=${back}`)
}

export { COOKIE_NAME, COOKIE_MAX_AGE, setCookie, deleteCookie }
