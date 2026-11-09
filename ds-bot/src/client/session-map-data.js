import { t } from './i18n.js'

// How many parts a chat has worn: the first id, the archived ones, and the current.
const partsOf = (first, parts, current) => new Set([first, ...(parts ?? []), current].filter(Boolean)).size

// The Sessions behind one Bot or one group, in the order the map shows them: the
// Bot's own chat and its part chain, the member Session it holds in each group, the
// Session each of those groups runs itself, and the team's DSH Agent. Null when the
// id is neither a Bot nor a group (a plain DSH Session keeps the shell's own header).
export function sessionSections(target, roster) {
  const bot = roster.byId?.[target]
  const room = roster.roomsById?.[target]
  if (!bot && !room) return null
  const sections = []
  if (bot) {
    const current = bot.sessionId ?? bot.id
    sections.push({
      key: 'private', title: t('Private chat'),
      rows: [{ sessionId: current, label: bot.name, note: t('Current part'), parts: partsOf(bot.id, bot.parts, current) }],
    })
    const inRooms = (roster.rooms ?? []).filter(entry => (entry.members ?? []).includes(bot.id))
    const memberRows = inRooms
      .filter(entry => entry.memberSessions?.[bot.id])
      .map(entry => ({ sessionId: entry.memberSessions[bot.id], label: entry.name, note: t('Member in this group') }))
    if (memberRows.length > 0) sections.push({ key: 'member', title: t('Member sessions in groups'), rows: memberRows })
    if (inRooms.length > 0) {
      sections.push({
        key: 'groups', title: t('Group sessions'),
        rows: inRooms.map(entry => ({
          sessionId: entry.sessionId ?? entry.id, label: entry.name, note: t('Group session'),
          parts: partsOf(entry.id, entry.ownParts, entry.sessionId ?? entry.id),
        })),
      })
    }
    const agentRows = (roster.agents ?? [])
      .flatMap(agent => (agent.sessions ?? []).map(sessionId => ({ sessionId, label: agent.name ?? t('DSH Agent'), note: t('DSH Agent session') })))
    if (agentRows.length > 0) sections.push({ key: 'agents', title: t('DSH Agent'), rows: agentRows })
  } else {
    const own = room.sessionId ?? room.id
    sections.push({
      key: 'own', title: t('Group session'),
      rows: [{ sessionId: own, label: room.name, note: t('Current part'), parts: partsOf(room.id, room.ownParts, own) }],
    })
    const memberRows = (room.members ?? [])
      .map(id => roster.byId?.[id])
      .filter(member => member && room.memberSessions?.[member.id])
      .map(member => ({ sessionId: room.memberSessions[member.id], label: member.name, note: t('Member in this group') }))
    if (memberRows.length > 0) sections.push({ key: 'members', title: t('Members in this group'), rows: memberRows })
  }
  return sections
}
