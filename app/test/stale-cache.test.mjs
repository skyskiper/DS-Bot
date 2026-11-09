import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dropStaleCache } from '../src/stale-cache.mjs'

test('the window caches are dropped before the first load, and nothing else', async () => {
  const calls = []
  const session = {
    clearCache: async () => { calls.push('cache') },
    clearStorageData: async options => { calls.push(options) },
  }
  await dropStaleCache(session)
  assert.deepEqual(calls, ['cache', { storages: ['cachestorage'] }])
})

test('a storage cache that cannot be cleared does not stop the window', async () => {
  const seen = []
  const session = {
    clearCache: async () => { seen.push('cache') },
    clearStorageData: async () => { throw new Error('no cache storage here') },
  }
  await dropStaleCache(session)
  assert.deepEqual(seen, ['cache'])
})
