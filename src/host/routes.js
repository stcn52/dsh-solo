/**
 * The host half: `/solo/sessions` and `/solo/ops`.
 *
 * Both read the *session log* — the record the agent cannot write to — and
 * project it. Nothing here trusts a self-report, which is why the panel can
 * claim "this is what actually ran".
 *
 *   GET /solo/sessions            live sessions, newest activity first
 *   GET /solo/ops?sessionId=&max  operations of one session (newest kept)
 *   GET /solo/version             loaded plugin version
 *
 * Polling rather than SSE: the projection is cheap for a few hundred events and
 * a poll cannot silently miss an event the way a dropped stream frame can.
 * @module dsh-solo/host/routes
 */

import { readFileSync } from 'node:fs'
import { projectOps, summarize } from '../core/ops.js'

/** Route prefix claimed by this plugin. */
export const ROUTE_PREFIX = '/solo'

/** This package's version, echoed by `/version`. */
const PLUGIN_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version ?? null
  } catch {
    return null
  }
})()

/**
 * Send one JSON response.
 * @param res - server response.
 * @param status - HTTP status code.
 * @param value - JSON-serializable body.
 */
function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/**
 * Describe one live session without reading its whole log twice.
 * @param session - a Session instance.
 * @returns `{id, cwd, events, lastSeq, lastTime}`.
 */
function describeSession(session) {
  let events = []
  try {
    events = session.snapshotEvents()
  } catch {
    events = []
  }
  const last = events.at(-1)
  return {
    id: String(session.id),
    cwd: typeof session.header?.cwd === 'string' ? session.header.cwd : '',
    events: events.length,
    lastSeq: Number.isFinite(last?.seq) ? Number(last.seq) : 0,
    lastTime: Number.isFinite(last?.time) ? Number(last.time) : 0,
  }
}

/**
 * Read one session's operations.
 * @param sessions - the cordis `sessions` service.
 * @param sessionId - requested session, or undefined for the most recently active.
 * @param max - how many operations to keep.
 * @returns `{sessionId, ops, counts, sessions}` or a `{status, error}` shape.
 */
function readOps(sessions, sessionId, max) {
  const live = typeof sessions?.list === 'function' ? sessions.list() : []
  const described = live.map(describeSession).sort((a, b) => b.lastTime - a.lastTime)
  if (described.length === 0) return { status: 404, error: 'no live sessions' }

  let target = sessionId
  if (target === undefined || target === '') target = described[0].id
  const session = live.find(candidate => String(candidate.id) === target)
  if (session === undefined) {
    return { status: 404, error: `session "${target}" is not live`, sessions: described }
  }

  const projection = projectOps(session.snapshotEvents(), { maxOps: max })
  return {
    sessionId: target,
    ops: projection.ops,
    counts: summarize(projection.ops),
    lastSeq: projection.lastSeq,
    dropped: projection.dropped,
    sessions: described,
    version: PLUGIN_VERSION,
  }
}

/**
 * Route one request.
 * @param req - server request.
 * @param res - server response.
 * @param sessions - the cordis `sessions` service.
 */
function handle(req, res, sessions) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname
  const method = req.method ?? 'GET'
  const suffix = path === ROUTE_PREFIX ? '/' : path.slice(ROUTE_PREFIX.length)

  if (method !== 'GET') {
    sendJson(res, 405, { error: 'GET only' })
    return
  }

  if (suffix === '/version') {
    sendJson(res, 200, { version: PLUGIN_VERSION })
    return
  }

  if (sessions === null || sessions === undefined) {
    sendJson(res, 503, { error: 'this host has no session store' })
    return
  }

  if (suffix === '/sessions') {
    const live = typeof sessions.list === 'function' ? sessions.list() : []
    sendJson(res, 200, {
      sessions: live.map(describeSession).sort((a, b) => b.lastTime - a.lastTime),
      version: PLUGIN_VERSION,
    })
    return
  }

  if (suffix === '/ops') {
    const maxRaw = url.searchParams.get('max')
    const max = maxRaw === null ? 120 : Number(maxRaw)
    const result = readOps(sessions, url.searchParams.get('sessionId') ?? undefined, Number.isFinite(max) ? max : 120)
    const status = typeof result.status === 'number' ? result.status : 200
    sendJson(res, status, result)
    return
  }

  sendJson(res, 404, { error: `unknown route ${method} ${path}` })
}

/**
 * Mount the HTTP surface.
 *
 * `webServer` and `sessions` are both reached through cordis injection, not a
 * name lookup: `ctx.get()` takes a plugin object, so `ctx.get('webServer')`
 * quietly yields undefined and every route 404s.
 * @param ctx - cordis context.
 * @returns true when the mount was scheduled.
 */
export function registerRoutes(ctx) {
  if (typeof ctx.inject !== 'function') return false
  ctx.inject(['webServer', 'sessions'], scoped => {
    scoped.effect(() => scoped.webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: (req, res) => {
        try {
          handle(req, res, scoped.sessions)
        } catch (error) {
          if (res.writableEnded) return
          try {
            sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
          } catch {
            res.end()
          }
        }
      },
    }))
  })
  return true
}
