import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createEscapeStack } from '../src/client/escape-stack.js'

// Escape closes the newest layer only. A card window over the right column is two
// layers: the first press must not take the column with it (the fault the window found).
test('escape closes one layer at a time, newest first', () => {
  const stack = createEscapeStack()
  const closed = []
  stack.push(() => closed.push('column'))
  const offWindow = stack.push(() => closed.push('card window'))

  stack.press({ key: 'Escape' })
  assert.deepEqual(closed, ['card window'])
  assert.equal(stack.depth(), 2, 'the column is still open underneath')

  offWindow()
  stack.press({ key: 'Escape' })
  assert.deepEqual(closed, ['card window', 'column'], 'the next press closes the column')
  assert.equal(stack.depth(), 1)
})

test('only the Escape key acts, and a stack with nothing open does nothing', () => {
  const stack = createEscapeStack()
  const closed = []
  stack.press({ key: 'Escape' })
  assert.deepEqual(closed, [])
  stack.push(() => closed.push('layer'))
  stack.press({ key: 'Enter' })
  stack.press({ key: 'a' })
  assert.deepEqual(closed, [])
})

test('a layer that closes out of order leaves the one above it on top', () => {
  const stack = createEscapeStack()
  const closed = []
  const offFirst = stack.push(() => closed.push('first'))
  stack.push(() => closed.push('second'))
  offFirst()
  stack.press({ key: 'Escape' })
  assert.deepEqual(closed, ['second'])
  assert.equal(stack.depth(), 1)
})
