/**
 * Turn a session event log into the operation stream the panel renders.
 *
 * Pure: no clock, no I/O, no session objects. The host feeds it
 * `session.snapshotEvents()`; the tests feed it fixtures. That is the whole
 * point — "what did the agent actually do" must be derivable from the log, not
 * from what the agent says about itself.
 *
 * Every operation also carries a `surface`: the *human view* of that action —
 * the command line a terminal would show, the text an editor would open, the
 * address bar a browser would display. The panel renders the surface, not a
 * summary of it.
 *
 * Pairs `tool/call` with `tool/result` by callId:
 * - a call without a result is still RUNNING (that is the live state)
 * - a result without a call keeps its own entry, so a mid-log start never
 *   silently drops activity
 * @module dsh-solo/core/ops
 */

/** Tool families, chosen by the panel's filter chips. */
export const KINDS = ['terminal', 'browser', 'file', 'agent', 'other']

/** How many characters of arguments / result the list carries. */
const SUMMARY_CHARS = 280
/** How many characters the expanded view carries. */
const DETAIL_CHARS = 6000
/** Upper bound on operations returned, newest kept. */
const MAX_OPS = 400

/**
 * Family of one tool name.
 * @param name - the tool name.
 * @returns one of {@link KINDS}.
 */
export function kindOf(name) {
  if (name === 'bash' || name === 'pwsh' || name === 'run_code') return 'terminal'
  if (name.startsWith('browser_')) return 'browser'
  if (name === 'read' || name === 'write' || name === 'edit' || name === 'read_image'
    || name === 'glob' || name === 'grep' || name === 'str_replace_editor') return 'file'
  if (name === 'subagent' || name === 'subagent_fork' || name === 'send_message' || name.startsWith('team_')
    || name === 'workflow' || name === 'list_agents' || name === 'interrupt_agent') return 'agent'
  return 'other'
}

/**
 * @param value - unknown.
 * @param cap - maximum characters kept.
 * @returns a single-line string.
 */
function clip(value, cap) {
  const text = typeof value === 'string' ? value : ''
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > cap ? `${flat.slice(0, cap)}…` : flat
}

/**
 * Cut a multi-line detail without flattening it.
 * @param value - unknown.
 * @param cap - maximum characters kept.
 * @returns the trimmed text, capped.
 */
function detailClip(value, cap) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length > cap ? `${text.slice(0, cap)}…` : text
}

/**
 * Render what the call was *asked* to do, without dumping whole payloads.
 * @param name - tool name.
 * @param args - parsed arguments, when the log carried JSON.
 * @param raw - the raw argument string, when parsing failed.
 * @returns `{summary, detail}`.
 */
export function describeCall(name, args, raw) {
  const pick = (...keys) => {
    for (const key of keys) {
      const value = args?.[key]
      if (typeof value === 'string' && value.trim() !== '') return value.trim()
    }
    return ''
  }
  const parts = []
  if (name === 'bash' || name === 'pwsh' || name === 'run_code') {
    const command = pick('command', 'cmd')
    const description = pick('description')
    if (description !== '') parts.push(description)
    if (command !== '') parts.push(command)
  } else if (name.startsWith('browser_')) {
    const url = pick('url')
    const target = pick('target', 'ref', 'selector', 'text')
    const action = name.slice('browser_'.length).replace(/_/g, '.')
    parts.push(action)
    if (url !== '') parts.push(url)
    else if (target !== '') parts.push(target)
  } else if (name === 'write' || name === 'read' || name === 'edit' || name === 'read_image') {
    const path = pick('file_path', 'path')
    if (path !== '') parts.push(path)
  } else if (name === 'glob' || name === 'grep') {
    const pattern = pick('pattern')
    const scope = pick('path', 'cwd')
    if (pattern !== '') parts.push(pattern)
    if (scope !== '') parts.push(`in ${scope}`)
  } else if (name === 'progress_update') {
    const title = pick('title')
    if (title !== '') parts.push(title)
  } else if (name === 'test_live_run') {
    const runner = pick('runner')
    const targets = Array.isArray(args?.targets) ? args.targets.filter(entry => typeof entry === 'string') : []
    parts.push(runner === '' ? 'test' : runner)
    if (targets.length > 0) parts.push(targets.join(' '))
  } else if (name === 'todo_write') {
    const todos = Array.isArray(args?.todos) ? args.todos : []
    parts.push(todos.length + ' 项待办')
  } else if (name === 'ask_user_question') {
    const first = Array.isArray(args?.questions) ? args.questions[0] : undefined
    const question = typeof first?.question === 'string' ? first.question : ''
    if (question !== '') parts.push(question)
  } else if (name === 'subagent' || name === 'subagent_fork' || name === 'send_message') {
    const who = pick('agent_id', 'to', 'description')
    if (who !== '') parts.push(who)
  } else {
    const first = pick('description', 'prompt', 'path', 'query', 'url')
    if (first !== '') parts.push(first)
  }

  const summary = parts.join(' · ')
  if (summary !== '') {
    return { summary: clip(summary, SUMMARY_CHARS), detail: detailClip(parts.join('\n'), DETAIL_CHARS) }
  }
  // Nothing recognizable: fall back to the raw argument text, but keep the list
  // readable by clipping it hard.
  const fallback = clip(raw ?? '', SUMMARY_CHARS)
  return { summary: fallback, detail: detailClip(raw ?? '', DETAIL_CHARS) }
}

/**
 * @param event - a `tool/result` event.
 * @returns the tool's textual output.
 */
export function resultText(event) {
  const content = event?.data?.message?.content
  if (!Array.isArray(content)) return ''
  const chunks = []
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') chunks.push(block.text)
  }
  return chunks.join('\n')
}

/**
 * Build the human-view payload of one call.
 *
 * Deliberately small: a terminal shows the command, an editor shows the text it
 * was given, a browser shows its address. Anything the log does not carry (a
 * page's pixels, a pty's escape stream) is not invented here.
 * @param name - tool name.
 * @param args - parsed arguments (undefined when the log was not JSON).
 * @param raw - raw argument text.
 * @returns a surface object, always with a `kind` that matches {@link kindOf}.
 */
export function buildSurface(name, args, raw) {
  const pick = (...keys) => {
    for (const key of keys) {
      const value = args?.[key]
      if (typeof value === 'string' && value !== '') return value
    }
    return ''
  }
  const kind = kindOf(name)
  if (kind === 'terminal') {
    return {
      kind,
      command: pick('command', 'cmd', 'code'),
      description: pick('description'),
      output: '',
    }
  }
  if (kind === 'file') {
    if (name === 'edit') {
      return { kind, path: pick('file_path', 'path'), oldText: detailClip(pick('old_string', 'old_text', 'oldText'), 4000), newText: detailClip(pick('new_string', 'new_text', 'newText'), 4000) }
    }
    if (name === 'write') {
      return { kind, path: pick('file_path', 'path'), content: detailClip(pick('content', 'text'), 8000) }
    }
    return { kind, path: pick('file_path', 'path', 'pattern') }
  }
  if (kind === 'browser') {
    return { kind, action: name.slice('browser_'.length).replace(/_/g, '.'), url: pick('url'), target: pick('target', 'ref', 'selector', 'text') }
  }
  return { kind, raw: detailClip(raw ?? '', 2000) }
}

/**
 * Fold a session log into operations.
 *
 * @param events - `session.snapshotEvents()` output (oldest first).
 * @param options - `{maxOps}`.
 * @returns `{ops, lastSeq}` — ops oldest first, so the panel scrolls naturally.
 */
export function projectOps(events, options = {}) {
  const maxOps = Number.isFinite(options.maxOps) ? Math.max(1, Number(options.maxOps)) : MAX_OPS
  const byCall = new Map()
  const ops = []
  let lastSeq = 0

  const total = Array.isArray(events) ? events.length : 0
  for (let index = 0; index < total; index += 1) {
    const event = events[index]
    const seq = Number.isFinite(event?.seq) ? Number(event.seq) : index
    lastSeq = Math.max(lastSeq, seq)
    if (event?.type === 'tool/call') {
      const callId = typeof event.data?.callId === 'string' ? event.data.callId : ''
      const name = typeof event.data?.name === 'string' ? event.data.name : '?'
      const rawArgs = typeof event.data?.arguments === 'string'
        ? event.data.arguments
        : (event.data?.arguments === undefined ? '' : JSON.stringify(event.data.arguments))
      let parsed
      try {
        parsed = rawArgs === '' ? {} : JSON.parse(rawArgs)
      } catch {
        parsed = undefined
      }
      const described = describeCall(name, parsed, rawArgs)
      const op = {
        surface: buildSurface(name, parsed, rawArgs),
        seq,
        callId,
        name,
        kind: kindOf(name),
        summary: described.summary,
        detail: described.detail,
        argsRaw: clip(rawArgs, DETAIL_CHARS),
        status: 'running',
        startedAt: Number.isFinite(event.time) ? Number(event.time) : 0,
        endedAt: 0,
        durationMs: 0,
        isError: false,
        result: '',
        resultTruncated: false,
        cwd: '',
      }
      ops.push(op)
      if (callId !== '') byCall.set(callId, op)
      continue
    }

    if (event?.type === 'tool/result') {
      const callId = typeof event.data?.source?.callId === 'string'
        ? event.data.source.callId
        : (typeof event.data?.message?.toolCallId === 'string' ? event.data.message.toolCallId : '')
      const target = callId === '' ? undefined : byCall.get(callId)
      const text = resultText(event)
      const isError = event.data?.isError === true
      const finishedAt = Number.isFinite(event.time) ? Number(event.time) : 0
      if (target === undefined) {
        // A result whose call is outside the window still counts as activity.
        const name = typeof event.data?.name === 'string' ? event.data.name : 'tool'
        ops.push({
          seq,
          callId,
          name,
          kind: kindOf(name),
          summary: clip(text, SUMMARY_CHARS),
          detail: '',
          argsRaw: '',
          status: isError ? 'failed' : 'done',
          startedAt: finishedAt,
          endedAt: finishedAt,
          durationMs: 0,
          isError,
          result: clip(text, DETAIL_CHARS),
          resultTruncated: text.length > DETAIL_CHARS,
          cwd: typeof event.data?.meta?.cwd === 'string' ? event.data.meta.cwd : '',
        })
        continue
      }
      target.status = isError ? 'failed' : 'done'
      target.endedAt = finishedAt
      target.durationMs = target.startedAt > 0 && finishedAt >= target.startedAt ? finishedAt - target.startedAt : 0
      target.isError = isError
      target.result = clip(text, DETAIL_CHARS)
      target.resultTruncated = text.length > DETAIL_CHARS
      if (target.surface?.kind === 'terminal') {
        // A terminal shows the output verbatim (newlines kept, ANSI untouched);
        // the flattened `result` stays the one-line summary.
        target.surface.output = detailClip(text, DETAIL_CHARS)
      }
      const cwd = event.data?.meta?.cwd
      if (typeof cwd === 'string' && cwd !== '') target.cwd = cwd
    }
  }

  const kept = ops.length > maxOps ? ops.slice(-maxOps) : ops
  return { ops: kept, lastSeq, dropped: ops.length - kept.length }
}

/**
 * @param ops - projection output.
 * @returns counters the panel header shows.
 */
export function summarize(ops) {
  let running = 0
  let failed = 0
  for (const op of ops) {
    if (op.status === 'running') running += 1
    else if (op.status === 'failed') failed += 1
  }
  return { total: ops.length, running, failed, done: ops.length - running - failed }
}
