// One-off probe for the group-question trail: does `user-questions/request` reach this
// plugin at all, and what does the host's pending-question service actually hold? Writes
// one JSON line per event to <DSH_HOME>/bot/question-probe.jsonl. Remove once the question
// is settled.
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'

const shape = (value) => {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (value instanceof Map) return `Map(${value.size})`
  if (Array.isArray(value)) return `Array(${value.length})`
  return typeof value
}

export function install(rt) {
  const path = join(rt.home, 'question-probe.jsonl')
  const write = (entry) => {
    try { appendFileSync(path, `${JSON.stringify({ at: Date.now(), ...entry })}\n`) } catch {}
  }
  const describe = (args) => {
    const [first, second] = args
    return {
      args: args.length,
      thisArg: shape(first),
      hasFilter: typeof first?.[Symbol.for('cordis.filter')] === 'function',
      name: typeof second === 'string' ? second : shape(second),
    }
  }
  // Every dispatch of the event, whichever scope it is routed on.
  rt.ctx.on('internal/dispatch', (type, name, args) => {
    if (name !== 'user-questions/request') return
    write({ kind: 'dispatch', type, ...describe(args) })
  }, { global: true })
  write({
    kind: 'install',
    service: shape(rt.ctx.get?.('userQuestions')),
    waits: shape(rt.ctx.get?.('userQuestions')?.waits),
  })
}
