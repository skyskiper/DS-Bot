import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { createRuntime } from '../index.js'
import { fakeContext } from './fake-ctx.js'

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))
const { outputFiles } = await build({
  stdin: {
    contents: "export { ContextMenu } from './src/client/context-menu.js'\nexport { TeamSidebar } from './src/client/sidebar.js'",
    resolveDir: PLUGIN,
  },
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const react = {
  createContext: (initial) => { const ctx = { value: initial }; ctx.Provider = ({ value, children }) => { ctx.value = value; return children }; return ctx },
  useContext: ctx => ctx.value,
  useCallback: fn => fn,
  useSyncExternalStore: (_sub, getSnapshot) => getSnapshot(),
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  Fragment: Symbol('Fragment'),
  useEffect() {},
  useLayoutEffect() {},
  useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
  useMemo: make => make(),
  useRef: current => ({ current }),
  useId: () => 'id',
}
const mod = { exports: {} }
runInNewContext(outputFiles[0].text, {
  module: mod,
  exports: mod.exports,
  require: name => (name === 'react' ? react : name === 'react-dom' ? { createPortal: node => node } : {}),
  window: { innerWidth: 1280, innerHeight: 800, addEventListener() {}, removeEventListener() {} },
  document: { body: {}, documentElement: { hasAttribute: () => false }, addEventListener() {}, removeEventListener() {} },
})
const { } = mod.exports

function start(saved) {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-sections-'))
  if (saved !== undefined) writeFileSync(join(home, 'state.json'), JSON.stringify(saved))
  const ctx = fakeContext()
  let sessions = 0
  Object.assign(ctx, {
    workspaceRegistry: {
      resolveByPath: async () => undefined,
      create: async path => ({ id: 'w1', path }),
      archiveSession: async () => {},
    },
    sessionController: {
      create: async () => ({ sessionId: `s${++sessions}` }),
      resolveAgent: async sessionId => ({ agent: { id: sessionId, session: { id: sessionId }, followup() {} } }),
      selectModel: async () => {},
    },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {} },
  })
  let route
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = (options) => {
    route = options
    return register(options)
  }
  const rt = createRuntime(ctx, { home })
  const call = async (endpoint, payload) => {
    const response = await route.fetch(new Request('http://localhost/api/bot', { method: 'POST', body: JSON.stringify({ endpoint, payload }) }))
    return response.json()
  }
  const tool = name => rt.teamTools.find(entry => entry.name === name)
  const stop = async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  }
  return { call, tool, stop, home }
}

const baseTeam = () => ({
  version: 1,
  mainBotIds: ['chief'],
  bots: {
    chief: { id: 'chief', sessionId: 'chief', name: 'Chief', role: 'Lead', instructions: '', createdAt: 1 },
    writer: { id: 'writer', sessionId: 'writer', name: 'Writer', role: 'Copy', instructions: '', createdAt: 2 },
    editor: { id: 'editor', sessionId: 'editor', name: 'Editor', role: 'Video', instructions: '', createdAt: 3 },
  },
  rooms: {
    r1: { id: 'r1', sessionId: 'r1', name: 'Video Room', named: true, members: ['chief', 'writer', 'editor'], admin: 'chief', mode: 'admin', notice: '', createdAt: 4 },
  },
})

test('sections can be created, renamed, colored, collapsed, reordered, and ungrouped without deleting Bots', async (t) => {
  const { call, stop } = start(baseTeam())
  t.after(stop)

  const created = await call('section-save', { name: '短视频矩阵', color: 'orange', items: ['writer', 'r1'] })
  assert.equal(created.ok, true)
  const sec1 = created.value
  assert.equal(sec1.name, '短视频矩阵')
  assert.equal(sec1.color, 'orange')

  const created2 = await call('section-save', { name: '私域运营', color: 'green', items: ['editor'] })
  assert.equal(created2.ok, true)
  const sec2 = created2.value

  let state = (await call('state', {})).value
  assert.deepEqual(state.sections.map(s => s.name), ['短视频矩阵', '私域运营'])
  assert.equal(state.bots.find(b => b.id === 'writer').sectionId, sec1.id)
  assert.equal(state.rooms.find(r => r.id === 'r1').sectionId, sec1.id)
  assert.equal(state.bots.find(b => b.id === 'editor').sectionId, sec2.id)

  // Duplicate section name is refused
  const clash = await call('section-save', { id: sec2.id, name: '短视频矩阵' })
  assert.equal(clash.ok, false)

  // Collapse, rename, and clear color
  const updated = await call('section-save', { id: sec1.id, name: '短视频组', collapsed: true, color: null })
  assert.equal(updated.ok, true)
  assert.equal(updated.value.name, '短视频组')
  assert.equal(updated.value.collapsed, true)
  assert.equal(updated.value.color, undefined)

  // Reorder sections
  const reordered = await call('section-order', { ids: [sec2.id, sec1.id] })
  assert.equal(reordered.ok, true)
  assert.deepEqual(reordered.value.sections.map(s => s.id), [sec2.id, sec1.id])

  // Move via set-flags
  await call('set-flags', { id: 'writer', sectionId: sec2.id })
  state = (await call('state', {})).value
  assert.equal(state.bots.find(b => b.id === 'writer').sectionId, sec2.id)

  // Ungrouping a section keeps all Bots and rooms and clears their sectionId
  const del = await call('section-delete', { id: sec2.id })
  assert.equal(del.ok, true)
  assert.deepEqual(del.value.sections.map(s => s.id), [sec1.id])
  assert.equal(del.value.bots.find(b => b.id === 'writer').sectionId, undefined)
  assert.equal(del.value.bots.find(b => b.id === 'editor').sectionId, undefined)
})

test('a rejected section update leaves its name, color, and collapsed state unchanged', async (t) => {
  const { call, stop, home } = start(baseTeam())
  t.after(stop)

  const { value: section } = await call('section-save', { name: 'Video', color: 'orange' })
  const rejected = await call('section-save', {
    id: section.id, name: 'Publishing', collapsed: true, color: 'invalid',
  })
  assert.equal(rejected.ok, false)
  assert.equal(rejected.error.message, 'Unknown section color')
  assert.deepEqual((await call('state', {})).value.sections, [section])

  assert.equal((await call('set-flags', { id: 'writer', pinned: true })).ok, true)
  const saved = JSON.parse(readFileSync(join(home, 'state.json'), 'utf8'))
  assert.deepEqual(saved.sections, [section])
})

test('first Main Bot never joins a section, and duplicating a Bot keeps its sectionId', async (t) => {
  const { call, stop } = start(baseTeam())
  t.after(stop)

  const sec = (await call('section-save', { name: '研发组', items: ['chief', 'writer'] })).value
  let state = (await call('state', {})).value
  assert.equal(state.bots.find(b => b.id === 'chief').sectionId, undefined)
  assert.equal(state.bots.find(b => b.id === 'writer').sectionId, sec.id)

  // Duplicating writer keeps sectionId on the copy
  const copy = (await call('duplicate-bot', { id: 'writer' })).value
  assert.equal(copy.sectionId, sec.id)

  // Promoting writer to first Main Bot clears its sectionId
  await call('set-main', { id: 'writer', main: true, primary: true })
  state = (await call('state', {})).value
  assert.equal(state.mainBotId, 'writer')
  assert.equal(state.bots.find(b => b.id === 'writer').sectionId, undefined)
})

test('Main Bot tools create_bot, update_bot, create_group, update_group, and list_bots support sections', async (t) => {
  const { call, tool, stop } = start(baseTeam())
  t.after(stop)
  const mainExec = { agent: { id: 'chief', session: { id: 'chief' } } }
  const workerExec = { agent: { id: 'writer', session: { id: 'writer' } } }

  // create_bot with section creates the section automatically
  const createOut = await tool('create_bot').execute({
    name: 'Designer',
    role: 'UI',
    instructions: 'Design UI.',
    section: '短视频线',
  }, mainExec)
  assert.match(createOut, /Created Designer/)

  let state = (await call('state', {})).value
  const sec = state.sections.find(s => s.name === '短视频线')
  assert.ok(sec)
  assert.equal(state.bots.find(b => b.name === 'Designer').sectionId, sec.id)

  // Non-Main Bot cannot move itself between sidebar sections
  const denied = await tool('update_bot').execute({ section: '短视频线' }, workerExec)
  assert.match(denied, /Only the user or a Main Bot can move/)

  // Main Bot moves Writer and Video Room into the section
  await tool('update_bot').execute({ bot: 'Writer', section: '短视频线' }, mainExec)
  const groupOut = await tool('update_group').execute({ group: 'Video Room', section: '短视频线' }, mainExec)
  assert.match(groupOut, /moved it to section "短视频线"/)

  // list_bots shows section tags
  const listed = await tool('list_bots').execute({}, mainExec)
  assert.match(listed, /Writer \(Copy, section "短视频线"/)
  assert.match(listed, /"Video Room" — members: .*section: 短视频线/)

  // Clearing section with empty string
  await tool('update_bot').execute({ bot: 'Writer', section: '' }, mainExec)
  await tool('update_group').execute({ group: 'Video Room', section: '' }, mainExec)
  state = (await call('state', {})).value
  assert.equal(state.bots.find(b => b.id === 'writer').sectionId, undefined)
  assert.equal(state.rooms.find(r => r.id === 'r1').sectionId, undefined)
})

test('loading state.json drops orphan sectionIds that point to missing sections', async (t) => {
  const saved = {
    ...baseTeam(),
    sections: [{ id: 'sec-valid', name: 'Valid', collapsed: true, color: 'blue' }],
  }
  saved.bots.writer.sectionId = 'sec-valid'
  saved.bots.editor.sectionId = 'sec-missing'
  saved.bots.chief.sectionId = 'sec-valid'
  const { call, stop } = start(saved)
  t.after(stop)

  const state = (await call('state', {})).value
  assert.equal(state.bots.find(b => b.id === 'writer').sectionId, 'sec-valid')
  assert.equal(state.bots.find(b => b.id === 'editor').sectionId, undefined)
  assert.equal(state.bots.find(b => b.id === 'chief').sectionId, undefined)
})

