import assert from 'node:assert/strict'
import { test } from 'node:test'
import { entryLabel, recordedLabel, shortTitle, subLabel, topicCounts, topicRows } from '../src/client/topics-view.js'

// D1/D7/D12 live here: the counts the entry prints, the twelve-character cut, and the `#`
// on a subtopic label. Pure data, so no page is needed to check them.
const book = {
  next: 6,
  items: {
    1: { num: 1, title: '群卡作答链路', state: 'active', subs: { 1: { num: 1, title: '回退用例', state: 'active' }, 2: { num: 2, title: '旧', state: 'archived' } } },
    2: { num: 2, title: '话题入口', state: 'active', subs: {} },
    3: { num: 3, title: '已归档的', state: 'archived', archivedAt: 20, subs: {} },
    4: { num: 4, title: '排队中', state: 'pending', subs: {} },
    5: { num: 5, title: '更早归档', state: 'archived', archivedAt: 10, subs: {} },
  },
  other: { msgs: [7, 8, 9] },
}

test('D1: active only, pending in its own segment, archived counted, #Other never counted', () => {
  assert.deepEqual(topicCounts(book), { active: 2, pending: 1, archived: 2, other: 3 })
  assert.equal(entryLabel(book), 'Topics · 2 active · 1 queued · 2 archived')
  assert.equal(entryLabel({ items: { 1: { num: 1, title: 'a', state: 'active' } }, other: { msgs: [] } }), 'Topics · 1 active · 0 archived')
})

test('D7: cut by code point at eight and mark it, and a title never carries a #', () => {
  assert.equal(shortTitle('群卡作答链路'), '群卡作答链路')
  assert.equal(shortTitle('一二三四五六七八九'), '一二三四五六七八…')
  assert.equal(Array.from(shortTitle('一二三四五六七八九')).length, 9, 'eight characters and the ellipsis')
  assert.equal(shortTitle('#3 群卡作答'), '3 群卡作答')
})

test('D12: a subtopic label carries the same # as the topic, with its title', () => {
  assert.equal(subLabel(1, 2), '#1.2')
  assert.equal(subLabel(1, 3, '回退用例'), '#1.3 回退用例')
})

test('the list keeps active newest first, then queued, then archived by time, with #Other last', () => {
  assert.deepEqual(topicRows(book).map(row => row.label), ['#2', '#1', '#4', '#3', '#5', '#Other'])
  assert.equal(topicRows(book).at(-1).count, 3)
  assert.deepEqual(topicRows({ items: {}, other: { msgs: [] } }), [], 'no topics, no rows')
})

test('a correction names both numbers, and a badge names one', () => {
  assert.equal(recordedLabel(3), '→ Recorded as #3')
  assert.equal(recordedLabel(3, 1), '→ #3 replaces #1')
})
