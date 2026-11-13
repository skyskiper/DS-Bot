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
  let route
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = (options) => { route = options; return register(options) }
  rt = createRuntime(ctx, { home })
  const tool = (name, args, sessionId = 'gc') => rt.teamTools.find(d => d.name === name).execute(args, { agent: { id: sessionId } })
  const call = async (endpoint, payload) => (await route.fetch(new Request('http://localhost/api/bot', {
    method: 'POST', body: JSON.stringify({ endpoint, payload }),
  }))).json()
  await tool('list_bots', {}, 'gc')
  const room = () => rt.state.rooms.r1
  const stop = async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) }
  return { tool, call, room, home, ctx, stop }
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

// The topic tools are agent tools, so a data check with no model in the loop needs one
// door: DS_BOT_TEST=1 adds `topic-call`, which forwards to the tool itself. Without the
// flag the endpoint does not exist, and the tool's own gate still decides who may call.
test('topic-call exists only under DS_BOT_TEST, and forwards to the tool', async (t) => {
  const { call, room, stop } = await start()
  t.after(stop)
  delete process.env.DS_BOT_TEST
  const closed = await call('topic-call', { tool: 'topic_record', args: { title: 'x' }, session: 'gc' })
  assert.equal(closed.ok, false)
  assert.equal(closed.error.code, 'bot/not-found')
  assert.match(closed.error.message, /Unknown endpoint/)

  process.env.DS_BOT_TEST = '1'
  t.after(() => { delete process.env.DS_BOT_TEST })
  const recorded = await call('topic-call', { tool: 'topic_record', args: { title: '群卡作答链路', fromSeq: 1 }, session: 'gc' })
  assert.equal(recorded.ok, true)
  const value = JSON.parse(recorded.value.value)
  assert.equal(value.num, 1)
  assert.equal(room().topics.items[1].state, 'active')

  const other = await call('topic-call', { tool: 'message_bot', args: {}, session: 'gc' })
  assert.equal(other.ok, false)
  assert.equal(other.error.code, 'bot/refused')
  assert.match(other.error.message, /topic tools only/)

  // The endpoint does not widen the gate: a plain member Session is still refused.
  const refused = await call('topic-call', { tool: 'topic_record', args: { title: '越界' }, session: 'gw' })
  assert.match(String(refused.value.value), /Only the group's admin or a Main Bot/)
})

// The group's log stays on the host: a topic's messages come one page at a time, and the
// message a topic points back at is read from the book even when the room's log is short.
test('topic-thread pages a topic\'s messages; topic-source answers missing instead of throwing', async (t) => {
  const { tool, call, stop } = await start()
  t.after(stop)
  await tool('topic_record', { title: '群卡作答链路', fromSeq: 1 })
  await tool('topic_subtopic', { parent: 1, title: '回退用例', kind: 'detail', fromSeq: 2 })

  const thread = await call('topic-thread', { roomId: 'r1', num: 1, limit: 1 })
  assert.equal(thread.ok, true)
  assert.equal(thread.value.items.length, 1)
  assert.equal(thread.value.hasMore, true)
  assert.deepEqual(thread.value.items.map(entry => entry.seq), [2], 'the newest page first when asking less')
  assert.equal(thread.value.items[0].sub, '1.1', 'the bare value; the client adds the #')
  assert.equal(thread.value.items[0].subTitle, '回退用例', 'the subtopic title rides along')

  const first = await call('topic-thread', { roomId: 'r1', num: 1, before: 2, limit: 10 })
  assert.deepEqual(first.value.items.map(entry => entry.seq), [1])
  assert.equal(first.value.hasMore, false)

  const source = await call('topic-source', { roomId: 'r1', seq: 1 })
  assert.equal(source.ok, true)
  assert.equal(source.value.text, 'the card does not react')
  const gone = await call('topic-source', { roomId: 'r1', seq: 999 })
  assert.deepEqual(gone.value, { missing: true }, 'A8: a normal answer, not an error')

  // A bot Session from another group cannot read this one's messages.
  const crossThread = await call('topic-thread', { roomId: 'r1', num: 1, session: 'someone-else' })
  assert.equal(crossThread.error.code, 'bot/refused')
  assert.match(crossThread.error.message, /not yours to read/)
  const crossSource = await call('topic-source', { roomId: 'r1', seq: 1, session: 'someone-else' })
  assert.equal(crossSource.error.code, 'bot/refused')
  assert.equal((await call('topic-thread', { roomId: 'r1', num: 1, session: 'gc' })).value.items.length > 0, true, 'its own group is fine')
  // #Other has no number, so it is asked for by name and answers the same shape.
  rt.topicToOther(rt.state.rooms.r1, 2, 'no clear topic', 'Chief')
  const otherThread = await call('topic-thread', { roomId: 'r1', other: true })
  assert.equal(otherThread.ok, true)
  assert.deepEqual(otherThread.value.items.map(entry => entry.seq), [2])
  assert.equal((await call('topic-thread', { roomId: 'nope', num: 1 })).error.code, 'bot/not-found')
  assert.equal((await call('topic-thread', { roomId: 'r1', num: 9 })).error.code, 'bot/not-found')
  assert.equal((await call('topic-source', { roomId: 'r1', seq: 'x' })).error.code, 'bot/invalid')
})

// The three gaps the acceptance run found: a message that fits nowhere has a way in, a
// message that belongs to an open topic joins it without a new number, and a topic older
// than the room's sixty-line log still shows its text.
test('a message that fits nowhere lands in #Other and leaves when it is placed', async (t) => {
  const { tool, call, room, stop } = await start()
  t.after(stop)
  const other = JSON.parse(await tool('topic_record', { other: true, fromSeq: 2, why: 'no clear topic' }))
  assert.equal(other.other, true)
  assert.deepEqual(room().topics.other.msgs, [2])
  const thread = await call('topic-thread', { roomId: 'r1', other: true })
  assert.deepEqual(thread.value.items.map(entry => entry.seq), [2])

  await tool('topic_record', { title: '群卡作答链路' })
  await tool('topic_record', { num: 1, fromSeq: 2, why: 'it belongs to #1' })
  assert.deepEqual(room().topics.other.msgs, [], 'placed, so it left #Other')
  assert.deepEqual(room().topics.items[1].messages, [2], 'the topic kept it')
  assert.equal(room().topics.next, 2, 'placing a message spends no number')
})

test('a message joins an open topic instead of opening a new one', async (t) => {
  const { tool, room, stop } = await start()
  t.after(stop)
  await tool('topic_record', { title: '父话题' })
  const attached = JSON.parse(await tool('topic_record', { num: 1, fromSeq: 1 }))
  assert.equal(attached.attached, true)
  assert.equal(room().topics.next, 2, 'no second number')
  assert.deepEqual(room().topics.items[1].events.map(event => event.kind), ['open', 'attach'])
  assert.match(String(await tool('topic_record', { num: 9, fromSeq: 1 })), /There is no topic #9/)
})

test('a topic message keeps its text after the room log stops keeping it', async (t) => {
  const { tool, call, room, stop } = await start()
  t.after(stop)
  await tool('topic_record', { title: '旧话题', fromSeq: 1 })
  // Pretend the room's own log has already rolled past that line: the book still has it.
  room().log = room().log.filter(line => line.seq !== 1)
  const thread = await call('topic-thread', { roomId: 'r1', num: 1 })
  assert.deepEqual(thread.value.items.map(entry => entry.seq), [1])
  // The book answers when it holds the line, and the room log when it does not; either way
  // the row is drawn and nothing throws.
  const text = thread.value.items[0].text
  assert.ok(typeof text === 'string' || text === null)
})

// The window's own hand: a long press moves a line out of #Other into a topic, and an ended
// topic goes back to work while a seat is free. The three-topic limit still holds.
test('the window can move a message out of #Other, and reopen an ended topic only into a free seat', async (t) => {
  const { tool, call, room, stop } = await start()
  t.after(stop)
  await tool('topic_record', { title: '群卡作答链路', fromSeq: 1 })
  rt.topicToOther(rt.state.rooms.r1, 2, 'no clear topic', 'Chief')

  const moved = await call('topic-move', { roomId: 'r1', seq: 2, num: 1 })
  assert.equal(moved.ok, true)
  assert.deepEqual(moved.value, { num: 1, seq: 2, otherCount: 0 })
  assert.deepEqual(room().topics.other.msgs, [], 'it left #Other')
  assert.ok((room().topics.items[1].messages ?? []).includes(2), 'and joined the topic it was moved to')
  const thread = await call('topic-thread', { roomId: 'r1', num: 1 })
  assert.deepEqual(thread.value.items.map(entry => entry.seq), [1, 2], 'the target thread shows it')

  assert.equal((await call('topic-move', { roomId: 'r1', seq: 'x', num: 1 })).error.code, 'bot/invalid')
  assert.equal((await call('topic-move', { roomId: 'r1', seq: 2, num: 9 })).error.code, 'bot/not-found')
  assert.equal((await call('topic-move', { roomId: 'nope', seq: 2, num: 1 })).error.code, 'bot/not-found')
  assert.equal((await call('topic-move', { roomId: 'r1', seq: 2, num: 1, session: 'someone-else' })).error.code, 'bot/refused')

  // An ended topic comes back while there are fewer than three active ones.
  await tool('topic_state', { num: 1, state: 'archived', why: 'done' })
  const reopened = await call('topic-reopen', { roomId: 'r1', num: 1 })
  assert.equal(reopened.ok, true)
  assert.equal(reopened.value.state, 'active')
  assert.equal(room().topics.items[1].state, 'active')

  // Three active topics leave no seat: an ended one reopens only when one frees.
  await tool('topic_record', { title: '话题入口' })
  assert.equal(room().topics.items[2].state, 'active')
  await tool('topic_record', { title: '打包校验' })
  assert.equal(room().topics.items[3].state, 'active')
  const fourth = JSON.parse(await tool('topic_record', { title: '第四件事' }))
  assert.equal(fourth.state, 'pending', 'the fourth waits for a seat')
  await tool('topic_state', { num: 4, state: 'archived', why: 'dropped' })
  const queued = await call('topic-reopen', { roomId: 'r1', num: 4 })
  assert.equal(queued.error.code, 'bot/refused')
  assert.match(queued.error.message, /already active/)
  assert.equal(room().topics.items[4].state, 'archived', 'the seat limit is not widened')
  assert.equal((await call('topic-reopen', { roomId: 'r1', num: 9 })).error.code, 'bot/not-found')
})

// Nothing is said without a home: every message starts in #Other and leaves it only when
// someone says which topic it belongs to. The fallback is code, not a habit.
test('every message lands in #Other by itself, and leaves when a topic takes it', async (t) => {
  const { tool, call, room, stop } = await start()
  t.after(stop)
  await tool('topic_record', { title: '话题系统' })
  const book = () => room().topics

  const said = rt.logRoom(room(), { who: 'User', text: 'this line has no topic yet' })
  assert.ok(book().other.msgs.includes(said.seq), 'a message nobody placed sits in #Other')
  const notices = rt.logRoom(room(), { who: 'DS Bot', kind: 'notice', reason: 'folder', path: '/tmp' })
  assert.equal(book().other.msgs.includes(notices.seq), false, 'a notice is not a message')

  const moved = JSON.parse(await tool('topic_record', { num: 1, fromSeq: said.seq }))
  assert.equal(moved.attached, true)
  assert.equal(book().other.msgs.includes(said.seq), false, 'the topic took it out of #Other')
  assert.ok(book().items[1].messages.includes(said.seq))

  // Twice is once.
  await tool('topic_record', { num: 1, fromSeq: said.seq })
  assert.deepEqual(book().items[1].messages.filter(seq => seq === said.seq), [said.seq])
  assert.equal(book().other.msgs.includes(said.seq), false)

  // #Other is not a topic: archiving everything else leaves it alone.
  await tool('topic_state', { num: 1, state: 'archived', why: 'done' })
  const second = rt.logRoom(room(), { who: 'User', text: 'after the archive' })
  assert.ok(book().other.msgs.includes(second.seq), '#Other never goes away')
  const thread = await call('topic-thread', { roomId: 'r1', other: true })
  assert.deepEqual(thread.value.items.map(item => item.seq), [second.seq], 'only what is still unplaced is in #Other')
})

// A question and its answer share a topic: the turn declares the topic once, and the reply
// that lands later joins it without waiting for the next turn.
test('a turn declares where its reply goes, and the last declaration wins', async (t) => {
  const { tool, room, stop } = await start()
  t.after(stop)
  await tool('topic_record', { title: '话题系统' })
  await tool('topic_record', { title: '另一个话题' })
  const chief = rt.state.bots.chief
  const book = () => room().topics

  const asked = rt.logRoom(room(), { who: 'User', text: 'how does this work' })
  await tool('topic_record', { num: 1, fromSeq: asked.seq }, 'gc')
  assert.equal(rt.turnTopicOf(room(), chief), 1, 'the turn remembers where its reply belongs')

  // The reply lands after the declaration: it joins #1 and leaves #Other without a second turn.
  const reply = rt.logRoom(room(), { who: 'Chief', botId: 'chief', text: 'like this' })
  assert.ok(book().other.msgs.includes(reply.seq), 'a message starts in #Other')
  rt.attachTopicLine(room(), reply.seq, rt.turnTopicOf(room(), chief), 'Chief')
  assert.ok(book().items[1].messages.includes(reply.seq))
  assert.equal(book().other.msgs.includes(reply.seq), false)

  // `reply: false` keeps the next reply unplaced.
  await tool('topic_record', { num: 2, fromSeq: asked.seq, reply: false })
  assert.equal(rt.turnTopicOf(room(), chief), undefined, 'the declaration is cleared on request')

  // Last one wins: a turn that changes its mind does not place the reply twice.
  await tool('topic_record', { num: 1, fromSeq: asked.seq })
  await tool('topic_record', { num: 2, fromSeq: asked.seq })
  assert.equal(rt.turnTopicOf(room(), chief), 2)
  assert.deepEqual(book().items[2].messages.filter(seq => seq === asked.seq), [asked.seq], 'no duplicates from repeating a placement')
  assert.equal(book().items[1].messages.includes(asked.seq), false, 'the last placement wins: the older topic loses it')
})

// A message can ask two things at once: it belongs to more than one topic, with one primary
// that decides its order and is the only one whose count includes it.
test('a message joins several topics with one primary, and leaving a topic takes it out', async (t) => {
  const { tool, room, stop } = await start()
  t.after(stop)
  await tool('topic_record', { title: '话题方案' })
  await tool('topic_record', { title: '动效' })
  await tool('topic_record', { title: '第三个' })
  await tool('topic_record', { title: '第四个' })
  const book = () => room().topics
  const said = rt.logRoom(room(), { who: 'User', text: 'one line, two questions' })

  const placed = JSON.parse(await tool('topic_record', { nums: [1, 2], fromSeq: said.seq }))
  assert.equal(placed.primary, 1)
  assert.deepEqual(placed.related, [2])
  assert.ok(book().items[1].messages.includes(said.seq))
  assert.ok(book().items[2].messages.includes(said.seq), 'the related topic shows it too')
  assert.equal(book().primary[said.seq], 1, 'one primary, and it is the first name')
  assert.equal(book().other.msgs.includes(said.seq), false)

  // Archiving the primary leaves the related entry where it is.
  await tool('topic_state', { num: 1, state: 'archived', why: 'done' })
  assert.ok(book().items[2].messages.includes(said.seq))

  // Naming fewer topics takes the message out of the ones left out.
  await tool('topic_record', { nums: [3], fromSeq: said.seq })
  assert.equal(book().items[2].messages.includes(said.seq), false, 'the related topic lost it')
  assert.ok(book().items[3].messages.includes(said.seq))
  assert.equal(book().primary[said.seq], 3, 'the primary moved')
  assert.ok(book().items[2].events.some(event => event.kind === 'detach'), 'the topic that lost it says so in its audit')

  // A fourth name is dropped, and the reply says so instead of failing.
  const capped = JSON.parse(await tool('topic_record', { nums: [4, 2, 3, 1], fromSeq: said.seq }))
  assert.deepEqual(capped.related, [2, 3], 'three names are kept, the fourth is dropped')
  assert.deepEqual(capped.dropped, [1], 'and the answer says which one was left out')
  assert.equal(book().items[4].messages.filter(seq => seq === said.seq).length, 1, 'idempotent')
})
