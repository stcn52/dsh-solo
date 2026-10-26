/**
 * SOLO panel (client half): the agent's operations, rendered the way a human
 * would see them happen.
 *
 * A `bash` call opens a terminal pane with the real command line and its ANSI
 * output; an `edit` opens an editor pane with the replaced block as a diff; a
 * `write` opens the text that was written; a `browser_*` call shows the address
 * bar the action ran against. The summary row stays the timeline, but the detail
 * is a surface, not a field dump.
 *
 * Data comes from `/solo/ops`, which the host folds from the session log — this
 * file never decides what happened, only how it looks.
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

    /** SGR palette: the 8 base colours plus their bright twins. */
    var PALETTE = {
      30: '#5b6270', 31: '#ff8a80', 32: '#7ee0a1', 33: '#ffc46b', 34: '#8fb8ff', 35: '#d0a9f5', 36: '#6fd6e5', 37: '#e6e9ef',
      90: '#7b8394', 91: '#ffb4ad', 92: '#a8f0c0', 93: '#ffd98f', 94: '#b3cfff', 95: '#e2c6ff', 96: '#9fe6f0', 97: '#ffffff',
    }

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
      '.dsl-main { min-width: 0; }',
      '.dsl-line1 { display: flex; gap: 5px; align-items: baseline; min-width: 0; }',
      '.dsl-tool { flex: 0 0 auto; font-size: 10.5px; font-family: var(--mono, ui-monospace, monospace); color: var(--fg-muted, #98a2b3); }',
      '.dsl-sum { flex: 1 1 auto; min-width: 0; font-size: 11.5px; font-family: var(--mono, ui-monospace, monospace); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.dsl-op[data-status="running"] .dsl-kind { animation: dsl-pulse 1.1s ease-in-out infinite; }',
      '@keyframes dsl-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }',
      '.dsl-meta { flex: 0 0 auto; font-size: 10px; color: var(--fg-muted, #98a2b3); font-variant-numeric: tabular-nums; white-space: nowrap; }',
      '.dsl-op[data-status="failed"] .dsl-meta { color: #ff8a80; }',
      '.dsl-pane-wrap { grid-column: 1 / -1; min-width: 0; }',
      '.dsl-pane { margin: 5px 0 2px 22px; border-radius: 7px; overflow: hidden; border: 1px solid var(--border, #2a2f3a); background: #0d1017; }',
      '.dsl-panehead { display: flex; align-items: center; gap: 6px; padding: 3px 8px; background: rgba(255,255,255,0.045); font-size: 10px; color: var(--fg-muted, #98a2b3); font-family: var(--mono, ui-monospace, monospace); }',
      '.dsl-panehead b { color: var(--fg, #e6e9ef); font-weight: 600; }',
      '.dsl-panehead .dsl-grow { flex: 1 1 auto; }',
      '.dsl-term { padding: 6px 9px 8px; font-family: var(--mono, ui-monospace, monospace); font-size: 11px; line-height: 1.55; max-height: 320px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }',
      '.dsl-prompt { color: #7ee0a1; }',
      '.dsl-prompt span { color: var(--fg, #e6e9ef); }',
      '.dsl-out { margin: 2px 0 0; color: #cfd6e3; font-family: inherit; font-size: inherit; }',
      '.dsl-out.dim { color: var(--fg-muted, #98a2b3); }',
      '.dsl-code { display: flex; max-height: 320px; overflow: auto; font-family: var(--mono, ui-monospace, monospace); font-size: 11px; line-height: 1.55; }',
      '.dsl-gutter { flex: 0 0 auto; padding: 6px 6px 6px 9px; text-align: right; color: #4a5262; user-select: none; font-variant-numeric: tabular-nums; }',
      '.dsl-lines { flex: 1 1 auto; min-width: 0; padding: 6px 9px 6px 4px; white-space: pre-wrap; overflow-wrap: anywhere; }',
      '.dsl-add { color: #7ee0a1; background: rgba(52,96,74,0.28); display: block; }',
      '.dsl-del { color: #ff8a80; background: rgba(109,58,58,0.28); display: block; }',
      '.dsl-ctx { color: var(--fg-muted, #98a2b3); display: block; }',
      '.dsl-urlbar { display: flex; align-items: center; gap: 6px; padding: 5px 9px; background: #161b24; border-bottom: 1px solid #222836; }',
      '.dsl-addr { flex: 1 1 auto; min-width: 0; height: 21px; display: flex; align-items: center; padding: 0 8px; border-radius: 999px; background: #0d1017; border: 1px solid #222836; font-family: var(--mono, ui-monospace, monospace); font-size: 10.5px; color: #cfd6e3; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }',
      '.dsl-viewport { padding: 10px 12px; min-height: 54px; display: grid; gap: 5px; place-content: center; text-align: center; color: var(--fg-muted, #98a2b3); font-size: 10.5px; }',
      '.dsl-viewport pre { margin: 0; text-align: left; max-height: 220px; overflow: auto; font-family: var(--mono, ui-monospace, monospace); font-size: 10.5px; white-space: pre-wrap; color: #cfd6e3; }',
      '.dsl-raw { margin: 0; padding: 6px 9px 8px; max-height: 240px; overflow: auto; font-family: var(--mono, ui-monospace, monospace); font-size: 10.5px; line-height: 1.5; white-space: pre-wrap; color: #cfd6e3; }',
      '.dsl-sect { padding: 4px 9px 0; font-size: 9.5px; letter-spacing: 0.07em; text-transform: uppercase; color: var(--fg-muted, #98a2b3); }',
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

    /** @param text - raw text. @returns HTML-escaped text. */
    function esc(text) {
      return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }

    /**
     * Convert SGR escape sequences to styled HTML.
     *
     * Only styling is interpreted; every other control byte is dropped and the
     * text is escaped, so an output line can never inject markup.
     * @param text - terminal output.
     * @returns HTML string.
     */
    function ansiHtml(text) {
      var parts = String(text).split(/\u001b\[([0-9;]*)m/)
      var color = null
      var bold = false
      var dim = false
      var html = []
      for (var index = 0; index < parts.length; index += 2) {
        var chunk = esc(parts[index]).replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
        if (chunk !== '') {
          var style = []
          if (color !== null) style.push('color:' + color)
          if (bold) style.push('font-weight:600')
          if (dim) style.push('opacity:.65')
          html.push(style.length === 0 ? chunk : '<span style="' + style.join(';') + '">' + chunk + '</span>')
        }
        var code = parts[index + 1]
        if (code === undefined) break
        var params = code === '' ? [0] : code.split(';').map(Number)
        for (var slot = 0; slot < params.length; slot += 1) {
          var value = params[slot]
          if (value === 0) { color = null; bold = false; dim = false }
          else if (value === 1) bold = true
          else if (value === 2) dim = true
          else if (value === 22) { bold = false; dim = false }
          else if (value === 39) color = null
          else if (PALETTE[value] !== undefined) color = PALETTE[value]
          // 38;5;n is deliberately ignored: guessing a 256-colour ramp would be
          // worse than falling back to the default foreground.
        }
      }
      return html.join('')
    }

    /**
     * Split text into lines, capped.
     * @param text - source text.
     * @param cap - maximum lines.
     * @returns array of lines.
     */
    function toLines(text, cap) {
      var all = String(text === undefined || text === null ? '' : text).split('\n')
      return all.length > cap ? all.slice(0, cap) : all
    }

    /** @param ms - milliseconds. @returns a short duration. */
    function duration(ms) {
      if (!(ms > 0)) return ''
      if (ms < 1000) return Math.round(ms) + 'ms'
      if (ms < 60000) return (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + 's'
      return Math.floor(ms / 60000) + 'm' + Math.round((ms % 60000) / 1000) + 's'
    }

    /** A terminal pane: the command line, then its output. */
    function TerminalPane(props) {
      var surface = props.surface || {}
      var op = props.op
      var output = surface.output || ''
      var commandLines = toLines(surface.command || '', 6)
      var status = op.status === 'running'
        ? '运行中'
        : (op.status === 'failed' ? '退出异常' : '已退出') + (op.durationMs > 0 ? ' · ' + duration(op.durationMs) : '')
      return h('div', { className: 'dsl-pane' },
        h('div', { className: 'dsl-panehead' },
          h('b', {}, 'terminal'),
          h('span', {}, op.cwd || ''),
          h('span', { className: 'dsl-grow' }),
          h('span', {}, status),
        ),
        h('div', { className: 'dsl-term' },
          commandLines.map(function (line, index) {
            return h('div', { className: 'dsl-prompt', key: 'cmd' + index },
              index === 0 ? '$ ' : '> ',
              h('span', {}, line),
            )
          }),
          output === ''
            ? h('pre', { className: 'dsl-out dim' }, op.status === 'running' ? '…' : '(无输出)')
            : h('pre', { className: 'dsl-out', dangerouslySetInnerHTML: { __html: ansiHtml(output) } }),
        ),
      )
    }

    /** An editor pane: a diff when the call replaced a block, else the written text. */
    function EditorPane(props) {
      var surface = props.surface || {}
      var op = props.op
      var path = surface.path || '(未命名文件)'
      var isDiff = surface.oldText !== undefined || surface.newText !== undefined
      var body
      if (isDiff) {
        var removed = surface.oldText === undefined || surface.oldText === '' ? [] : toLines(surface.oldText, 60)
        var added = surface.newText === undefined || surface.newText === '' ? [] : toLines(surface.newText, 60)
        var rows = []
        removed.forEach(function (line, index) { rows.push(h('span', { className: 'dsl-del', key: 'd' + index }, '- ' + line)) })
        added.forEach(function (line, index) { rows.push(h('span', { className: 'dsl-add', key: 'a' + index }, '+ ' + line)) })
        if (rows.length === 0) rows.push(h('span', { className: 'dsl-ctx', key: 'none' }, '（空替换）'))
        body = h('div', { className: 'dsl-code' }, h('div', { className: 'dsl-lines' }, rows))
      } else if (surface.content !== undefined) {
        var contentLines = toLines(surface.content, 400)
        body = h('div', { className: 'dsl-code' },
          h('div', { className: 'dsl-gutter' }, contentLines.map(function (_, index) { return h('div', { key: 'g' + index }, index + 1) })),
          h('div', { className: 'dsl-lines' }, contentLines.map(function (line, index) {
            return h('div', { key: 'c' + index }, line === '' ? ' ' : line)
          })),
        )
      } else {
        body = h('div', { className: 'dsl-viewport' }, op.result === '' ? '（无内容）' : h('pre', {}, op.result))
      }
      return h('div', { className: 'dsl-pane' },
        h('div', { className: 'dsl-panehead' }, h('b', {}, isDiff ? 'diff' : (op.name === 'read' ? 'read' : 'editor')), h('span', {}, path)),
        body,
      )
    }

    /** A browser pane: the address bar the action ran against. */
    function BrowserPane(props) {
      var surface = props.surface || {}
      var op = props.op
      var url = surface.url || ''
      return h('div', { className: 'dsl-pane' },
        h('div', { className: 'dsl-urlbar' },
          h('div', { className: 'dsl-addr', title: url }, url === '' ? 'about:blank' : url),
          h('span', { className: 'dsl-meta' }, surface.action || op.name),
        ),
        op.result === ''
          ? h('div', { className: 'dsl-viewport' },
              h('div', {}, '没有画面可显示'),
              h('div', {}, op.status === 'running' ? '这个动作还在执行' : '该会话没有把页面像素写进日志'),
            )
          : h('div', { className: 'dsl-viewport' }, h('pre', {}, op.result)),
      )
    }

    /** Fallback pane: the raw input/output of a tool with no richer surface. */
    function GenericPane(props) {
      var op = props.op
      return h('div', { className: 'dsl-pane' },
        op.detail === '' ? null : h('div', { className: 'dsl-sect' }, '输入'),
        op.detail === '' ? null : h('pre', { className: 'dsl-raw' }, op.detail),
        op.result === '' ? null : h('div', { className: 'dsl-sect' }, op.status === 'failed' ? '错误输出' : '输出'),
        op.result === '' ? null : h('pre', { className: 'dsl-raw' }, op.result + (op.resultTruncated ? '\n… (已截断)' : '')),
      )
    }

    /** Choose the surface a human would have seen for this operation. */
    function Surface(props) {
      var op = props.op
      var surface = op.surface || {}
      if (op.kind === 'terminal' && surface.command !== undefined) return h(TerminalPane, { op: op, surface: surface })
      if (op.kind === 'file' && (op.name === 'edit' || op.name === 'write' || op.name === 'read')) return h(EditorPane, { op: op, surface: surface })
      if (op.kind === 'browser') return h(BrowserPane, { op: op, surface: surface })
      return h(GenericPane, { op: op })
    }

    /** One operation row plus the surface it opens. */
    function OperationRow(props) {
      var op = props.op
      var meta = op.status === 'running'
        ? '进行中'
        : (op.status === 'failed' ? '失败' : '完成') + (op.durationMs > 0 ? ' · ' + duration(op.durationMs) : '')
      return h('div', {
        className: 'dsl-op',
        'data-kind': op.kind,
        'data-status': op.status,
        'data-open': props.open ? 'true' : 'false',
        onClick: props.onToggle,
      },
        h('span', { className: 'dsl-kind' }, GLYPH[op.kind] || GLYPH.other),
        h('div', { className: 'dsl-main' },
          h('div', { className: 'dsl-line1' },
            h('span', { className: 'dsl-tool' }, op.name),
            h('span', { className: 'dsl-sum', title: op.summary }, op.summary === '' ? '(无参数)' : op.summary),
            h('span', { className: 'dsl-meta' }, meta),
          ),
        ),
        props.open
          ? h('div', { className: 'dsl-pane-wrap', onClick: function (event) { event.stopPropagation() } }, h(Surface, { op: op }))
          : null,
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

      var label = function (session) {
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
            : sessions.map(function (session) { return h('option', { key: session.id, value: session.id }, label(session)) })),
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
                h('div', {}, emptyText(counts, data)),
                h('div', {}, 'agent 每调用一次工具，这里就出现一行；点开是它当时真正看到的东西——终端画面、文件 diff、浏览器地址。'),
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
     * @param data - the last payload.
     * @returns the empty-state sentence.
     */
    function emptyText(counts, data) {
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
            description: function () { return 'agent 的操作现场：终端画面、文件 diff、浏览器地址，带状态与耗时' },
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
