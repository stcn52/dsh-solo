import assert from 'node:assert/strict'
import test from 'node:test'
import { describeCall, kindOf, projectOps, resultText, summarize } from '../src/core/ops.js'

/** One `tool/call` event. */
function call(seq, callId, name, args, time = 1000 + seq) {
  return { seq, time, type: 'tool/call', data: { callId, name, arguments: JSON.stringify(args) } }
}

/** One `tool/result` event. */
function result(seq, callId, text, isError = false, time = 2000 + seq) {
  return {
    seq,
    time,
    type: 'tool/result',
    data: { isError, source: { kind: 'tool', callId }, message: { content: [{ type: 'text', text }] } },
  }
}

test('a call without a result is still running — that is the live state', () => {
  const { ops } = projectOps([call(1, 'c1', 'bash', { command: 'ls -la', description: '列目录' })])
  assert.equal(ops.length, 1)
  assert.equal(ops[0].status, 'running')
  assert.equal(ops[0].kind, 'terminal')
  assert.equal(ops[0].summary, '列目录 · ls -la')
  assert.equal(ops[0].durationMs, 0)
})

test('a result closes its call and records duration', () => {
  const { ops } = projectOps([
    call(1, 'c1', 'bash', { command: 'go test ./...' }, 1000),
    result(2, 'c1', 'ok  \texample\t0.1s', false, 2600),
  ])
  assert.equal(ops.length, 1)
  assert.equal(ops[0].status, 'done')
  assert.equal(ops[0].durationMs, 1600)
  assert.match(ops[0].result, /ok/)
})

test('a failed result marks the operation failed', () => {
  const { ops } = projectOps([
    call(1, 'c1', 'read', { file_path: '/tmp/nope' }),
    result(2, 'c1', 'ENOENT: no such file', true),
  ])
  assert.equal(ops[0].status, 'failed')
  assert.equal(ops[0].isError, true)
  assert.equal(ops[0].kind, 'file')
  assert.equal(ops[0].summary, '/tmp/nope')
})

test('a result with no call keeps its own entry instead of vanishing', () => {
  const { ops } = projectOps([result(1, 'ghost', 'detached output')])
  assert.equal(ops.length, 1)
  assert.equal(ops[0].status, 'done')
  assert.equal(ops[0].summary, 'detached output')
})

test('non-tool events are ignored', () => {
  const { ops, lastSeq } = projectOps([
    { seq: 1, time: 1, type: 'assistant/message', data: {} },
    { seq: 2, time: 2, type: 'step/start', data: {} },
  ])
  assert.deepEqual(ops, [])
  assert.equal(lastSeq, 2)
})

test('maxOps keeps the newest operations', () => {
  const events = []
  for (let index = 0; index < 10; index += 1) {
    events.push(call(index * 2 + 1, `c${index}`, 'glob', { pattern: `p${index}` }))
    events.push(result(index * 2 + 2, `c${index}`, 'hit'))
  }
  const { ops, dropped } = projectOps(events, { maxOps: 3 })
  assert.deepEqual(ops.map(op => op.name), ['glob', 'glob', 'glob'])
  assert.equal(dropped, 7)
  assert.equal(ops.at(-1).summary, 'p9')
})

test('tool families drive the filter chips', () => {
  assert.equal(kindOf('bash'), 'terminal')
  assert.equal(kindOf('browser_open'), 'browser')
  assert.equal(kindOf('write'), 'file')
  assert.equal(kindOf('subagent'), 'agent')
  assert.equal(kindOf('todo_write'), 'other')
})

test('browser calls summarize the action and the target', () => {
  const shaped = describeCall('browser_open', { url: 'https://example.com', newTab: true }, '')
  assert.deepEqual(shaped, { summary: 'open · https://example.com', detail: 'open\nhttps://example.com' })
})

test('unparseable arguments still produce a readable line', () => {
  const shaped = describeCall('bash', undefined, '{"command": broken')
  assert.match(shaped.summary, /broken/)
})

test('a hostile argument object cannot inject a summary', () => {
  const shaped = describeCall('read', { file_path: '/etc/passwd', __proto__: { evil: true } }, '')
  assert.equal(shaped.summary, '/etc/passwd')
})

test('oversized results are clipped and flagged', () => {
  const huge = 'x'.repeat(20000)
  const { ops } = projectOps([call(1, 'c1', 'bash', { command: 'yes' }), result(2, 'c1', huge)])
  assert.equal(ops[0].resultTruncated, true)
  assert.ok(ops[0].result.length < 6100)
})

test('resultText joins text blocks only', () => {
  const event = {
    data: {
      message: {
        content: [
          { type: 'text', text: 'a' },
          { type: 'image', data: 'zzz' },
          { type: 'text', text: 'b' },
        ],
      },
    },
  }
  assert.equal(resultText(event), 'a\nb')
  assert.equal(resultText({}), '')
})

test('summarize counts the three states', () => {
  const { ops } = projectOps([
    call(1, 'a', 'bash', { command: '1' }),
    result(2, 'a', 'ok'),
    call(3, 'b', 'bash', { command: '2' }),
    result(4, 'b', 'boom', true),
    call(5, 'c', 'bash', { command: '3' }),
  ])
  assert.deepEqual(summarize(ops), { total: 3, running: 1, failed: 1, done: 1 })
})

test('a terminal surface carries the exact command line', () => {
  const { ops } = projectOps([call(1, 'c1', 'bash', { command: 'ls -la\n# comment', description: '列目录' })])
  assert.equal(ops[0].surface.kind, 'terminal')
  assert.equal(ops[0].surface.command, 'ls -la\n# comment')
  assert.equal(ops[0].surface.description, '列目录')
})

test('terminal output keeps newlines and escape sequences verbatim', () => {
  const raw = '\u001b[32mok\u001b[0m\nline2\n'
  const { ops } = projectOps([call(1, 'c1', 'bash', { command: 'go test' }), result(2, 'c1', raw)])
  assert.equal(ops[0].surface.output.includes('\u001b[32m'), true, 'ANSI is preserved for the renderer')
  assert.equal(ops[0].surface.output.split('\n').length, 2, 'trailing newline trimmed, inner newline kept')
})

test('an edit surface exposes the replaced block', () => {
  const { ops } = projectOps([call(1, 'c1', 'edit', { file_path: '/tmp/a.js', old_string: 'foo()', new_string: 'bar()' })])
  assert.deepEqual(ops[0].surface, { kind: 'file', path: '/tmp/a.js', oldText: 'foo()', newText: 'bar()' })
})

test('a write surface exposes the written text, capped', () => {
  const body = 'x'.repeat(9000)
  const { ops } = projectOps([call(1, 'c1', 'write', { file_path: '/tmp/a.md', content: body })])
  assert.equal(ops[0].surface.path, '/tmp/a.md')
  assert.ok(ops[0].surface.content.length <= 8001)
})

test('a browser surface exposes the address the human would see', () => {
  const { ops } = projectOps([call(1, 'c1', 'browser_open', { url: 'https://example.com/x' })])
  assert.equal(ops[0].surface.kind, 'browser')
  assert.equal(ops[0].surface.url, 'https://example.com/x')
  assert.equal(ops[0].surface.action, 'open')
})

test('agent-facing tools read like the thing a human saw', () => {
  assert.equal(describeCall('progress_update', { title: '宿主侧核心写完', message: '...' }, '').summary, '宿主侧核心写完')
  assert.equal(describeCall('test_live_run', { runner: 'nodeTest', targets: ['dsh-solo/tests/*.test.js'] }, '').summary, 'nodeTest · dsh-solo/tests/*.test.js')
  assert.equal(describeCall('todo_write', { todos: [{}, {}, {}] }, '').summary, '3 项待办')
  assert.equal(describeCall('ask_user_question', { questions: [{ question: 'REA 指什么？' }] }, '').summary, 'REA 指什么？')
})
