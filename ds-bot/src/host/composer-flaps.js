// The composer probe's sink: the browser records when the composer takeover flips or
// remounts, and this appends those records to a file the owner of the machine can read
// without a console. Off unless asked for, and it stops after a bounded number of lines so
// a forgotten switch cannot fill the disk.
import { existsSync } from 'node:fs'
import { appendFile, chmod, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const MAX_LINES = 50_000
const FILE = 'composer-flaps.jsonl'
// Touching this file asks for the probe, so whoever wants it needs no console: the state
// the browser reads carries `composerDebug`, and the probe follows it.
export const FLAG = 'composer-debug.flag'

export function install(rt) {
  const path = join(rt.home, FILE)
  let lines
  /** Appends the probe's records; `enabled` is the caller's gate (env or request header). */
  rt.appendComposerFlaps = async (events, { enabled = false } = {}) => {
    if (!enabled) return { status: 403, message: 'This build does not record composer takeovers.' }
    const list = Array.isArray(events) ? events.filter(entry => entry !== null && typeof entry === 'object') : []
    if (lines === undefined) {
      try { lines = (await readFile(path, 'utf8')).split('\n').filter(Boolean).length } catch { lines = 0 }
    }
    if (lines >= MAX_LINES) return { status: 200, written: 0, lines, stopped: true }
    const room = MAX_LINES - lines
    const take = list.slice(0, room)
    if (take.length > 0) {
      await mkdir(dirname(path), { recursive: true })
      await appendFile(path, take.map(entry => `${JSON.stringify(entry)}\n`).join(''), { mode: 0o600 })
      lines += take.length
      // appendFile's mode only covers a new file; an existing one keeps its bits.
      if (lines === take.length) await chmod(path, 0o600).catch(() => {})
    }
    return { status: 200, written: take.length, lines, ...(lines >= MAX_LINES ? { stopped: true } : {}) }
  }
  rt.composerFlapsPath = path
  rt.composerDebugFlag = () => existsSync(join(rt.home, FLAG))
}
