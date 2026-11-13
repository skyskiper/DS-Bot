import { currentPart } from './text.js'

// What waits for the user: a question a Bot asked and is sitting on, and an approval.
// A question keeps only while it is fresh: a card from days ago names work that moved on,
// and a Bot retires its own when it is told something, so this is the floor for the rest.
const QUESTION_MAX_AGE_MS = 24 * 60 * 60 * 1000
const freshQuestion = (askedAt, now) => !Number.isFinite(askedAt) || now - askedAt < QUESTION_MAX_AGE_MS

export function needsOf(roster, approvals = [], now = Date.now()) {
  const list = []
  for (const bot of roster.bots) {
    const card = roster.questions?.[currentPart(bot)]
    if (card?.question && freshQuestion(card.askedAt, now)) list.push({ id: `q:${card.id}`, kind: 'question', botId: bot.id, text: card.question, at: card.askedAt ?? 0 })
  }
  // A member's card in a group waits there, under that group's name.
  for (const room of roster.rooms) {
    for (const [botId, sessionId] of Object.entries(room.memberSessions ?? {})) {
      const card = roster.questions?.[sessionId]
      if (card?.question && freshQuestion(card.askedAt, now)) list.push({ id: `q:${card.id}`, kind: 'question', botId, roomId: room.id, text: card.question, at: card.askedAt ?? 0 })
    }
  }
  for (const entry of approvals) {
    list.push({ id: `a:${entry.id}`, kind: 'approval', botId: entry.botId, ...(entry.roomId ? { roomId: entry.roomId } : {}), text: entry.reason || entry.tool || '', at: entry.at ?? 0 })
  }
  return list.sort((a, b) => b.at - a.at)
}
