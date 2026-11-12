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
  // Injected ask for an isolated instance: no model needed. It calls the same service cua
  // calls, so waits/card/settle are the real downstream; only the asker is injected.
  if (process.env.DS_QUESTION_PROBE_INJECT === '1') {
    setTimeout(() => {
      void (async () => {
        try {
          await rt.load?.()
          const wanted = process.env.DS_QUESTION_PROBE_ROOM
          const entry = [...rt.groupOwners.entries()].find(([, owner]) => rt.roomOf(owner?.roomId) !== undefined && (wanted === undefined || owner?.roomId === wanted))
          if (entry === undefined) { write({ kind: 'inject', error: 'no group session' }); return }
          const [sessionId] = entry
          const resolved = await rt.ctx.get?.('sessionController')?.resolveAgent?.(sessionId)
          const agent = resolved?.agent
          const service = rt.ctx.get?.('userQuestions')
          write({ kind: 'inject', sessionId, agent: agent !== undefined, ask: typeof service?.ask, waits: shape(service?.waits) })
          if (agent === undefined || typeof service?.ask !== 'function') return
          void service.ask({ agent, questions: [{ id: 'cua-app-access', question: 'Inject probe: allow this?', options: [{ label: 'Allow for this session' }, { label: 'Deny' }] }] }).catch(() => {})
          write({ kind: 'inject-asked', sessionId })
        } catch (error) {
          write({ kind: 'inject', error: String(error?.message ?? error) })
        }
      })()
    }, 15000)
  }
  write({
    kind: 'install',
    service: shape(rt.ctx.get?.('userQuestions')),
    waits: shape(rt.ctx.get?.('userQuestions')?.waits),
  })
}
