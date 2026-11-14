import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('..', import.meta.url))
const { outputFiles } = await build({
  stdin: { contents: "export * from './src/client/annotations-view.js'", resolveDir: root },
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const module = { exports: {} }
runInNewContext(outputFiles[0].text, { module, exports: module.exports, require: () => ({}), window: { addEventListener() {}, removeEventListener() {} }, console }, { filename: 'bundle.cjs' })
const view = module.exports

const reads = {
  10: { think: 'he wants it planned', task: { num: 1, status: 'in_progress', progress: 'drafting' }, at: 10 },
  11: { think: 'just a thought', at: 11 },
  12: { task: { num: 1, status: 'completed', result: { ok: true, summary: 'shipped' } }, at: 12 },
  13: { task: { num: 2, status: 'completed', result: { ok: false, summary: 'dropped' } }, at: 13 },
  14: { task: { num: 3, status: 'pending' }, at: 14 },
}

test('the task list keeps what is live, the newest finished few, and counts the rest', () => {
  const extra = { ...reads }
  for (let num = 4; num <= 8; num += 1) extra[100 + num] = { task: { num, status: 'completed', result: { ok: true, summary: 'x' } }, at: 100 + num }
  const { live, done, more } = view.taskList(extra, { recent: 3 })
  assert.deepEqual(Array.from(live, task => task.num), [3], 'pending and in progress are listed as work in hand')
  assert.equal(done.length, 3)
  assert.equal(more, 4, 'the rest fold into one line, not dropped silently')
})

test('only the newest annotation with a status moves a task', () => {
  const tasks = view.tasksOf(reads)
  assert.deepEqual(Array.from(tasks, task => [task.num, task.status]), [[1, 'completed'], [2, 'completed'], [3, 'pending']])
})

test('a message with no annotation draws nothing at all', () => {
  assert.equal(view.annotationLine(undefined), undefined)
  assert.equal(view.annotationLine({}), undefined)
  const line = view.annotationLine(reads[10])
  assert.equal(line.think, 'he wants it planned')
  assert.deepEqual({ num: line.num, status: line.status, progress: line.progress }, { num: 1, status: 'in_progress', progress: 'drafting' })
})

test('a filter keeps only the messages of that task, and hides what belongs to none', () => {
  assert.equal(view.keeps(reads[10], undefined), true)
  assert.equal(view.keeps(reads[10], 1), true)
  assert.equal(view.keeps(reads[11], 1), false, 'a message in no task belongs to no selection')
  assert.match(view.filterLabel({ num: 1, name: '实现任务注解' }, 3), /#1 实现任务注解/)
  assert.match(view.filterLabel({ num: 1, name: '实现任务注解' }, 3), /3/)
})

test('a task with a name shows it beside the number, and one without falls back to the number', () => {
  assert.equal(view.taskTitle({ num: 4, name: '补话题动效' }), '#4 补话题动效')
  assert.equal(view.taskTitle({ num: 4 }), '#4')
  assert.equal(view.taskTitle({ num: 4, name: '' }), '#4')
  assert.equal(view.taskTitle(undefined), '')
  assert.equal(view.annotationLine({ task: { num: 2, name: '右栏任务列表', status: 'in_progress' } }).name, '右栏任务列表')
})
