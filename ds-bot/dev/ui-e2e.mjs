#!/usr/bin/env node
// UI end-to-end checks in the real DSH window, without the screen: boot an isolated DSH
// home whose ds-bot points at this checkout, open it in headless Chrome over CDP, click
// like the user does, assert the DOM, and save screenshots. Nothing here reads or writes
// ~/.dsh, restarts the running DSH, or touches the desktop app's own data.
//
//   node dev/ui-e2e.mjs image-paging [--keep] [--plugin <checkout>]
//
// Environment overrides: DSH_APP (the DeepSeek Harness.app), DSH_CHROME (Chrome), and
// DSH_E2E_SOURCE (the DSH home to copy the team from, default ~/.dsh).
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { spawn } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import net from 'node:net'

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const APP = process.env.DSH_APP ?? '/Applications/DeepSeek Harness.app'
const CHROME = process.env.DSH_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SOURCE = process.env.DSH_E2E_SOURCE ?? join(homedir(), '.dsh')
const SHOTS = process.env.DSH_E2E_SHOTS ?? tmpdir()
const args = process.argv.slice(2)
const scenario = args.find(argument => !argument.startsWith('--')) ?? 'image-paging'
const keep = args.includes('--keep')
const pluginAt = args.includes('--plugin') ? resolve(args[args.indexOf('--plugin') + 1]) : PLUGIN

const children = []
let home = ''
let chromeHome = ''
let failed = 0
const results = []
const log = (...parts) => console.log(...parts)
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  if (!ok) failed += 1
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${detail}`}`)
  return ok
}
const cleanup = () => {
  for (const child of children.splice(0)) {
    try { child.kill('SIGTERM') } catch {}
  }
  if (!keep) {
    for (const path of [home, chromeHome]) if (path !== '') rmSync(path, { recursive: true, force: true })
  }
}
process.on('exit', cleanup)
process.on('SIGINT', () => { cleanup(); process.exit(130) })

const freePort = () => new Promise((done, fail) => {
  const server = net.createServer()
  server.once('error', fail)
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => done(port))
  })
})
const sleep = ms => new Promise(done => setTimeout(done, ms))
const waitFor = async (probe, timeoutMs) => {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const value = await probe()
    if (value) return value
    await sleep(250)
  }
  return undefined
}

// --- an isolated DSH home ---------------------------------------------------------------
function copyTree(from, to) {
  if (!existsSync(from)) return false
  // APFS clone: a 200 MB session record copies in a moment, and the copy is independent.
  try {
    execFileSync('cp', ['-Rc', from, to], { stdio: 'ignore' })
  } catch {
    execFileSync('cp', ['-R', from, to], { stdio: 'ignore' })
  }
  return true
}

function readMainBotId(where) {
  try {
    const state = JSON.parse(readFileSync(join(where, 'bot', 'state.json'), 'utf8'))
    return state.mainBotIds?.[0]
  } catch {
    return undefined
  }
}

function prepareHome() {
  home = mkdtempSync(join(tmpdir(), 'ds-bot-e2e-'))
  for (const part of ['bot', 'sessions', 'storages', 'profiles']) copyTree(join(SOURCE, part), join(home, part))
  // DSH keeps its workspace list and last session in its settings; a home without it
  // opens on "choose a workspace" and the team surface never gets a session to sit in.
  const settings = [join(SOURCE, 'settings.yaml'), join(SOURCE, 'settings.yaml.imported')].find(path => existsSync(path))
  if (settings !== undefined) copyTree(settings, join(home, 'settings.yaml'))
  if (existsSync(join(SOURCE, 'attachments'))) symlinkSync(join(SOURCE, 'attachments'), join(home, 'attachments'))
  const source = join(home, 'profiles', 'desktop')
  const profile = join(home, 'profiles', 'e2e')
  if (!existsSync(source)) throw new Error(`no desktop profile under ${SOURCE}/profiles`)
  copyTree(source, profile)
  const manifest = join(profile, 'package.json')
  const data = JSON.parse(readFileSync(manifest, 'utf8'))
  data.name = 'dsh-profile-e2e'
  data.dependencies = { ...data.dependencies, 'ds-bot': `link:${pluginAt}` }
  writeFileSync(manifest, `${JSON.stringify(data, null, 2)}\n`)
  const link = join(profile, 'node_modules', 'ds-bot')
  try { unlinkSync(link) } catch {}
  symlinkSync(pluginAt, link)
  return home
}

// --- the isolated host ----------------------------------------------------------------
function startHost() {
  const binary = join(APP, 'Contents/MacOS/DeepSeek Harness')
  const bin = join(APP, 'Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js')
  // The DSH CLI lives inside the app's asar, which only Electron's own fs can read: the
  // child is Electron in Node mode, so the parent checks the binary and lets it report.
  if (!existsSync(binary)) throw new Error(`DeepSeek Harness.app not found at ${APP}`)
  return freePort().then(port => new Promise((done, fail) => {
    const child = spawn(binary, [bin, '--profile', 'e2e', '--port', String(port), '--no-open'], {
      env: { ...process.env, DSH_HOME: home, ELECTRON_RUN_AS_NODE: '1', ELECTRON_DISABLE_SANDBOX: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    children.push(child)
    let output = ''
    const onData = (chunk) => {
      output += String(chunk)
      const found = /dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=\S+)/.exec(output)
      if (found !== null && !child.found) { child.found = true; done(found[1]) }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('exit', (code) => { if (!child.found) fail(new Error(`the isolated host exited (${code}): ${output.slice(-600)}`)) })
    setTimeout(() => { if (!child.found) fail(new Error(`the isolated host printed no URL in 60 s: ${output.slice(-600)}`)) }, 60_000)
  }))
}

// --- headless Chrome over CDP -----------------------------------------------------------
function startChrome(port) {
  chromeHome = mkdtempSync(join(tmpdir(), 'ds-bot-e2e-chrome-'))
  const child = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    `--user-data-dir=${chromeHome}`, `--remote-debugging-port=${port}`, 'about:blank',
  ], { stdio: 'ignore' })
  children.push(child)
  return child
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.console = []
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.method === 'Runtime.consoleAPICalled') {
        this.console.push(`${message.params.type}: ${(message.params.args ?? []).map(arg => arg.value ?? arg.description ?? '').join(' ')}`.slice(0, 300))
      }
      if (message.method === 'Log.entryAdded') this.console.push(`${message.params.entry.level}: ${message.params.entry.text}`.slice(0, 300))
      if (message.id !== undefined && this.pending.has(message.id)) {
        this.pending.get(message.id)(message)
        this.pending.delete(message.id)
      }
    }
  }
  static async open(port) {
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?url=${encodeURIComponent('about:blank')}`, { method: 'PUT' })).json()
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((done, fail) => { ws.onopen = done; ws.onerror = fail })
    return new Cdp(ws)
  }
  send(method, params = {}) {
    return new Promise((done) => {
      const id = ++this.id
      this.pending.set(id, done)
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async evaluate(expression) {
    const reply = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    const failure = reply.result?.exceptionDetails?.exception?.description
    if (failure !== undefined) throw new Error(failure)
    return reply.result?.result?.value
  }
  async shot(path) {
    const reply = await this.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(path, Buffer.from(reply.result.data, 'base64'))
    return path
  }
}

// --- scenarios --------------------------------------------------------------------------
async function imagePaging(cdp) {
  await cdp.send('Page.enable')
  const url = await cdp.evaluate('location.href').catch(() => '')
  if (typeof url !== 'string' || url === '' || url === 'about:blank') throw new Error('the page did not navigate')
  const ready = await waitFor(() => cdp.evaluate("document.querySelectorAll('.bt-side').length > 0"), 60_000)
  if (!check('the sidebar renders', ready === true)) return
  // The Main Bot's tile opens its own chat, where the transcript's pictures are.
  await cdp.evaluate("document.querySelector('.bt-tile')?.click(); true")
  await sleep(1500)
  const countExpr = "document.querySelectorAll('.bt-astack img, .bt-ububble img, .bt-umsg img, .bt-uimgs img').length"
  let images = await waitFor(async () => { const n = await cdp.evaluate(countExpr); return n > 0 ? n : undefined }, 15_000)
  if (images === undefined) {
    // Older history loads on demand; ask for it once, then look again.
    await cdp.evaluate("[...document.querySelectorAll('button')].find(node => /加载更早|Load earlier/.test(node.textContent))?.click(); true")
    images = await waitFor(async () => { const n = await cdp.evaluate(countExpr); return n > 0 ? n : undefined }, 15_000)
  }
  if (!check('the conversation shows images', typeof images === 'number' && images > 0, `${images ?? 0} images`)) {
    log(`  diagnostics: ${await cdp.evaluate(`JSON.stringify({
      allImgs: document.querySelectorAll('img').length,
      imgs: [...document.querySelectorAll('img')].slice(0, 6).map(node => ({ cls: node.className, src: (node.currentSrc || node.src).slice(0, 60) })),
      msgs: document.querySelectorAll('.bt-msg').length,
      users: document.querySelectorAll('.bt-umsg').length,
      buttons: [...document.querySelectorAll('button')].map(node => node.textContent.trim()).filter(text => text !== '').slice(-12),
      text: document.body.innerText.slice(-300),
    })`)}`)
    log(`  api: ${await cdp.evaluate(`fetch('/api/bot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: 'state', payload: {} }) }).then(async r => r.status + ' ' + (await r.text()).slice(0, 160), e => 'ERR ' + e.message)`)}`)
    log(`  console: ${JSON.stringify(cdp.console.slice(-8))}`)
    return
  }
  await cdp.evaluate("[...document.querySelectorAll('.bt-astack img, .bt-ububble img, .bt-umsg img, .bt-uimgs img')][0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); true")
  const opened = await waitFor(() => cdp.evaluate("document.querySelectorAll('.bt-imgview').length > 0"), 8000)
  if (!check('clicking an image opens the pager', opened === true)) return
  const first = JSON.parse(await cdp.evaluate(`JSON.stringify({
    count: document.querySelector('.bt-imgview-count')?.textContent ?? '',
    prevDisabled: document.querySelector('[data-side=prev]')?.disabled,
    nextDisabled: document.querySelector('[data-side=next]')?.disabled,
    img: (() => { const node = document.querySelector('.bt-imgview-img'); if (node === null) return null; const rect = node.getBoundingClientRect(); return { naturalWidth: node.naturalWidth, width: Math.round(rect.width), height: Math.round(rect.height) } })(),
  })`))
  const total = Number((/\/\s*(\d+)/.exec(first.count) ?? [])[1] ?? 0)
  check('the first image is 1 / N', /^1\s*\/\s*\d+$/.test(first.count.trim()), first.count)
  check('the previous arrow is disabled on the first image', first.prevDisabled === true)
  check('the picture itself is drawn', first.img !== null && first.img.naturalWidth > 0 && first.img.width > 0 && first.img.height > 0, JSON.stringify(first.img))
  log(`saved ${await cdp.shot(join(SHOTS, 'e2e-image-paging-1.png'))}`)
  if (total < 2) { check('the conversation has more than one image to page', false, `${total}`); return }
  await cdp.evaluate("document.querySelector('[data-side=next]')?.click(); true")
  await sleep(700)
  const second = JSON.parse(await cdp.evaluate(`JSON.stringify({ count: document.querySelector('.bt-imgview-count')?.textContent ?? '', img: (() => { const node = document.querySelector('.bt-imgview-img'); return node === null ? null : { naturalWidth: node.naturalWidth } })() })`))
  check('the next image is 2 / N', /^2\s*\/\s*\d+$/.test(second.count.trim()), second.count)
  check('the second picture is drawn', second.img !== null && second.img.naturalWidth > 0)
  log(`saved ${await cdp.shot(join(SHOTS, 'e2e-image-paging-2.png'))}`)
  for (let step = 2; step < total; step += 1) {
    await cdp.evaluate("document.querySelector('[data-side=next]')?.click(); true")
    await sleep(400)
  }
  const last = JSON.parse(await cdp.evaluate(`JSON.stringify({ count: document.querySelector('.bt-imgview-count')?.textContent ?? '', nextDisabled: document.querySelector('[data-side=next]')?.disabled })`))
  check('the last image is N / N', new RegExp(`^${total}\\s*/\\s*${total}$`).test(last.count.trim()), last.count)
  check('the next arrow is disabled on the last image', last.nextDisabled === true)
  log(`saved ${await cdp.shot(join(SHOTS, 'e2e-image-paging-last.png'))}`)
}

const scenarios = { 'image-paging': imagePaging }

async function main() {
  const run = scenarios[scenario]
  if (run === undefined) throw new Error(`unknown scenario "${scenario}"; try: ${Object.keys(scenarios).join(', ')}`)
  log(`ds-bot ui-e2e: ${scenario}`)
  log(`  plugin  ${pluginAt}`)
  log(`  home    ${prepareHome()}`)
  const url = await startHost()
  check('an isolated DSH boots', true, process.env.DSH_E2E_DEBUG === '1' ? url : url.replace(/token=\S+/, 'token=…'))
  const mainBotId = readMainBotId(home)
  const [debugPort, chromePort] = await Promise.all([freePort(), freePort()])
  startChrome(debugPort)
  const up = await waitFor(async () => (await fetch(`http://127.0.0.1:${debugPort}/json/version`).then(r => r.ok, () => false)), 20_000)
  if (!check('headless Chrome answers CDP', up === true)) return
  const cdp = await Cdp.open(debugPort)
  await cdp.send('Runtime.enable')
  await cdp.send('Log.enable')
  await cdp.send('Page.enable')
  // A cold browser profile has no last session, and without one the team surface never
  // receives its roster: open the Main Bot's own Session directly, then let the page
  // settle. A reload covers the one cold boot that races the session registry.
  const target = typeof mainBotId === 'string' ? `${url}&session=${encodeURIComponent(mainBotId)}` : url
  await cdp.send('Page.navigate', { url: target })
  await sleep(4000)
  const ready = async () => cdp.evaluate("!document.body.innerText.includes('正在设置')").catch(() => false)
  if (!(await ready())) {
    // The first client on a fresh home lands in an empty session; once the server has
    // registered one, opening the page again restores the last session.
    await sleep(3000)
    await cdp.send('Page.navigate', { url: target })
    await sleep(5000)
  }
  await run(cdp)
  void chromePort
}

main().then(() => {
  log('')
  log(`${results.filter(r => r.ok).length} passed, ${failed} failed`)
  process.exitCode = failed === 0 ? 0 : 1
}, (error) => {
  log(`FAIL ${error?.message ?? error}`)
  process.exitCode = 1
})
