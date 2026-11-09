// electron-builder's beforePack hook. The native modules go into the package as npm installed them
// (npmRebuild: false), so they fit only the architecture of the Node that ran npm. An app built for
// another architecture would carry them and not start, so such a build stops here.
import { Arch } from 'electron-builder'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { preparePrimaryRuntime, runtimeTarget } from './prepare-runtime.mjs'

const WHERE = {
  darwin: { x64: 'on an Intel Mac, or under Rosetta with an x64 Node', arm64: 'on a Mac with Apple silicon' },
}

/** @returns {string | undefined} why this Node cannot build an app for `target` */
export function archProblem({ target, platform, host = process.arch, targets = [] }) {
  // electron-builder packs a universal app one architecture at a time: the hook only sees the
  // inner x64/arm64 builds, so a universal request is known from the requested targets.
  if (target === 'universal' || targets.includes('universal')) return 'A universal app would need the native modules of both architectures. Build one app per architecture.'
  if (target === host) return undefined
  const where = WHERE[platform]?.[target] ?? `with an ${target} Node`
  return `This Node runs on ${host}, so npm installed ${host} native modules, and an ${target} app with them would not start. Install the dependencies and build ${where}.`
}

/**
 * The Office payload the package ships next to the asar through extraResources; it must
 * match the package's own platform and architecture, which the arch check guarantees.
 * @param {*} context - electron-builder's beforePack context.
 * @returns {{ target: string, output: string, cache: string, version: string }}
 */
export function officeRuntimeRequest(context) {
  const target = runtimeTarget(context.electronPlatformName, Arch[context.arch])
  if (target === undefined) throw new Error(`No Office runtime payload for ${context.electronPlatformName} ${Arch[context.arch]}.`)
  // The context's packager is the PlatformPackager; the app directory lives on its Packager
  // (.info), exposed directly as projectDir. For this one-package app they are the same.
  const appDir = context.packager.appDir ?? context.packager.projectDir
  return {
    target,
    output: join(appDir, 'build', 'runtime'),
    cache: process.env.DS_BOT_RUNTIME_CACHE ?? join(appDir, 'build', 'runtime-cache'),
    version: context.packager?.appInfo?.version
      ?? JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version,
  }
}

// The app carries the plugin from app/node_modules/ds-bot. Copying a node_modules tree
// (the fast way to avoid an install) keeps the plugin of the day it was installed, so
// the app would ship a client.js older than this checkout. Compare the two builds.
export function pluginProblem(appDir) {
  // A made-up directory (a test) has no package.json; a real build always has one.
  if (!existsSync(join(appDir, 'package.json'))) return undefined
  const installed = join(appDir, 'node_modules', 'ds-bot', 'client.js')
  if (!existsSync(installed)) return `node_modules/ds-bot is missing in ${appDir}; run npm install there`
  const checkout = join(dirname(appDir), 'ds-bot', 'client.js')
  if (!existsSync(checkout)) return `the plugin checkout is missing: ${checkout}`
  const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex')
  return hash(installed) === hash(checkout)
    ? undefined
    : `node_modules/ds-bot is stale: its client.js differs from ${checkout}; run npm install ../ds-bot in ${appDir}`
}

export async function beforePack(context, prepare = preparePrimaryRuntime) {
  const targets = []
  for (const archToNames of context.packager?.packagerOptions?.targets?.values() ?? [])
    for (const arch of archToNames.keys()) targets.push(Arch[arch])
  const problem = archProblem({ target: Arch[context.arch], platform: context.electronPlatformName, targets })
  if (problem !== undefined) throw new Error(problem)
  const stale = pluginProblem(context.packager.appDir ?? context.packager.projectDir)
  if (stale !== undefined) throw new Error(stale)
  await prepare(officeRuntimeRequest(context))
}
