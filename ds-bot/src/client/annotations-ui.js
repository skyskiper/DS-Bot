// The admin's reading of a message, drawn under it: one line of reasoning and the task
// the message belongs to. A chat row carries the Session's seq, a round's row carries the
// log's; the host keeps the pointer from one to the other, so both find their annotation
// the same way. A message with no annotation draws nothing at all.
import { createElement as h, useEffect, useState } from 'react'
import { call } from './api.js'
import { annotationLine, stateLabel } from './annotations-view.js'

const PROGRESS_SHOWN = 24

// One poll per group chat, shared by every row that draws from it: the Session's own
// rows and the rows of a round sit in the same conversation.
const known = new Map()
const listeners = new Map()
const pollers = new Map()

const announce = (roomId) => {
  for (const fn of listeners.get(roomId) ?? []) fn()
}

const load = async (roomId) => {
  const value = await call('room-reads', { roomId }).catch(() => null)
  if (value === null || value === undefined) return
  const key = JSON.stringify(value)
  const held = known.get(roomId)
  if (held?.key === key) return
  known.set(roomId, { ...value, key })
  announce(roomId)
}

const start = (roomId) => {
  const entry = pollers.get(roomId) ?? { count: 0, timer: undefined }
  pollers.set(roomId, entry)
  entry.count += 1
  if (entry.timer !== undefined) return
  const tick = async () => {
    entry.timer = undefined
    await load(roomId)
    if ((pollers.get(roomId)?.count ?? 0) === 0) return
    entry.timer = setTimeout(tick, document.hidden ? 5000 : 1500)
  }
  void tick()
}

const stop = (roomId) => {
  const entry = pollers.get(roomId)
  if (entry === undefined) return
  entry.count -= 1
  if (entry.count > 0) return
  clearTimeout(entry.timer)
  pollers.delete(roomId)
}

// The reads of one group chat: `reads` by the log's seq, `index` from the Session's seq.
export const useRoomReads = (roomId) => {
  const [, bump] = useState(0)
  useEffect(() => {
    if (roomId === undefined) return undefined
    const fn = () => bump(n => n + 1)
    const set = listeners.get(roomId) ?? new Set()
    set.add(fn)
    listeners.set(roomId, set)
    start(roomId)
    return () => {
      set.delete(fn)
      stop(roomId)
    }
  }, [roomId])
  return roomId === undefined ? undefined : known.get(roomId)
}

// The annotation under one message, from the number that message's row carries.
export const useAnnotation = (roomId, sessionSeq, roomSeq) => {
  const view = useRoomReads(roomId)
  if (view === undefined) return undefined
  const seq = roomSeq !== undefined ? roomSeq : view.index?.[sessionSeq]
  return seq === undefined ? undefined : view.reads?.[seq]
}

const words = (line) => {
  const parts = [`#${line.num}`]
  if (line.status !== undefined) parts.push(stateLabel(line.status))
  const progress = typeof line.progress === 'string' ? line.progress : line.say
  if (typeof progress === 'string' && progress.trim() !== '') {
    const one = progress.trim().replace(/\s+/g, ' ')
    parts.push(one.length > PROGRESS_SHOWN ? `${one.slice(0, PROGRESS_SHOWN)}…` : one)
  }
  return parts.join(' · ')
}

// One line under a bubble: the task tag, then what the admin made of the message.
export function AnnotationLine({ read, align }) {
  const line = annotationLine(read)
  if (line === undefined) return null
  const tag = line.num === undefined ? undefined : words(line)
  const think = line.think ?? (line.num === undefined ? undefined : line.progress ?? line.say)
  return h('div', { className: 'bt-anno', 'data-align': align, title: [tag, think].filter(Boolean).join(' — ') || undefined },
    tag === undefined ? null : h('span', { className: 'bt-anno-tag' }, tag),
    think === undefined ? null : h('span', { className: 'bt-anno-think' }, think))
}

// A row that must not draw until its group's reads are in: the line under a message is
// part of the message, and a late one would push the chat down under the reader.
export const Annotated = ({ roomId, sessionSeq, roomSeq, align }) => {
  const read = useAnnotation(roomId, sessionSeq, roomSeq)
  return h(AnnotationLine, { read, align })
}
