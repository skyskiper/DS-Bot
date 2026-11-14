// What the group's admin thinks about each message: one line of reasoning for the user, and
// the task the message belongs to. The task list is a projection of these annotations, read
// when it is asked for, never a table of its own — so a message with no annotation is plainly
// unhandled, and a stale task cannot drift away from the messages that made it.
import { defineTool } from '@deepseek-ai/dsh-tools'
import { output } from './tools.js'

export const TASK_STATES = ['pending', 'in_progress', 'completed']

const readsOf = (room) => (room.reads ??= {})
const taskOf = (input) => {
  if (input === undefined || input === null) return undefined
  const num = Number(input.num)
  if (!Number.isInteger(num) || num <= 0) return { error: 'A task needs its number: num must be a positive integer.' }
  const status = typeof input.status === 'string' ? input.status : undefined
  if (status !== undefined && !TASK_STATES.includes(status)) return { error: `Task status must be one of ${TASK_STATES.join(', ')}.` }
  const progress = typeof input.progress === 'string' && input.progress.trim() !== '' ? input.progress.trim() : undefined
  const say = typeof input.say === 'string' && input.say.trim() !== '' ? input.say.trim() : undefined
  let result
  if (input.result !== undefined && input.result !== null) {
    const ok = input.result.ok
    const summary = typeof input.result.summary === 'string' ? input.result.summary.trim() : ''
    if (typeof ok !== 'boolean') return { error: 'A result says ok true or false.' }
    if (summary === '') return { error: 'A result needs one line saying what came of it.' }
    result = { ok, summary }
  }
  if (status === 'completed' && result === undefined) return { error: 'A completed task says what came of it: give result {ok, summary}.' }
  return {
    task: {
      num,
      ...(status === undefined ? {} : { status }),
      ...(progress === undefined ? {} : { progress }),
      ...(say === undefined ? {} : { say }),
      ...(result === undefined ? {} : { result }),
    },
  }
}

// The newest annotation that carries a status is the task's current state; annotations with
// only think and progress never move it.
export const projectTasks = (room) => {
  const reads = room?.reads ?? {}
  const byNum = new Map()
  for (const [key, read] of Object.entries(reads)) {
    const task = read?.task
    if (task === undefined || task.status === undefined) continue
    const at = Number(read.at) || 0
    const seq = Number(key) || 0
    const held = byNum.get(task.num)
    if (held !== undefined && (held.at > at || (held.at === at && held.seq > seq))) continue
    byNum.set(task.num, { ...task, at, seq })
  }
  return [...byNum.values()].sort((a, b) => a.num - b.num)
}

const mayEdit = (rt, room, bot) => bot !== undefined && (room.admin === bot.id || (rt.state?.mainBotIds ?? []).includes(bot.id))

export function install(rt) {
  const roomFor = (exec, ref) => {
    const own = rt.roomOf(rt.groupOwners.get(exec.agent?.id)?.roomId)
    if (own !== undefined) return own
    if (typeof ref !== 'string' || ref === '') return undefined
    return rt.roomOf(ref) ?? (rt.findRooms?.(ref) ?? []).find(Boolean)
  }
  const callerBot = (exec) => rt.botOf(rt.selfOf?.(exec.agent?.id) ?? exec.agent?.id)

  // Annotate one of the group's messages: the reasoning the user sees under it, and the task
  // it belongs to. Every write is one entry under its seq, so a message can be re-read.
  const annotate = ({ room, seq, think, task, by, reopen = false }) => {
    const parsed = taskOf(task)
    if (parsed?.error !== undefined) return parsed
    const reads = readsOf(room)
    const key = String(seq)
    const at = Date.now()
    const previous = reads[key]
    const next = parsed?.task
    if (next?.status !== undefined) {
      const current = projectTasks(room).find(entry => entry.num === next.num)
      // A finished task stays finished: only an explicit reopen moves it back, so a later
      // annotation cannot quietly undo a delivered result.
      if (current?.status === 'completed' && next.status !== 'completed' && reopen !== true) {
        return { error: `Task #${next.num} is completed; reopen it first (reopen: true).` }
      }
    }
    reads[key] = {
      ...(previous ?? {}),
      ...(typeof think === 'string' && think.trim() !== '' ? { think: think.trim() } : {}),
      ...(next === undefined ? {} : { task: { ...(previous?.task ?? {}), ...next } }),
      by,
      at,
    }
    void rt.save?.().catch?.(() => {})
    return { seq, read: reads[key] }
  }

  rt.annotateMessage = ({ roomId, seq, think, task, by, reopen }) => {
    const room = rt.roomOf(roomId)
    return room === undefined ? { error: 'No such group.' } : annotate({ room, seq, think, task, by, reopen })
  }
  rt.tasksOf = (roomId) => projectTasks(rt.roomOf(roomId))
  rt.readsOfRoom = (roomId) => rt.roomOf(roomId)?.reads ?? {}

  const gate = (exec, ref) => {
    const room = roomFor(exec, ref)
    if (room === undefined) return { error: 'Name the group: this tool works on one group\'s messages.' }
    const bot = callerBot(exec)
    if (!mayEdit(rt, room, bot)) return { error: 'Only the group\'s admin or a Main Bot annotates its messages.' }
    return { room, bot }
  }

  rt.teamTools?.push(defineTool({
    name: 'annotate',
    description: 'Say what you think about one of the group\'s messages: a line of reasoning the user reads under it, and the task it belongs to. This is the only way a task moves; a message left without an annotation is visibly unhandled.',
    parameters: {
      group: { type: 'string', description: 'Exact group chat name; leave it out when calling from that group\'s own Session' },
      seq: { type: 'number', required: true, description: 'The seq of the message being read, as the group shows it' },
      think: { type: 'string', description: 'One line: what you make of the message and what you will do about it' },
      task: {
        type: 'object',
        description: 'The task it belongs to: {num, status?, progress?, say?, result?}. Only a status moves the task list',
        properties: {
          num: { type: 'number', description: 'The task number' },
          status: { type: 'string', enum: TASK_STATES, description: 'pending: waiting to start; in_progress: under way; completed: done, which needs result' },
          progress: { type: 'string', description: 'Where it stands, in one line' },
          say: { type: 'string', description: 'What you are about to do about it' },
          result: { type: 'object', description: 'Only for completed: {ok: true|false, summary: one line}', properties: { ok: { type: 'boolean' }, summary: { type: 'string' } }, additionalProperties: false },
        },
        additionalProperties: false,
      },
      reopen: { type: 'boolean', description: 'Move a completed task back to work; without it a completed task stays completed' },
    },
    output,
    async execute(args, exec) {
      await rt.load?.()
      const gated = gate(exec, args?.group)
      if (gated.error !== undefined) return gated.error
      const result = annotate({
        room: gated.room, seq: Number(args?.seq), think: args?.think, task: args?.task, by: gated.bot?.name, reopen: args?.reopen === true,
      })
      if (result.error !== undefined) return result.error
      return JSON.stringify({ seq: result.seq, ...(result.read.think === undefined ? {} : { think: result.read.think }), ...(result.read.task === undefined ? {} : { task: result.read.task }) })
    },
  }))

  // The admin's own message, annotated as it is written: one write for the line the group
  // shows and the reading it carries. If the annotation is refused the message still goes, so
  // a bad task number never costs the user a reply.
  rt.teamTools?.push(defineTool({
    name: 'say',
    description: 'Say something in the group, with your reading of it: the text the group shows and the annotation that puts it under a task, in one call. This is how the admin speaks in a group.',
    parameters: {
      group: { type: 'string', description: 'Exact group chat name; leave it out when calling from that group\'s own Session' },
      text: { type: 'string', required: true, description: 'What to say in the group' },
      think: { type: 'string', description: 'One line of reasoning, shown under the message' },
      task: { type: 'object', description: 'The task this message belongs to: {num, status?, progress?, say?, result?}', properties: { num: { type: 'number' }, status: { type: 'string', enum: TASK_STATES }, progress: { type: 'string' }, say: { type: 'string' }, result: { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' } }, additionalProperties: false } }, additionalProperties: false },
      reopen: { type: 'boolean', description: 'Move a completed task back to work' },
    },
    output,
    async execute(args, exec) {
      await rt.load?.()
      const gated = gate(exec, args?.group)
      if (gated.error !== undefined) return gated.error
      const text = typeof args?.text === 'string' ? args.text : ''
      if (text.trim() === '') return 'A message needs some text.'
      const line = rt.logRoom(gated.room, { who: gated.bot.name, botId: gated.bot.id, text })
      const annotated = annotate({
        room: gated.room, seq: line.seq, think: args?.think, task: args?.task, by: gated.bot?.name, reopen: args?.reopen === true,
      })
      return JSON.stringify(annotated.error === undefined
        ? { seq: line.seq, annotated: true }
        : { seq: line.seq, annotated: false, note: `${annotated.error} The message was posted without it.` })
    },
  }))
}
