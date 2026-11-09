import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sessionSections } from '../src/client/session-map-data.js'

const chief = { id: 'chief', name: 'Chief', sessionId: 'session-chief-2', parts: ['session-chief-1'] }
const writer = { id: 'writer', name: 'Writer', sessionId: 'session-writer' }
const ops = {
  id: 'r1', name: 'Ops', members: ['chief', 'writer'], sessionId: 'session-ops-own', ownParts: ['session-ops-own-1'],
  memberSessions: { chief: 'session-ops-chief', writer: 'session-ops-writer' },
}
const studio = { id: 'r2', name: 'Studio', members: ['chief'], sessionId: 'session-studio-own', ownParts: [], memberSessions: { chief: 'session-studio-chief' } }
const roster = {
  byId: { chief, writer },
  roomsById: { r1: ops, r2: studio },
  rooms: [ops, studio],
  agents: [{ id: 'agent', name: 'DSH Agent', sessions: ['session-agent'] }],
}
const section = (sections, key) => sections.find(entry => entry.key === key)

test('a Bot\'s map lists its own chat, its member Sessions, the group Sessions and the Agent', () => {
  const sections = sessionSections('chief', roster)
  assert.deepEqual(sections.map(entry => entry.key), ['private', 'member', 'groups', 'agents'])
  // The Bot id is the first part and `sessionId` the current one, so a part chain of two is three.
  assert.deepEqual(section(sections, 'private').rows.map(row => [row.sessionId, row.parts]), [['session-chief-2', 3]])
  assert.deepEqual(section(sections, 'member').rows.map(row => [row.label, row.sessionId]), [
    ['Ops', 'session-ops-chief'], ['Studio', 'session-studio-chief'],
  ])
  assert.deepEqual(section(sections, 'groups').rows.map(row => [row.label, row.sessionId, row.parts]), [
    ['Ops', 'session-ops-own', 3], ['Studio', 'session-studio-own', 2],
  ])
  assert.deepEqual(section(sections, 'agents').rows.map(row => row.sessionId), ['session-agent'])
})

test('a Bot outside a group lists only the groups it is in', () => {
  const sections = sessionSections('writer', roster)
  // The DSH Agent belongs to the team, so it is on every Bot's map.
  assert.deepEqual(sections.map(entry => entry.key), ['private', 'member', 'groups', 'agents'])
  assert.deepEqual(section(sections, 'member').rows.map(row => row.label), ['Ops'])
  assert.deepEqual(section(sections, 'groups').rows.map(row => row.label), ['Ops'])
})

test('a group\'s map lists its own Session and its members\' Sessions', () => {
  const sections = sessionSections('r1', roster)
  assert.deepEqual(sections.map(entry => entry.key), ['own', 'members'])
  assert.deepEqual(section(sections, 'own').rows.map(row => [row.sessionId, row.parts]), [['session-ops-own', 3]])
  assert.deepEqual(section(sections, 'members').rows.map(row => [row.label, row.sessionId]), [
    ['Chief', 'session-ops-chief'], ['Writer', 'session-ops-writer'],
  ])
})

test('a plain DSH Session has no map', () => {
  assert.equal(sessionSections('session-not-in-the-team', roster), null)
})
