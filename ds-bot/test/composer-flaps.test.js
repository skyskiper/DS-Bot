import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { install, MAX_LINES } from '../src/host/composer-flaps.js'
import { install as installChannel } from '../src/host/channel.js'

// The composer probe's sink refuses by default: nothing is written unless the caller's
// gate (the environment variable or the request's debug header) opened it.
const sink = (t) => {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-flaps-'))
  t.after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }))
  const rt = { home }
  install(rt)
  return { rt, file: rt.composerFlapsPath }
}

test('with the switch off the sink answers 403 and writes nothing', async (t) => {
  const { rt, file } = sink(t)
  const result = await rt.appendComposerFlaps([{ ms: 1, event: 'mount' }], { enabled: false })
  assert.deepEqual([result.status, existsSync(file)], [403, false])
  // Nor does a body that is not a list get through a closed switch.
  assert.equal((await rt.appendComposerFlaps('nope', {})).status, 403)
  assert.equal(existsSync(file), false)
})

test('with the switch on it appends one record per line, owner-only', async (t) => {
  const { rt, file } = sink(t)
  const first = await rt.appendComposerFlaps([{ ms: 10, event: 'mount' }, { ms: 20, event: 'unmount' }], { enabled: true })
  assert.equal(first.status, 200)
  assert.equal(first.written, 2)
  const lines = readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  assert.deepEqual(lines, [{ ms: 10, event: 'mount' }, { ms: 20, event: 'unmount' }])
  assert.equal(statSync(file).mode & 0o777, 0o600)
  // Records that are not objects are dropped rather than written as junk.
  const second = await rt.appendComposerFlaps([null, 'x', { ms: 30, event: 'flip' }], { enabled: true })
  assert.equal(second.written, 1)
  assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 3)
})

test('the sink stops at its line limit instead of filling the disk', async (t) => {
  const { rt, file } = sink(t)
  const events = Array.from({ length: MAX_LINES + 5 }, (_, index) => ({ ms: index, event: 'mount' }))
  const result = await rt.appendComposerFlaps(events, { enabled: true })
  assert.equal(result.written, MAX_LINES)
  assert.equal(result.stopped, true)
  assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, MAX_LINES)
  const after = await rt.appendComposerFlaps([{ ms: 1, event: 'mount' }], { enabled: true })
  assert.deepEqual([after.written, after.stopped], [0, true])
})

test('the state the browser reads says whether the flag file asks for the probe', (t) => {
  const { rt } = sink(t)
  assert.equal(rt.composerDebugFlag(), false)
  writeFileSync(join(rt.home, 'composer-debug.flag'), '')
  assert.equal(rt.composerDebugFlag(), true)
})

// The endpoint itself, not only the sink: a request without the switch must not write.
const endpoint = (t) => {
  let route
  const { rt, file, home } = sink(t)
  const ctx = {
    logger: { warn() {}, info() {} },
    get: () => undefined,
    on: () => () => {},
    effect: (execute) => { execute() },
    tools: { register: () => () => {}, guard: () => () => {}, schemas: () => [] },
    systemPrompt: { section: () => () => {} },
    connection: { fetch: { register(entry) { route = entry; return () => {} } } },
    llm: { listProviders: () => [] },
  }
  Object.assign(rt, {
    ctx,
    state: { revision: 0, bots: {}, rooms: {}, exchanges: [], questions: {}, agents: {}, secretRequests: {}, prefs: {} },
    save: async () => {},
    refresh: async () => {},
    readOnly: () => undefined,
    load: async () => {},
    bootstrap: async () => {},
    catalog: async () => {},
    loadSecrets: async () => {},
    cachedCatalog: () => [],
    cachedDefault: () => undefined,
    reasoningOf: () => undefined,
    providersView: async () => ({}),
    secretsView: () => ({}),
    capabilityLibraryView: () => ({}),
    activityView: () => ({}),
    workView: () => ({}),
    roomWorkView: () => ({}),
    approvalsView: () => ({}),
    waitingView: () => ({}),
    turnsView: () => ({}),
    memoryNews: () => ({}),
    memoryReviews: () => ({}),
    connectorsView: () => ({}),
    capabilityStatusesView: () => ({}),
    phoneView: () => null,
    phoneServe: () => {},
    selfOf: () => undefined,
    warn() {},
  })
  installChannel(rt)
  const post = async (header) => {
    const response = await route.fetch({
      json: async () => ({ endpoint: 'debug-composer', payload: { events: [{ ms: 1, event: 'mount' }] } }),
      headers: { get: name => (name === 'x-ds-bot-composer-debug' ? header : null) },
      signal: new AbortController().signal,
    })
    return { status: response.status, body: await response.json() }
  }
  return { post, file, home }
}

test('the debug endpoint answers 403 and writes nothing without the switch', async (t) => {
  const { post, file } = endpoint(t)
  const { status, body } = await post(null)
  assert.equal(status, 403)
  assert.equal(body.ok, false)
  assert.deepEqual([body.error?.code, existsSync(file)], ['bot/refused', false])
})

test('the debug endpoint writes the records when the request asks for it', async (t) => {
  const { post, file } = endpoint(t)
  const { status, body } = await post('1')
  assert.equal(status, 200)
  assert.equal(body.value.written, 1)
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8').trim()), { ms: 1, event: 'mount' })
})
