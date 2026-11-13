// Group topics: the group's admin says which topic a message belongs to, and the code holds
// the limits the model cannot be trusted with — three active topics, three subtopics under
// each, numbering that never repeats, the six states, archiving, and the always-present
// #Other. Nothing here looks at the words: there is no keyword or regex path, and no log line
// may say a topic was picked because a word matched.
import { defineTool } from '@deepseek-ai/dsh-tools'
import { output } from './tools.js'

export const TOPIC_STATES = ['pending', 'active', 'blocked', 'done', 'archived', 'dropped']
export const ACTIVE_LIMIT = 3
export const SUB_LIMIT = 3
export const TITLE_MAX = 8
export const SUB_KINDS = ['progress', 'detail']
export const SUB_IDLE_MS = 5 * 60 * 1000

const titleOf = (text) => {
  const whole = Array.from(String(text ?? '').trim())
  return whole.slice(0, TITLE_MAX).join('')
}

const now = () => Date.now()

// A topic that ended frees its seat; the oldest queued one takes it in the same step.
const promote = (book) => {
  if (book === undefined) return undefined
  const active = Object.values(book.items).filter(item => item.state === 'active').length
  if (active >= ACTIVE_LIMIT) return undefined
  const waiting = Object.values(book.items).filter(item => item.state === 'pending').sort((a, b) => a.num - b.num)[0]
  if (waiting === undefined) return undefined
  waiting.state = 'active'
  waiting.events.push({ at: now(), kind: 'state', from: 'pending', to: 'active' })
  return waiting
}

export function install(rt) {
  const bookOf = (room) => {
    room.topics ??= { next: 1, items: {}, other: { msgs: [] } }
    room.topics.items ??= {}
    room.topics.other ??= { msgs: [] }
    room.topics.other.msgs ??= []
    if (typeof room.topics.next !== 'number') room.topics.next = Object.keys(room.topics.items).length + 1
    return room.topics
  }
  const prefsOf = (room) => {
    room.topicPrefs ??= {
      subtopic: 'loose', naming: 'verb-object, at most 8 characters', allowNewTopic: true,
      examples: [], showOther: true, audit: [],
    }
    return room.topicPrefs
  }
  const subNumOf = (item) => {
    const used = Object.keys(item.subs ?? {}).map(Number)
    return (used.length === 0 ? 0 : Math.max(...used)) + 1
  }
  const activeSubs = item => Object.entries(item.subs ?? {}).filter(([, sub]) => sub.state !== 'archived')

  // The seat a topic needs: an active one stays, a finished one frees it, a full house queues.
  const seat = (book) => Object.values(book.items).filter(item => item.state === 'active').length < ACTIVE_LIMIT

  // The group is the one the caller is speaking in, or the one it names.
  const roomFor = (exec, ref) => {
    const own = rt.roomOf(rt.groupOwners.get(exec.agent?.id)?.roomId)
    if (own !== undefined) return own
    if (typeof ref !== 'string' || ref === '') return undefined
    const matches = (rt.findRooms?.(ref) ?? []).filter(room => room !== undefined)
    if (matches.length === 1) return matches[0]
    return rt.roomOf(ref)
  }
  const callerBot = (exec) => {
    const id = exec.agent?.id
    return rt.botOf(rt.selfOf?.(id) ?? id)
  }
  const mayEdit = (room, bot) => bot !== undefined && (room.admin === bot.id || (rt.state?.mainBotIds ?? []).includes(bot.id))

  rt.topicBook = (roomId) => {
    const room = rt.roomOf(roomId)
    return room === undefined ? undefined : bookOf(room)
  }
  rt.topicSubLabel = (num, sub) => `#${num}.${sub}`

  // Subtopics live five minutes past their last message; the parent ending ends them too.
  rt.topicsSweep = (clock = now()) => {
    let changed = false
    for (const room of Object.values(rt.state?.rooms ?? {})) {
      const book = room.topics
      if (book === undefined) continue
      for (const item of Object.values(book.items)) {
        for (const sub of Object.values(item.subs ?? {})) {
          if (sub.state === 'archived') continue
          const idle = clock - (sub.lastAt ?? sub.createdAt ?? clock) > SUB_IDLE_MS
          const parentEnded = item.state === 'done' || item.state === 'archived' || item.state === 'dropped'
          if (!idle && !parentEnded) continue
          sub.state = 'archived'
          sub.archivedAt = clock
          changed = true
        }
      }
    }
    if (changed) void rt.save?.().catch?.(() => {})
  }

  // The topics a message was placed in: `nums` (or a single `num`) with the first as the
  // primary. A fourth name is dropped and reported, never silently kept.
  const placeOf = (book, nums, num) => {
    const asked = (Array.isArray(nums) ? nums : Number.isInteger(num) ? [num] : [])
      .map(Number).filter(value => Number.isInteger(value))
    if (asked.length === 0) return { wanted: false }
    const unique = [...new Set(asked)]
    const kept = []
    for (const value of unique.slice(0, 3)) {
      const item = book.items[value]
      if (item === undefined) return { wanted: true, error: `There is no topic #${value}.` }
      kept.push(item)
    }
    if (kept.length === 0) return { wanted: false }
    return { wanted: true, nums: kept, ...(unique.length > kept.length ? { dropped: unique.slice(3) } : {}) }
  }

  const record = ({ room, title, fromSeq, acceptance, parent, kind, by, why, num, nums, other }) => {
    const book = bookOf(room)
    // A message the admin could not place: it keeps its seq in #Other until someone says
    // where it belongs. No title is needed, and no number is spent.
    if (other === true) return rt.topicToOther(room, fromSeq, why, by)
    // A message can belong to more than one topic: one primary — the first — decides its
    // order and is the only one whose count includes it; the rest are related, shown but
    // never counted. Leaving one out takes it out of that topic.
    const wanted = placeOf(book, nums, num)
    if (wanted.wanted) {
      if (wanted.error !== undefined) return { error: wanted.error }
      if (!Number.isInteger(fromSeq)) return { error: 'Name the message this belongs to.' }
      const book2 = book
      const kept = wanted.nums
      for (const target of kept) {
        if (!(target.messages ?? []).includes(fromSeq)) target.messages = [...(target.messages ?? []), fromSeq]
        target.events.push({ at: now(), kind: 'attach', by, why, seq: fromSeq })
      }
      // A topic this message was in and is no longer named loses it.
      for (const item of Object.values(book2.items)) {
        if (kept.includes(item) || !(item.messages ?? []).includes(fromSeq)) continue
        item.messages = item.messages.filter(seq => seq !== fromSeq)
        item.events.push({ at: now(), kind: 'detach', by, why, seq: fromSeq })
      }
      book2.primary ??= {}
      book2.primary[fromSeq] = kept[0].num
      book2.other.msgs = book2.other.msgs.filter(seq => seq !== fromSeq)
      void rt.save?.().catch?.(() => {})
      return {
        num: kept[0].num, state: kept[0].state, attached: true, primary: kept[0].num,
        related: kept.slice(1).map(item => item.num),
        ...(wanted.dropped === undefined ? {} : { dropped: wanted.dropped }),
      }
    }
    const text = titleOf(title)
    if (text === '') return { error: 'A topic needs a title of at least one character.' }
    if (parent !== undefined && parent !== null) {
      const item = book.items[parent]
      if (item === undefined) return { error: `There is no topic #${parent}.` }
      const subs = activeSubs(item)
      if (kind !== undefined && !SUB_KINDS.includes(kind)) return { error: 'A subtopic is either progress or detail.' }
      item.subs ??= {}
      if (subs.length >= SUB_LIMIT) {
        // No fourth subtopic: the message joins the one touched most recently.
        const nearest = subs.sort((a, b) => (b[1].lastAt ?? 0) - (a[1].lastAt ?? 0))[0]
        nearest[1].lastAt = now()
        nearest[1].messages = [...(nearest[1].messages ?? []), ...(fromSeq === undefined ? [] : [fromSeq])]
        item.events.push({ at: now(), kind: 'sub', by, why, seq: fromSeq, mergedInto: Number(nearest[0]) })
        void rt.save?.().catch?.(() => {})
        return { num: item.num, sub: Number(nearest[0]), merged: true, note: `#${item.num} already carries 3 subtopics; this joined #${item.num}.${nearest[0]}.` }
      }
      const sub = subNumOf(item)
      item.subs[sub] = { num: sub, title: text, kind: kind ?? 'progress', state: 'active', createdAt: now(), lastAt: now(), ...(fromSeq === undefined ? {} : { messages: [fromSeq] }) }
      item.events.push({ at: now(), kind: 'sub', by, why, seq: fromSeq, sub })
      void rt.save?.().catch?.(() => {})
      return { num: item.num, sub, label: `#${item.num}.${sub}` }
    }
    const fresh = book.next
    book.next = fresh + 1
    const opened = seat(book)
    book.items[fresh] = {
      num: fresh, title: text, state: opened ? 'active' : 'pending', parent: null,
      owner: null, acceptance: acceptance ?? null, createdAt: now(),
      ...(fromSeq === undefined ? {} : { fromSeq }), subs: {}, events: [{ at: now(), kind: 'open', by, why, seq: fromSeq }],
    }
    void rt.save?.().catch?.(() => {})
    const answer = { num: fresh, state: book.items[fresh].state, title: text }
    if (!opened) answer.note = `Three topics are already in flight; #${fresh} is kept and opens when a seat frees. Say it is noted for later.`
    return answer
  }

  // #Other: the message keeps its seq and waits for a human or the admin to move it.
  rt.topicToOther = (room, seq, why, by) => {
    const book = bookOf(room)
    if (seq !== undefined && !book.other.msgs.includes(seq)) book.other.msgs.push(seq)
    room.topicPrefs ??= prefsOf(room)
    void rt.save?.().catch?.(() => {})
    return { other: true, count: book.other.msgs.length, why, by }
  }

  const move = ({ room, seq, num, by, why }) => {
    const book = bookOf(room)
    const item = book.items[num]
    if (item === undefined) return { error: `There is no topic #${num}.` }
    book.other.msgs = book.other.msgs.filter(kept => kept !== seq)
    // The topic's own thread reads its messages, so a moved line joins them or it would be
    // nowhere: out of #Other and not yet in the topic it was moved to.
    if (Number.isInteger(seq) && !(item.messages ?? []).includes(seq)) item.messages = [...(item.messages ?? []), seq]
    item.events.push({ at: now(), kind: 'moved', by, why, seq })
    void rt.save?.().catch?.(() => {})
    return { num, seq, otherCount: book.other.msgs.length }
  }

  // One turn's declaration: the topic this member said its reply belongs to. It is kept on
  // the room, not in memory, so an in-place plugin reload between the tool call and the
  // reply cannot lose it. A declaration older than DECLARE_TTL_MS is ignored rather than
  // landing some later message in a topic nobody asked for.
  const DECLARE_TTL_MS = 10 * 60 * 1000
  const declareOf = (room) => (room.turnTopic ??= {})
  rt.turnTopicSet = (room, bot, num) => {
    if (bot?.id === undefined) return
    declareOf(room)[bot.id] = { num, at: now() }
    void rt.save?.().catch?.(() => {})
  }
  rt.turnTopicClear = (room, bot) => {
    if (bot?.id === undefined) return
    delete declareOf(room)[bot.id]
  }
  rt.turnTopicOf = (room, bot) => {
    const entry = bot?.id === undefined ? undefined : declareOf(room)[bot.id]
    if (entry === undefined) return undefined
    return now() - entry.at > DECLARE_TTL_MS ? undefined : entry.num
  }
  // Take the declaration, once: whichever writer lands the reply first spends it.
  rt.takeTurnTopic = (room, bot) => {
    const num = rt.turnTopicOf(room, bot)
    if (num !== undefined) {
      delete declareOf(room)[bot.id]
      void rt.save?.().catch?.(() => {})
    }
    return num
  }

  // A reply that lands in the topic its turn declared joins it straight away, instead of
  // waiting in #Other for the next turn to move it.
  rt.attachTopicLine = (room, seq, num, by) => {
    const book = bookOf(room)
    const item = book.items[num]
    if (item === undefined) return false
    if (!(item.messages ?? []).includes(seq)) item.messages = [...(item.messages ?? []), seq]
    book.other.msgs = book.other.msgs.filter(kept => kept !== seq)
    item.events.push({ at: now(), kind: 'attach', by, seq, why: 'the reply of the turn that placed it' })
    void rt.save?.().catch?.(() => {})
    return true
  }

  rt.topicTools = { record, move, bookOf, prefsOf, titleOf }

  const tool = (name, description, parameters, run) => rt.teamTools?.push(defineTool({
    name, description, parameters, output,
    async execute(args, exec) {
      await rt.load?.()
      rt.topicsSweep?.()
      const room = roomFor(exec, args?.group)
      if (room === undefined) return 'Name the group: this tool works on one group\'s topics.'
      const bot = callerBot(exec)
      if (!mayEdit(room, bot)) return 'Only the group\'s admin or a Main Bot keeps the topics.'
      return run(args ?? {}, { room, bot, exec })
    },
  }))

  tool('topic_record', 'Open a topic for something new in this group, or record a message that belongs to an existing one. The code refuses nothing that fits; it queues the fourth active topic and joins the fourth subtopic to the closest one.', {
    group: { type: 'string', description: 'Exact group chat name; leave out when calling from that group\'s own Session' },
    title: { type: 'string', description: 'Short verb-object title, at most 8 characters; longer titles are cut to 8. Not needed when num or other places the message' },
    fromSeq: { type: 'number', description: 'The seq of the message this came from, so the topic can point back at it' },
    acceptance: { type: 'string', description: 'One line: how this topic will be known to be done' },
    parent: { type: 'number', description: 'Put it under this topic as a subtopic' },
    num: { type: 'number', description: 'A topic already open that this message belongs to; no new number is spent' },
    nums: { type: 'array', items: { type: 'number' }, description: 'Every topic this message belongs to, primary first (at most three); the first is the only one whose count includes it' },
    reply: { type: 'boolean', description: 'Also place this turn\'s own reply in that topic (default true); false leaves the reply in #Other' },
    other: { type: 'boolean', description: 'The message fits no topic: keep it in #Other until someone says where it goes' },
    kind: { type: 'string', enum: SUB_KINDS, description: 'progress: a step moved; detail: one point being aligned' },
    why: { type: 'string', description: 'Why it belongs there, in one line; kept in the audit trail' },
  }, (args, { room, bot }) => {
    const result = record({
      room, title: args.title, fromSeq: args.fromSeq, acceptance: args.acceptance, parent: args.parent,
      kind: args.kind, by: bot?.name, why: args.why, num: args.num, nums: args.nums, other: args.other === true,
    })
    // The turn's declaration follows the last placement it asked for: a later topic wins,
    // and an explicit `reply: false` clears it so the reply stays in #Other.
    if (result.error === undefined && bot !== undefined) {
      if (args.reply === false) rt.turnTopicClear(room, bot)
      else if (result.primary !== undefined && args.other !== true) rt.turnTopicSet(room, bot, result.primary)
    }
    return result.error ?? JSON.stringify(result)
  })

  tool('topic_assign', 'Name who works on a topic, and what it must reach.', {
    group: { type: 'string' },
    num: { type: 'number', required: true },
    owner: { type: 'string', required: true, description: 'Bot name' },
    acceptance: { type: 'string' },
    why: { type: 'string' },
  }, (args, { room, bot }) => {
    const book = bookOf(room)
    const item = book.items[args.num]
    if (item === undefined) return `There is no topic #${args.num}.`
    const target = rt.findBot?.(String(args.owner))
    if (target === undefined) return `No Bot named ${args.owner}.`
    item.owner = target.id
    if (typeof args.acceptance === 'string' && args.acceptance.trim() !== '') item.acceptance = args.acceptance.trim()
    if (item.state === 'pending' || item.state === 'active') item.state = 'active'
    item.events.push({ at: now(), kind: 'assign', by: bot?.name, why: args.why, owner: target.id })
    void rt.save?.().catch?.(() => {})
    return JSON.stringify({ num: item.num, owner: target.name, state: item.state })
  })

  tool('topic_subtopic', 'Add a progress or detail subtopic under a topic, or move a message into one.', {
    group: { type: 'string' },
    parent: { type: 'number', required: true },
    title: { type: 'string', required: true },
    kind: { type: 'string', enum: SUB_KINDS, required: true },
    fromSeq: { type: 'number' },
    why: { type: 'string' },
  }, (args, { room, bot }) => {
    const result = record({ room, title: args.title, fromSeq: args.fromSeq, parent: args.parent, kind: args.kind, by: bot?.name, why: args.why })
    return result.error ?? JSON.stringify(result)
  })

  tool('topic_state', 'Move a topic through its six states: pending, active, blocked, done, archived, dropped. Done and dropped free the seat; the oldest waiting topic takes it.', {
    group: { type: 'string' },
    num: { type: 'number', required: true },
    state: { type: 'string', enum: TOPIC_STATES, required: true },
    note: { type: 'string', description: 'One line: where this topic stands and what comes next; the card shows it' },
    why: { type: 'string' },
  }, (args, { room, bot }) => {
    const book = bookOf(room)
    const item = book.items[args.num]
    if (item === undefined) return `There is no topic #${args.num}.`
    // A one-line standing note — where this stands and what comes next — kept beside the
    // state so a card can show it. Only the newest is kept; the older ones stay in events.
    const note = typeof args.note === 'string' && args.note.trim() !== '' ? args.note.trim() : undefined
    if (note !== undefined) {
      item.note = { text: note, at: now(), by: bot?.name }
      item.events.push({ at: now(), kind: 'note', by: bot?.name, text: note })
    }
    const next = String(args.state)
    if (!TOPIC_STATES.includes(next)) return `State must be one of ${TOPIC_STATES.join(', ')}.`
    if (item.state === 'archived' && next !== 'active') return `#${item.num} is archived; reopen it first.`
    if (next === 'pending' && seat(book)) return 'There is room for it to be active; do not queue it.'
    const from = item.state
    item.state = next
    if (next === 'archived') item.archivedAt = now()
    item.events.push({ at: now(), kind: next === 'archived' ? 'archive' : from === 'archived' ? 'reopen' : 'state', by: bot?.name, why: args.why, from, to: next })
    const promoted = next === 'archived' || next === 'done' || next === 'dropped' ? promote(book) : undefined
    void rt.save?.().catch?.(() => {})
    return JSON.stringify({ num: item.num, state: next, ...(promoted === undefined ? {} : { promoted: promoted.num }) })
  })

  tool('topic_supersede', 'Replace a topic with a corrected one: the old keeps its number, is marked dropped with the new one, and the new one takes a fresh number.', {
    group: { type: 'string' },
    num: { type: 'number', required: true },
    title: { type: 'string', required: true },
    acceptance: { type: 'string' },
    why: { type: 'string' },
  }, (args, { room, bot }) => {
    const book = bookOf(room)
    const old = book.items[args.num]
    if (old === undefined) return `There is no topic #${args.num}.`
    if (old.state === 'archived' || old.state === 'dropped') return `#${old.num} is already closed.`
    const created = record({ room, title: args.title, acceptance: args.acceptance, by: bot?.name, why: args.why })
    if (created.error !== undefined) return created.error
    old.state = 'dropped'
    old.replacedBy = created.num
    old.events.push({ at: now(), kind: 'supersede', by: bot?.name, why: args.why, byNum: created.num })
    book.items[created.num].replaces = old.num
    promote(book)
    void rt.save?.().catch?.(() => {})
    return JSON.stringify({ old: old.num, num: created.num })
  })

  tool('topic_merge', 'Fold one topic into another: the folded one is dropped and points at the one that keeps the work.', {
    group: { type: 'string' },
    num: { type: 'number', required: true, description: 'The topic that goes away' },
    into: { type: 'number', required: true, description: 'The topic that keeps it' },
    why: { type: 'string' },
  }, (args, { room, bot }) => {
    const book = bookOf(room)
    const from = book.items[args.num]
    const into = book.items[args.into]
    if (from === undefined || into === undefined) return 'Both topics must exist.'
    if (from.num === into.num) return 'A topic cannot merge into itself.'
    if (from.state === 'archived') return `#${from.num} is archived; nothing to merge.`
    for (const sub of Object.values(from.subs ?? {})) {
      if (activeSubs(into).length >= SUB_LIMIT) break
      const num = subNumOf(into)
      into.subs ??= {}
      into.subs[num] = { ...sub, num, state: 'active' }
      sub.state = 'archived'
    }
    from.state = 'dropped'
    from.replacedBy = into.num
    from.events.push({ at: now(), kind: 'merge', by: bot?.name, why: args.why, into: into.num })
    into.events.push({ at: now(), kind: 'merged', by: bot?.name, why: args.why, from: from.num })
    promote(book)
    void rt.save?.().catch?.(() => {})
    return JSON.stringify({ from: from.num, into: into.num })
  })

  tool('topic_prefs', 'Change what the group tells the model about topics: subtopic granularity, naming, whether new topics may open, examples, and whether #Other shows. Only new messages follow a change; nothing is re-classified.', {
    group: { type: 'string' },
    subtopic: { type: 'string', enum: ['strict', 'loose', 'off'], description: 'How eagerly a message becomes a subtopic' },
    naming: { type: 'string', description: 'How topic titles should read' },
    allowNewTopic: { type: 'boolean' },
    examples: { type: 'array', items: { type: 'string' }, description: 'Two to five sample messages with the topic they belong to; examples, not keyword rules' },
    showOther: { type: 'boolean' },
    why: { type: 'string' },
  }, (args, { room, bot }) => {
    const prefs = prefsOf(room)
    const before = { subtopic: prefs.subtopic, naming: prefs.naming, allowNewTopic: prefs.allowNewTopic, examples: [...(prefs.examples ?? [])], showOther: prefs.showOther }
    if (['strict', 'loose', 'off'].includes(args.subtopic)) prefs.subtopic = args.subtopic
    if (typeof args.naming === 'string' && args.naming.trim() !== '') prefs.naming = args.naming.trim()
    if (typeof args.allowNewTopic === 'boolean') prefs.allowNewTopic = args.allowNewTopic
    if (Array.isArray(args.examples)) prefs.examples = args.examples.filter(item => typeof item === 'string').slice(0, 5)
    if (typeof args.showOther === 'boolean') prefs.showOther = args.showOther
    const after = { subtopic: prefs.subtopic, naming: prefs.naming, allowNewTopic: prefs.allowNewTopic, examples: [...(prefs.examples ?? [])], showOther: prefs.showOther }
    prefs.audit.push({ at: now(), by: bot?.name, kind: 'prefs', before, after, why: args.why })
    void rt.save?.().catch?.(() => {})
    return JSON.stringify({ prefs: after, note: 'Only messages after this change follow it; earlier ones keep their topic.' })
  })
}
