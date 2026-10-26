/**
 * SOLO panel (client half): the agent's operations as they happen.
 *
 * Everything on screen is folded from the session log by the host — this file
 * only polls `/solo/ops` and renders it. There is no "agent said it finished"
 * path: a row turns green when a `tool/result` event exists for that call, and
 * stays pulsing while the call is still open.
 *
 * Plain ModuleLoader bundle: no build step, matching how the host loads plugin
 * client halves.
 */
window.__ModuleLoader__.load({
  id: 'dsh-solo',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    var React = require('react')
    var h = React.createElement
    var useEffect = React.useEffect
    var useRef = React.useRef
    var useState = React.useState

    var TAB_ID = 'dsh-solo'
    var STYLE_ID = 'dsh-solo-style'
    var ROUTE = '/solo'
    var POLL_MS = 900
    var KEEP = 150

    var FILTERS = [
      { id: 'all', label: '全部' },
      { id: 'terminal', label: '终端' },
      { id: 'browser', label: '浏览器' },
      { id: 'file', label: '文件' },
      { id: 'agent', label: '协作' },
    ]

    var GLYPH = { terminal: '›_', browser: '◍', file: '▤', agent: '❖', other: '◇' }

    var CSS = [
      '.dsl-root { display: flex; flex-direction: column; height: 100%; min-height: 0; color: var(--fg, #e6e9ef); font-size: 13px; }',
      '.dsl-head { display: flex; align-items: center; gap: 7px; padding: 9px 10px 5px; flex: 0 0 auto; }',
      '.dsl-title { font-weight: 600; font-size: 13px; letter-spacing: 0.04em; }',
      '.dsl-grow { flex: 1 1 auto; }',
      '.dsl-live { display: inline-flex; align-items: center; gap: 5px; font-size: 10.5px; color: var(--fg-muted, #98a2b3); white-space: nowrap; }',
      '.dsl-live::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: #ffc46b; }',
      '.dsl-live[data-on="true"]::before { background: #7ee0a1; box-shadow: 0 0 0 3px rgba(126,224,161,0.14); }',
      '.dsl-sess { display: flex; gap: 6px; padding: 0 10px 6px; flex: 0 0 auto; align-items: center; }',
      '.dsl-sess select { flex: 1 1 auto; min-width: 0; height: 23px; font: inherit; font-size: 11px; color: inherit; background: var(--surface-2, #1b202a); border: 1px solid var(--border, #2a2f3a); border-radius: 6px; padding: 0 4px; }',
      '.dsl-chips { display: flex; gap: 5px; padding: 0 10px 7px; flex: 0 0 auto; flex-wrap: wrap; }',
      '.dsl-chip { font: inherit; font-size: 11px; color: var(--fg-muted, #98a2b3); background: transparent; border: 1px solid var(--border, #2a2f3a); border-radius: 999px; padding: 1px 8px; cursor: pointer; }',
      '.dsl-chip:hover { color: var(--fg, #e6e9ef); border-color: var(--border-strong, #3a4150); }',
      '.dsl-chip.is-on { color: var(--fg, #e6e9ef); background: var(--accent-soft, rgba(110,168,254,0.16)); border-color: var(--accent, #6ea8fe); }',
      '.dsl-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 0 6px 8px; display: flex; flex-direction: column; gap: 3px; }',
      '.dsl-op { display: grid; grid-template-columns: 15px minmax(0, 1fr); gap: 2px 7px; padding: 4px 6px; border-radius: 6px; cursor: pointer; border: 1px solid transparent; }',
      '.dsl-op:hover { background: rgba(255,255,255,0.04); }',
      '.dsl-op[data-open="true"] { background: var(--surface-2, #1b202a); border-color: var(--border, #2a2f3a); }',
      '.dsl-kind { text-align: center; font-size: 10px; line-height: 1.6; color: var(--fg-muted, #98a2b3); }',
      '.dsl-op[data-kind="terminal"] .dsl-kind { color: #ffc46b; }',
      '.dsl-op[data-kind="browser"] .dsl-kind { color: #8fb8ff; }',
      '.dsl-op[data-kind="file"] .dsl-kind { color: #b39ddb; }',
      '.dsl-op[data-kind="agent"] .dsl-kind { color: #7ee0a1; }',
      '.dsl-main { flex: 1 1 auto; min-width: 0; display: grid; gap: 2px; }',
      '.dsl-line1 { display: flex; gap: 5px; align-items: baseline; min-width: 0; }',
      '.dsl-tool { flex: 0 0 auto; font-size: 10.5px; font-family: var(--mono, ui-monospace, monospace); color: var(--fg-muted, #98a2b3); }',
      '.dsl-sum { flex: 1 1 auto; min-width: 0; font-size: 11.5px; font-family: var(--mono, ui-monospace, monospace); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.dsl-op[data-status="running"] .dsl-sum { color: var(--fg, #e6e9ef); }',
      '.dsl-op[data-status="running"] .dsl-kind { animation: dsl-pulse 1.1s ease-in-out infinite; }',
      '@keyframes dsl-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }',
      '.dsl-meta { flex: 0 0 auto; font-size: 10px; color: var(--fg-muted, #98a2b3); font-variant-numeric: tabular-nums; white-space: nowrap; }',
      '.dsl-op[data-status="failed"] .dsl-meta { color: #ff8a80; }',
      '.dsl-detail { grid-column: 1 / -1; margin: 4px 0 2px 22px; display: grid; gap: 4px; min-width: 0; }',
      '.dsl-sect { font-size: 9.5px; letter-spacing: 0.07em; text-transform: uppercase; color: var(--fg-muted, #98a2b3); }',
      '.dsl-pre { margin: 0; padding: 5px 7px; border-radius: 5px; background: rgba(0,0,0,0.28); font-family: var(--mono, ui-monospace, monospace); font-size: 10.5px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 220px; overflow: auto; }',
      '.dsl-pre.err { color: #ff9d95; }',
      '.dsl-foot { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 6px 10px 8px; border-top: 1px solid var(--border, #2a2f3a); font-size: 10.5px; color: var(--fg-muted, #98a2b3); }',
      '.dsl-foot b { color: var(--fg, #e6e9ef); font-weight: 600; font-variant-numeric: tabular-nums; }',
      '.dsl-empty { padding: 16px 12px; color: var(--fg-muted, #98a2b3); display: grid; gap: 7px; line-height: 1.65; font-size: 12px; }',
      '.dsl-err { margin: 0 10px 6px; font-size: 11px; color: #ff9d95; }',
    ].join('\n')

    /** Inject the stylesheet once, tolerating a second mount after a reload. */
    function ensureStyles() {
      if (document.getElementById(STYLE_ID) !== null) return
      var style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = CSS
      document.head.appendChild(style)
    }

    /**
     * Shorten a duration for the row's right edge.
     * @param ms - milliseconds.
     * @returns e.g. "0.4s", "12s", "1m20s".
     */
    function duration(ms) {
      if (!(ms > 0)) return ''
      if (ms < 1000) return Math.round(ms) + 'ms'
      if (ms < 60000) return (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + 's'
      var m = Math.floor(ms / 60000)
      var s = Math.round((ms % 60000) / 1000)
      return m + 'm' + s + 's'
    }

    /** One operation row plus its expandable detail. */
    function OperationRow(props) {
      var op = props.op
      var open = props.open
      var onToggle = props.onToggle
      var meta = op.status === 'running'
        ? '进行中'
        : (op.status === 'failed' ? '失败' : '完成') + (op.durationMs > 0 ? ' · ' + duration(op.durationMs) : '')

      return h('div', { className: 'dsl-op', 'data-kind': op.kind, 'data-status': op.status, 'data-open': open ? 'true' : 'false', onClick: onToggle },
        h('span', { className: 'dsl-kind' }, GLYPH[op.kind] || GLYPH.other),
        h('div', { className: 'dsl-main' },
          h('div', { className: 'dsl-line1' },
            h('span', { className: 'dsl-tool' }, op.name),
            h('span', { className: 'dsl-sum', title: op.summary }, op.summary === '' ? '(无参数)' : op.summary),
            h('span', { className: 'dsl-meta' }, meta),
          ),
        ),
        open ? h('div', { className: 'dsl-detail', onClick: function (event) { event.stopPropagation() } },
          op.detail === '' ? null : h('div', { className: 'dsl-sect' }, '输入'),
          op.detail === '' ? null : h('pre', { className: 'dsl-pre' }, op.detail),
          op.result === '' ? null : h('div', { className: 'dsl-sect' }, op.status === 'failed' ? '错误输出' : '输出'),
          op.result === '' ? null : h('pre', { className: 'dsl-pre' + (op.isError ? ' err' : '') }, op.result + (op.resultTruncated ? '\n… (已截断)' : '')),
          op.cwd === '' ? null : h('div', { className: 'dsl-sect' }, 'cwd · ' + op.cwd),
        ) : null,
      )
    }

    /** The panel. */
    function SoloBody() {
      var [data, setData] = useState(null)
      var [error, setError] = useState('')
      var [filter, setFilter] = useState('all')
      var [sessionId, setSessionId] = useState('')
      var [openSeq, setOpenSeq] = useState(-1)
      var bodyRef = useRef(null)
      var stickRef = useRef(true)

      useEffect(function () {
        var alive = true
        var timer = null

        async function poll() {
          try {
            var query = ROUTE + '/ops?max=' + KEEP + (sessionId === '' ? '' : '&sessionId=' + encodeURIComponent(sessionId))
            var response = await fetch(query, { headers: { accept: 'application/json' } })
            var body = await response.json()
            if (!alive) return
            if (!response.ok) {
              setError(body && body.error ? body.error : 'HTTP ' + response.status)
              setData(function (previous) { return previous })
              return
            }
            setError('')
            setData(body)
            if (sessionId === '' && body.sessionId) setSessionId(body.sessionId)
          } catch (cause) {
            if (alive) setError(String(cause && cause.message ? cause.message : cause))
          } finally {
            if (alive) timer = setTimeout(poll, POLL_MS)
          }
        }

        poll()
        return function () { alive = false; if (timer !== null) clearTimeout(timer) }
      }, [sessionId])

      var ops = (data && data.ops) || []
      var counts = (data && data.counts) || { total: 0, running: 0, failed: 0, done: 0 }
      var sessions = (data && data.sessions) || []
      var visible = filter === 'all' ? ops : ops.filter(function (op) { return op.kind === filter })

      // Follow the tail unless the reader scrolled up to inspect something.
      useEffect(function () {
        var node = bodyRef.current
        if (node === null || !stickRef.current) return
        node.scrollTop = node.scrollHeight
      }, [data])

      function onScroll() {
        var node = bodyRef.current
        if (node === null) return
        stickRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60
      }

      var sessionLabel = function (session) {
        var tail = session.cwd === '' ? session.id.slice(0, 10) : session.cwd.split('/').filter(Boolean).slice(-1)[0]
        return tail + ' · ' + session.events + ' events'
      }

      return h('div', { className: 'dsl-root' },
        h('div', { className: 'dsl-head' },
          h('span', { className: 'dsl-title' }, 'SOLO'),
          h('span', { className: 'dsl-grow' }),
          h('span', { className: 'dsl-live', 'data-on': error === '' && data !== null ? 'true' : 'false' }, error === '' ? '实时' : '中断'),
        ),

        h('div', { className: 'dsl-sess' },
          h('select', {
            value: sessionId,
            onChange: function (event) { setSessionId(event.target.value) },
            title: '切换要观察的会话',
          }, sessions.length === 0
            ? h('option', { value: '' }, '（没有活跃会话）')
            : sessions.map(function (session) { return h('option', { key: session.id, value: session.id }, sessionLabel(session)) })),
        ),

        h('div', { className: 'dsl-chips' },
          FILTERS.map(function (entry) {
            return h('button', {
              key: entry.id,
              className: 'dsl-chip' + (filter === entry.id ? ' is-on' : ''),
              onClick: function () { setFilter(entry.id) },
            }, entry.label)
          }),
        ),

        error === '' ? null : h('div', { className: 'dsl-err' }, error),

        h('div', { className: 'dsl-body', ref: bodyRef, onScroll: onScroll },
          visible.length === 0
            ? h('div', { className: 'dsl-empty' },
                h('div', {}, countText(counts, data)),
                h('div', {}, '当 agent 调用工具时，这里会实时出现一行：终端命令、浏览器动作、文件读写、子代理协作。'),
                h('div', {}, '每行的状态来自会话日志里的 tool/result —— 不是 agent 的自述。'),
              )
            : visible.map(function (op) {
                return h(OperationRow, {
                  key: op.seq,
                  op: op,
                  open: openSeq === op.seq,
                  onToggle: function () { setOpenSeq(openSeq === op.seq ? -1 : op.seq) },
                })
              }),
        ),

        h('div', { className: 'dsl-foot' },
          h('span', {}, '操作 ', h('b', {}, String(counts.total))),
          h('span', {}, '运行中 ', h('b', {}, String(counts.running))),
          h('span', {}, '失败 ', h('b', {}, String(counts.failed))),
          h('span', { className: 'dsl-grow' }),
          h('span', {}, '日志轮询 ' + (POLL_MS / 1000) + 's'),
        ),
      )
    }

    /**
     * @param counts - operation counters.
     * @param data - the last payload, if any.
     * @returns an explanatory line for the empty state.
     */
    function countText(counts, data) {
      if (data === null) return '正在读取会话日志…'
      if (counts.total > 0) return '当前筛选下没有操作（共 ' + counts.total + ' 条）。'
      return '这个会话还没有工具调用。'
    }

    exports.name = 'dsh-solo-client'
    exports.inject = ['sidebarRightTabs', 'slots']

    /** Mount the sidebar tab. */
    exports.apply = function apply(ctx) {
      try {
        ensureStyles()
        ctx.sidebarRightTabs.register({
          id: TAB_ID,
          kind: 'solo',
          priority: 'extension',
          title: function () { return 'SOLO' },
          guide: [{
            id: 'solo',
            order: 45,
            title: function () { return 'SOLO' },
            description: function () { return 'agent 的每一次工具调用：命令、浏览器、文件、协作，带状态与输出' },
          }],
        })
        ctx.slots.inject('sidebar.right.pane.tab', function () {
          return ctx.slots.register(
            { name: 'sidebar.right.pane.tab', key: TAB_ID },
            SoloBody,
          )
        })
      } catch (error) {
        var message = error && error.message ? error.message : String(error)
        document.documentElement.setAttribute('data-dsh-solo-error', message)
        if (window.console && window.console.warn) window.console.warn('dsh-solo client: ' + message)
      }
    }

    return module.exports
  },
})
