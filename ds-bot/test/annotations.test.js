import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRuntime } from '../index.js'
import { fakeContext } from './fake-ctx.js'
import { projectTasks } from '../src/host/annotations.js'

// The annotation is the only way a task moves: one line of reasoning per message, the task it
// belongs to, and a projection read from those annotations rather than kept in a table.

let rt

const TEAM = () => ({
  version: 1,
  mainBotIds: ['chief'],
  bots: {
    chief: { id: 'chief', name: 'Chief', role: 'Lead', sessionId: 'chief', createdAt: 1 },
    writer: { id: 'writer', name: 'Writer', role: 'Write', sessionId: 'writer', createdAt: 2 },
  },
  rooms: {
    r1: {
      id: 'r1', name: 'Ops', members: ['chief', 'writer'], mode: 'admin', admin: 'chief', named: true,
      sessions: { chief: 'gc', writer: 'gw' },
      log: [{ seq: 1, botId: undefined, text: 'first', time: 1 }, { seq: 2, botId: undefined, text: 'second', time: 2 }],
    },
  },
  agents: {}, exchanges: [], exchangeTurns: {}, questions: {}, prefs: {}, revision: 0,
})

async function start(seed = TEAM()) {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-annotations-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(seed))
  const ctx = fakeContext()
  Object.assign(ctx, {
    workspaceRegistry: { get: () => undefined, resolveByPath: async () => undefined, create: async path => ({ id: 'w1', path }), archiveSession: async () => {} },
    sessionController: { create: async () => ({ sessionId: 's1' }), resolveAgent: async sessionId => ({ agent: { session: { id: sessionId }, followup() {} } }), selectModel: async () => {} },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {} },
  })
  rt = createRuntime(ctx, { home })
  const tool = (name, args, sessionId = 'gc') => rt.teamTools.find(d => d.name === name).execute(args, { agent: { id: sessionId } })
  await tool('list_bots', {}, 'gc')
  const room = () => rt.state.rooms.r1
  return { tool, room, stop: () => rmSync(home, { recursive: true, force: true }) }
}

test('an annotation records a line of reasoning and the task it belongs to', async (t) => {
  const { tool, room, stop } = await start()
  t.after(stop)
  const said = JSON.parse(await tool('annotate', { seq: 1, think: 'he wants the launch planned', task: { num: 1, status: 'in_progress', progress: 'drafting', say: 'I will draft it' } }))
  assert.equal(said.seq, 1)
  assert.equal(said.task.num, 1)
  assert.equal(room().reads['1'].think, 'he wants the launch planned')
  assert.equal(room().reads['1'].by, 'Chief')
})

test('a finished task is refused without a result, and only a reopen moves it back', async (t) => {
  const { tool, room, stop } = await start()
  t.after(stop)
  await tool('annotate', { seq: 1, task: { num: 1, status: 'in_progress' } })
  const refused = await tool('annotate', { seq: 2, task: { num: 1, status: 'completed' } })
  assert.match(String(refused), /completed task says what came of it/)
  const done = await tool('annotate', { seq: 2, task: { num: 1, status: 'completed', result: { ok: true, summary: 'shipped' } } })
  assert.match(String(done), /completed/)
  const back = await tool('annotate', { seq: 2, task: { num: 1, status: 'in_progress' } })
  assert.match(String(back), /reopen it first/)
  const reopened = await tool('annotate', { seq: 2, task: { num: 1, status: 'in_progress' }, reopen: true })
  assert.match(String(reopened), /in_progress/)
  assert.equal(projectTasks(room()).find(entry => entry.num === 1).status, 'in_progress')
})

test('only the group\'s admin or a Main Bot annotates', async (t) => {
  const { tool, stop } = await start()
  t.after(stop)
  const refused = await tool('annotate', { seq: 1, task: { num: 1, status: 'in_progress' } }, 'gw')
  assert.match(String(refused), /Only the group's admin or a Main Bot/)
})

test('the task list is a projection: the newest annotation with a status wins, think alone moves nothing', async (t) => {
  const { tool, room, stop } = await start()
  t.after(stop)
  await tool('annotate', { seq: 1, task: { num: 1, status: 'pending', progress: 'queued' } })
  await tool('annotate', { seq: 2, task: { num: 1, status: 'in_progress', progress: 'started' } })
  await tool('annotate', { seq: 2, think: 'just a thought' })
  const tasks = projectTasks(room())
  assert.equal(tasks.length, 1)
  assert.equal(tasks[0].status, 'in_progress')
  assert.equal(tasks[0].progress, 'started')
  assert.equal(rt.tasksOf('r1')[0].status, 'in_progress')
})

test('say posts the message and its annotation in one call, and still posts when the annotation is refused', async (t) => {
  const { tool, room, stop } = await start()
  t.after(stop)
  const said = JSON.parse(await tool('say', { text: 'planning it now', think: 'he asked for a plan', task: { num: 1, status: 'in_progress' } }))
  assert.equal(said.annotated, true)
  const line = room().log.find(entry => entry.seq === said.seq)
  assert.equal(line.text, 'planning it now')
  assert.equal(room().reads[String(said.seq)].think, 'he asked for a plan')

  const degraded = JSON.parse(await tool('say', { text: 'done then', task: { num: 1, status: 'completed' } }))
  assert.equal(degraded.annotated, false, 'a bad annotation does not cost the user the message')
  assert.match(degraded.note, /posted without it/)
  assert.ok(room().log.some(entry => entry.seq === degraded.seq && entry.text === 'done then'))
})

test('the pointer from the Session\'s seq to the log\'s is found for a line logged before it', async (t) => {
  const seed = TEAM()
  seed.rooms.r1.log = [{ seq: 1, who: 'User', text: '继续', time: 1000, session: true }]
  const { tool, room, stop } = await start(seed)
  t.after(stop)
  // The chat row carries the Session's seq; the read is filed under the log's.
  rt.ctx.sessionController.page = async () => ({
    records: [{ event: { type: 'user/message', seq: 42, time: 1000, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '继续' }] } } }],
    hasMore: false,
  })
  await tool('annotate', { seq: 1, think: 'he says go on', task: { num: 1, status: 'in_progress' } })
  assert.equal(room().readsIndex['42'], 1)
})

test('a read under no message is dropped, and a seq that is no message is refused', async (t) => {
  const seed = TEAM()
  seed.rooms.r1.reads = { 0: { think: 'written by mistake' }, 1: { think: 'kept' } }
  const { tool, room, stop } = await start(seed)
  t.after(stop)
  const refused = await tool('annotate', { seq: 0, think: 'nowhere' })
  assert.match(String(refused), /seq of the message/)
  assert.equal(rt.dropStrayReads('r1'), true)
  assert.deepEqual(Object.keys(room().reads), ['1'])
})
