// What the user answered on a group's cards, kept with the room itself: the room log holds
// only its latest ROOM_LOG_MAX lines, so an answer that fell out of it would read back as
// one nothing was recorded for.
export const CARD_ANSWERS_KEPT = 500

const keyOf = (sessionId, questionId) => `${sessionId}\u0000${questionId}`

const isAnswer = value => value !== null && typeof value === 'object' && typeof value.questionId === 'string'

// The room's own copy of the line, without the fields of a log line.
const withoutLine = ({ who: _who, kind: _kind, seq: _seq, length: _length, ...answer }) => answer

// The answers the group holds, oldest first: the ones kept with the room, then any answer
// the log still carries that a room saved before this store was written has not moved yet.
// A card with nothing recorded reads back as no answer at all.
export function cardAnswersOf(room) {
  const kept = Array.isArray(room?.cardAnswers) ? room.cardAnswers.filter(isAnswer) : []
  const seen = new Set(kept.map(answer => keyOf(answer.sessionId, answer.questionId)))
  const logged = (Array.isArray(room?.log) ? room.log : [])
    .filter(line => line !== null && typeof line === 'object' && line.kind === 'card-answer' && isAnswer(line))
    .filter(line => !seen.has(keyOf(line.sessionId, line.questionId)))
    .map(withoutLine)
  return [...kept, ...logged]
}

// Record what the user chose on one of the group's cards. A second answer to the same card
// replaces the first, and only the newest CARD_ANSWERS_KEPT are kept.
export function recordCardAnswer(room, answer) {
  if (!isAnswer(answer)) return
  const kept = (Array.isArray(room.cardAnswers) ? room.cardAnswers.filter(isAnswer) : [])
    .filter(entry => keyOf(entry.sessionId, entry.questionId) !== keyOf(answer.sessionId, answer.questionId))
  room.cardAnswers = [...kept, answer].slice(-CARD_ANSWERS_KEPT)
}
