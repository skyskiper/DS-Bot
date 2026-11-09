import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { sessionSections } from '../src/client/session-map-data.js'

// The header seat is a React component; bundle it with React external, as the other
// client tests do, and call it with plain hooks and props.
const bundle = await build({
  stdin: { contents: "export { SessionMapButton } from './src/client/session-map.js'", resolveDir: dirname(dirname(fileURLToPath(import.meta.url))) },
  bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const componentModule = { exports: {} }
const react = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  useState: initial => [initial, () => {}], useEffect: () => {}, useRef: current => ({ current }), useLayoutEffect: () => {},
  createContext: initial => ({ value: initial }), useContext: ctx => ctx.value,
}
runInNewContext(bundle.outputFiles[0].text, { module: componentModule, exports: componentModule.exports, require: name => (name === 'react' ? react : {}) })
const { SessionMapButton } = componentModule.exports

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


test('the header seat opens the map for a Bot and a group, and shows nothing for a plain Session', () => {
  const opened = []
  const actions = { openMap: id => opened.push(id) }
  const roster = { byId: { chief: { id: 'chief', name: 'Chief' } }, roomsById: { r1: { id: 'r1', name: 'Ops' } } }
  const useRoster = selector => selector(roster)
  const sessions = { byId: { 'session-plain': { id: 'session-plain' } } }
  const useSessions = selector => selector(sessions)
  assert.equal(SessionMapButton({ sessionId: 'session-plain', useRoster, useSessions, actions }), null)
  const botButton = SessionMapButton({ sessionId: 'chief', useRoster, useSessions, actions })
  assert.equal(botButton.type, 'button')
  assert.equal(botButton.props['aria-label'], 'Session map')
  botButton.props.onClick()
  SessionMapButton({ sessionId: 'r1', useRoster, useSessions, actions }).props.onClick()
  assert.deepEqual(opened, ['chief', 'r1'])
})


test('the shell header owns the utilities seat, so the Bot header draws it itself', () => {
  const core = new SlotCore()
  const Comp = () => null
  core.register({ name: 'root', children: { 'conversation.session.header': { kind: 'single', scope: 'session' } } }, Comp)
  // ui-conversation registers its header with the four child slots, the utilities seat among them.
  core.register({ name: 'conversation.session.header', priority: 0, children: { 'conversation.session.header.utilities': { kind: 'list', scope: 'session' } } }, Comp)
  // A plugin header shadows that entry at a lower priority. The runtime refuses a
  // second declaration of the seat, so the shadow cannot ask for the shell's row...
  assert.throws(() => core.register({ name: 'conversation.session.header', priority: -1, children: { 'conversation.session.header.utilities': { kind: 'list', scope: 'session' } } }, Comp), /already declared/)
  // ...and registers without children, drawing the seat in its own header instead.
  core.register({ name: 'conversation.session.header', priority: -1 }, Comp)
  assert.deepEqual(core.entriesOfSlot('conversation.session.header').map(entry => entry.options.priority), [-1])
})
