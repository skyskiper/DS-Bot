import assert from 'node:assert/strict'
import { test } from 'node:test'
import { departmentOfRole } from '../src/host/constants.js'

// LEGACY: a team saved before departments existed gets one per role once, so a role
// that matches nothing must stay ungrouped rather than land in the wrong department.
test('a role picks its department, and an English word only matches whole', () => {
  const cases = [
    ['开发', 'dev'],
    ['安卓', 'dev'],
    ['iOS 开发', 'dev'],
    ['iOS推流', 'dev'],
    ['复刻开发', 'dev'],
    ['架构', 'dev'],
    ['评审', 'qa'],
    ['验证', 'qa'],
    ['产品', 'pd'],
    ['UI', 'pd'],
    ['UI 设计师', 'pd'],
    ['设计', 'pd'],
    ['对接人', 'sup'],
    ['支持', 'sup'],
    // English words that hold "ui" or "ios" without being either one.
    ['Build Engineer', null],
    ['Guide', null],
    ['Quick Fixer', null],
    ['purpose', null],
    ['bios', null],
    ['Chief of Staff', null],
    ['', null],
    [undefined, null],
  ]
  for (const [role, expected] of cases) assert.equal(departmentOfRole(role), expected, `${JSON.stringify(role)} → ${expected}`)
})
