import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRuntime } from '../index.js'
import { fakeContext } from './fake-ctx.js'

let rt

const TEAM = {
  version: 1,
  mainBotIds: ['chief'],
  bots: {
    chief: { id: 'chief', name: 'Chief', role: 'Lead', sessionId: 'chief', createdAt: 1 },
    writer: { id: 'writer', name: 'Writer', role: 'Write', sessionId: 'writer', createdAt: 2 },
  },
  rooms: {},
  agents: {},
  exchanges: [],
  exchangeTurns: {},
  questions: {},
  prefs: {},
  revision: 0,
}

async function start(seed = TEAM) {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-questions-'))
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
  ctx.connection.fetch.register = (options) => {
    route = options
    return register(options)
  }
  rt = createRuntime(ctx, { home })
  let seq = 0
  const emit = (id, type, data) => {
    for (const listener of ctx.listeners.get('session/event') ?? []) {
      if (listener.length >= 2) listener({ id }, { type, seq: ++seq, data })
    }
  }
  const ask = (sessionId, callId) => rt.teamTools.find(d => d.name === 'ask_user').execute(
    { question: 'Which name?', options: [{ label: 'Lookout' }, { label: 'Scout' }] },
    { agent: { id: sessionId }, callId, concludeTurn() {} },
  )
  const questions = async () => (await (await route.fetch(new Request('http://localhost/api/bot', {
    method: 'POST', body: JSON.stringify({ endpoint: 'state', payload: {} }),
  }))).json()).value.questions
  // Loading once fills the Session-owner indexes turns.js filters events by.
  await rt.teamTools.find(d => d.name === 'list_bots').execute({}, { agent: { id: 'chief' } })
  return { emit, ask, questions, stop: async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) } }
}

const text = value => [{ type: 'text', text: value }]

test('a card asked in a hidden Bot-to-Bot turn keeps its call id, and closing it records at that call', async (t) => {
  const { emit, ask, questions, stop } = await start()
  t.after(stop)
  emit('writer', 'turn/start', { turn: 1 })
  emit('writer', 'user/message', { content: text('[Message from Chief]\nThe user wants a new Bot; ask them for its name'), source: { kind: 'bot', role: 'request', senderSessionId: 'chief', senderName: 'Chief', exchangeId: 'x1', hop: 0 } })
  await ask('writer', 'call-1')
  const asked = (await questions()).writer
  assert.equal(asked.question, 'Which name?')
  assert.equal(asked.callId, 'call-1')
  emit('writer', 'user/message', { content: text('Call it Scout'), source: { kind: 'user' } })
  assert.equal((await questions()).writer, undefined)
  assert.deepEqual(rt.state.closedCards, { writer: { 'call-1': 'replied' } })
})

test('a card asked in a visible turn stays at its call', async (t) => {
  const { emit, ask, questions, stop } = await start()
  t.after(stop)
  emit('writer', 'turn/start', { turn: 1 })
  emit('writer', 'user/message', { content: text('Help me name a Bot'), source: { kind: 'user' } })
  await ask('writer', 'call-2')
  assert.equal((await questions()).writer.callId, 'call-2')

  // A message that asks for an answer in the recipient's own chat is visible too.
  emit('writer', 'turn/end', { turn: 1, reason: { kind: 'completed' } })
  emit('writer', 'turn/start', { turn: 2 })
  emit('writer', 'user/message', { content: text('[Message from Chief · the user sees your reply here]\nIntroduce yourself'), source: { kind: 'bot', role: 'request', audience: 'user', senderSessionId: 'chief', senderName: 'Chief', exchangeId: 'x2', hop: 0 } })
  await ask('writer', 'call-3')
  assert.equal((await questions()).writer.callId, 'call-3')
})

// A Bot whose group calls it starts a turn in the group Session, not in its own chat. The
// card it left in its own chat is what "Needs you" points at, so that turn retires it —
// otherwise five of them sit there for days (the real case: 14 cards, the oldest 11-06).
const GROUPED = {
  ...TEAM,
  rooms: { r1: { id: 'r1', name: 'Ops', members: ['chief', 'writer'], mode: 'admin', admin: 'chief', named: true, sessions: { writer: 'gw' } } },
}

test('a turn in its group retires the question the Bot left in its own chat', async (t) => {
  const { emit, ask, questions, stop } = await start(GROUPED)
  t.after(stop)
  emit('writer', 'turn/start', { turn: 1 })
  emit('writer', 'user/message', { content: text('How should we name it?'), source: { kind: 'user' } })
  await ask('writer', 'call-own')
  assert.equal((await questions()).writer?.question, 'Which name?')

  // The group calls it: the turn starts in the group Session.
  emit('gw', 'turn/start', { turn: 1 })
  assert.equal((await questions()).writer, undefined, 'the old card is gone')
  assert.deepEqual(rt.state.closedCards, { writer: { 'call-own': 'replied' } })
})

test('its own chat keeps the card it is asked in', async (t) => {
  const { emit, ask, questions, stop } = await start(GROUPED)
  t.after(stop)
  emit('writer', 'turn/start', { turn: 1 })
  emit('writer', 'user/message', { content: text('Name it'), source: { kind: 'user' } })
  await ask('writer', 'call-own-2')
  emit('writer', 'turn/end', { turn: 1, reason: { kind: 'completed' } })
  emit('writer', 'turn/start', { turn: 2 })
  assert.equal((await questions()).writer?.question, 'Which name?', 'a turn in its own chat leaves the card alone')
})
