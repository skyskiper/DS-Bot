import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRuntime } from '../index.js'
import { fakeContext } from './fake-ctx.js'
import { ACTIVE_LIMIT, SUB_LIMIT, TITLE_MAX } from '../src/host/topics.js'

// The code, not the model, holds the limits: three active topics, three subtopics each,
// numbering that never repeats, the six states, the five-minute subtopic, and #Other.
// These assert the stored data, which is what the client and the next turn read back.

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
      log: [
        { seq: 1, botId: undefined, text: 'the card does not react', time: 1 },
        { seq: 2, botId: undefined, text: 'it should open the Bot chat', time: 2 },
      ],
    },
  },
  agents: {},
  exchanges: [],
  exchangeTurns: {},
  questions: {},
  prefs: {},
  revision: 0,
})

async function start(seed = TEAM()) {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-topics-'))
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
  const stop = async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) }
  return { tool, room, home, ctx, stop }
}

test('T1: a recorded topic gets #1, points at its message, and takes the first seat', async (t) => {
  const { tool, room, stop } = await start()
  t.after(stop)
  const answer = JSON.parse(await tool('topic_record', { title: '群卡作答链路', fromSeq: 1, acceptance: 'a card can be answered in the group' }))
  assert.equal(answer.num, 1)
  assert.equal(answer.state, 'active')
  assert.equal(room().topics.next, 2)
  assert.equal(room().topics.items[1].fromSeq, 1)
  assert.equal(room().topics.items[1].title, '群卡作答链路')
  assert.deepEqual(room().topics.items[1].events.map(event => event.kind), ['open'])
})

test('T2/T3: the fourth topic queues instead of being lost, and a freed seat takes it', async (t) => {
  const { tool, room, stop } = await start()
  t.after(stop)
  for (let i = 1; i <= ACTIVE_LIMIT; i += 1) assert.equal(JSON.parse(await tool('topic_record', { title: `事 ${i}` })).state, 'active')
  const fourth = JSON.parse(await tool('topic_record', { title: '第四件' }))
  assert.equal(fourth.num, 4)
  assert.equal(fourth.state, 'pending', 'the fourth waits rather than being dropped')
  assert.match(fourth.note, /kept/)

  // Archiving one hands its seat to the oldest waiting topic.
  const moved = JSON.parse(await tool('topic_state', { num: 1, state: 'archived', why: 'done' }))
  assert.equal(moved.promoted, 4)
  assert.equal(room().topics.items[4].state, 'active')
})

test('T4: the fourth subtopic joins the closest one instead of opening', async (t) => {
  const { tool, room, stop } = await start()
  t.after(stop)
  await tool('topic_record', { title: '父话题' })
  for (let i = 1; i <= SUB_LIMIT; i += 1) {
    const sub = JSON.parse(await tool('topic_subtopic', { parent: 1, title: `细节 ${i}`, kind: 'detail' }))
    assert.equal(sub.sub, i)
  }
  const fourth = JSON.parse(await tool('topic_subtopic', { parent: 1, title: '再来一个细节', kind: 'detail', fromSeq: 2 }))
  assert.equal(fourth.merged, true)
  assert.equal(Object.keys(room().topics.items[1].subs).length, SUB_LIMIT, 'no fourth subtopic is created')
  assert.ok(room().topics.items[1].subs[fourth.sub].messages.includes(2), 'the message still lands somewhere')
})

test('T5: a subtopic archives after five idle minutes, the parent keeps it', async (t) => {
  const { tool, room, stop } = await start()
  t.after(stop)
  await tool('topic_record', { title: '父话题' })
  await tool('topic_subtopic', { parent: 1, title: '细节', kind: 'progress' })
  rt.topicsSweep(Date.now() + 4 * 60 * 1000)
  assert.equal(room().topics.items[1].subs[1].state, 'active', 'four minutes is not quiet yet')
  rt.topicsSweep(Date.now() + 6 * 60 * 1000)
  assert.equal(room().topics.items[1].subs[1].state, 'archived')
  assert.ok(room().topics.items[1].subs[1], 'archived, not deleted')
})

test('T8: a message that fits nowhere sits in #Other and moves out when told where', async (t) => {
  const { tool, room, stop } = await start()
  t.after(stop)
  await tool('topic_record', { title: '群卡作答链路' })
  const other = rt.topicToOther(room(), 2, 'no clear topic', 'Chief')
  assert.equal(other.count, 1)
  assert.deepEqual(room().topics.other.msgs, [2])

  const moved = JSON.parse(await tool('topic_record', { title: '并入', parent: 1, kind: 'detail', fromSeq: 2 }))
  assert.equal(moved.num, 1)
  assert.deepEqual(room().topics.other.msgs, [2], 'recording does not move it by itself')
  const moved2 = rt.topicTools.move({ room: room(), seq: 2, num: 1, by: 'user', why: 'it belongs to #1' })
  assert.equal(moved2.num, 1)
  assert.deepEqual(room().topics.other.msgs, [], 'moved out of Other')
})

test('T9: a preference change is audited and does not touch topics already recorded', async (t) => {
  const { tool, room, stop } = await start()
  t.after(stop)
  await tool('topic_record', { title: '已有话题' })
  const before = JSON.parse(await tool('topic_prefs', { subtopic: 'strict', naming: 'verb-object, at most 8 characters', why: 'fewer subtopics' }))
  assert.equal(before.prefs.subtopic, 'strict')
  assert.equal(room().topicPrefs.audit.length, 1)
  const [entry] = room().topicPrefs.audit
  assert.equal(entry.before.subtopic, 'loose')
  assert.equal(entry.after.subtopic, 'strict')
  assert.equal(entry.by, 'Chief')
  assert.deepEqual(room().topics.items[1].events.map(event => event.kind), ['open'], 'a preference does not rewrite history')
})

test('only the group admin or a Main Bot keeps the topics; titles are cut to eight characters', async (t) => {
  const { tool, room, stop } = await start()
  t.after(stop)
  const refused = await tool('topic_record', { title: '别人的话题' }, 'gw')
  assert.match(String(refused), /Only the group's admin or a Main Bot/)

  const created = JSON.parse(await tool('topic_record', { title: '一二三四五六七八九十' }))
  assert.equal(Array.from(room().topics.items[created.num].title).length, TITLE_MAX)
})

test('the state machine refuses a queue when there is room, and refuses the unlisted state', async (t) => {
  const { tool, stop } = await start()
  t.after(stop)
  await tool('topic_record', { title: '话题' })
  assert.match(String(await tool('topic_state', { num: 1, state: 'pending' })), /room for it to be active/)
  // The schema refuses a state that is not one of the six before the handler sees it.
  await assert.rejects(() => tool('topic_state', { num: 1, state: 'sleeping' }), /must be one of/)
  const archived = JSON.parse(await tool('topic_state', { num: 1, state: 'archived' }))
  assert.equal(archived.state, 'archived')
  assert.match(String(await tool('topic_state', { num: 1, state: 'blocked' })), /reopen it first/)
  assert.equal(JSON.parse(await tool('topic_state', { num: 1, state: 'active' })).state, 'active')
})

test('a superseded topic keeps its number and points at the one that replaces it', async (t) => {
  const { tool, room, stop } = await start()
  t.after(stop)
  await tool('topic_record', { title: '旧话题' })
  const { old, num } = JSON.parse(await tool('topic_supersede', { num: 1, title: '新话题', why: 'corrected' }))
  assert.equal(old, 1)
  assert.equal(num, 2)
  assert.equal(room().topics.items[1].state, 'dropped')
  assert.equal(room().topics.items[1].replacedBy, 2)
  assert.equal(room().topics.items[2].replaces, 1)
})
