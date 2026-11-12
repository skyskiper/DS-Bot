import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { install, MAX_LINES } from '../src/host/composer-flaps.js'

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
