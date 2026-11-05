// Cuts a release when main has feat:/fix: commits since the last vX.Y.Z tag.
//
// Sets the new version in all four package.json files and both lockfiles,
// prepends a CHANGELOG.md section written from the commit subjects, commits
// it and tags the commit vX.Y.Z. The workflow (release.yml) then pushes the
// commit and the tag; the tag triggers release-desktop.yml, which builds the
// Windows app and publishes the GitHub release. The release notes are the
// CHANGELOG.md section, which scripts/extract-release-notes.mjs feeds to
// electron-builder.
//
// Usage:
//   node scripts/release.mjs            # prepare the release (commit + tag)
//   node scripts/release.mjs --dry-run  # only print what would be released
//
// Bump rules (semver): feat: -> minor, fix:/perf: -> patch, a breaking change
// (a "!" after the type or a "BREAKING CHANGE:" body note) -> major. A
// "Release-As: X.Y.Z" line in a commit body releases that exact version.
// Any other commit type (chore, docs, ...) never triggers a release.

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const dryRun = process.argv.includes('--dry-run')

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

function read(file) {
  return readFileSync(path.join(root, file), 'utf8')
}

function write(file, content) {
  writeFileSync(path.join(root, file), content)
}

// [major, minor, patch]
function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v)
  if (!m) throw new Error(`not a plain semver version: ${v}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function compareVersions(a, b) {
  const [a1, a2, a3] = parseVersion(a)
  const [b1, b2, b3] = parseVersion(b)
  return a1 - b1 || a2 - b2 || a3 - b3
}

function bump(version, part) {
  const [major, minor, patch] = parseVersion(version)
  if (part === 'major') return `${major + 1}.0.0`
  if (part === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

// Highest vX.Y.Z tag reachable from HEAD, or null.
function lastReleaseTag() {
  const tags = git('tag', '--list', 'v*', '--merged', 'HEAD')
    .split('\n')
    .map((t) => /^v(\d+\.\d+\.\d+)$/.exec(t))
    .filter(Boolean)
    .map((m) => m[1])
  if (!tags.length) return null
  tags.sort(compareVersions)
  return tags[tags.length - 1]
}

// %x1f separates fields, %x1e records; bodies may contain newlines.
function commitsSince(tag) {
  const range = tag ? `${tag}..HEAD` : 'HEAD'
  const out = git('log', range, '--format=%H%x1f%s%x1f%b%x1e')
  return out
    .split('\x1e')
    .map((rec) => rec.split('\x1f'))
    .filter(([, subject]) => subject)
    .map(([hash, subject, body]) => ({ hash, subject, body: body || '' }))
}

function parseSubject(subject) {
  const m = /^([A-Za-z]+)(\([^)]*\))?(!)?[ \t]*:[ \t]*(.+)$/.exec(subject)
  if (!m) return null
  return { type: m[1].toLowerCase(), breaking: m[3] === '!', text: m[4] }
}

const BREAKING_BODY = /(^|\n)[ \t]*BREAKING[ -]CHANGE[ \t]*:/
const RELEASE_AS = /(^|\n)[ \t]*Release-As[ \t]*:[ \t]*v?(\d+\.\d+\.\d+)[ \t]*(?=\n|$)/i

function classify(commits) {
  const breaking = []
  const features = []
  const fixes = []
  let releaseAs = null
  for (const commit of commits) {
    const parsed = parseSubject(commit.subject)
    const match = RELEASE_AS.exec(commit.body)
    if (match) releaseAs = match[2]
    if (!parsed) continue
    if (parsed.type === 'feat' || parsed.type === 'fix' || parsed.type === 'perf') {
      if (parsed.breaking || BREAKING_BODY.test(commit.body)) breaking.push(parsed.text)
      else if (parsed.type === 'feat') features.push(parsed.text)
      else fixes.push(parsed.text)
    }
  }
  return { breaking, features, fixes, releaseAs }
}

function changelogSection(version, { breaking, features, fixes }) {
  const date = new Date().toISOString().slice(0, 10)
  const lines = [`## ${version} (${date})`]
  for (const [title, items] of [
    ['Breaking changes', breaking],
    ['Features', features],
    ['Bug Fixes', fixes],
  ]) {
    if (!items.length) continue
    lines.push('', `### ${title}`, ...items.map((text) => `- ${text}`))
  }
  return lines.join('\n') + '\n'
}

// Lockfiles: re-serializing with 2-space indent is byte-identical to what
// npm wrote (verified against both lockfiles), so parse, mutate, write back.
function updateJson(file, mutate) {
  const data = JSON.parse(read(file))
  mutate(data)
  write(file, JSON.stringify(data, null, 2) + '\n')
}

// package.json files: swap only the top-level version line, keeping the rest
// byte-identical (a full re-serialize would reflow hand-formatted inline
// arrays like "workspaces": ["server", "web"]). The top-level version is the
// only 2-space-indented "version" field; dependencies sit deeper.
function setPackageVersion(file) {
  const raw = read(file)
  const re = new RegExp(`(^|\\n)([ \\t]{2}"version":[ \\t]*")${current.replace(/\./g, '\\.')}(")`)
  const next = raw.replace(re, `$1$2${version}$3`)
  if (next === raw) throw new Error(`could not find the version field in ${file}`)
  write(file, next)
}

const lastTag = lastReleaseTag()
const commits = commitsSince(lastTag ? `v${lastTag}` : null)
const { breaking, features, fixes, releaseAs } = classify(commits)
const current = JSON.parse(read('electron/package.json')).version

let version
let reason
if (releaseAs) {
  version = releaseAs
  reason = `release-as ${version}`
} else if (breaking.length) {
  version = bump(current, 'major')
  reason = 'breaking change'
} else if (features.length) {
  version = bump(current, 'minor')
  reason = 'feat'
} else if (fixes.length) {
  version = bump(current, 'patch')
  reason = 'fix'
} else {
  console.log(`no release needed: no feat:/fix: commits since ${lastTag ? `v${lastTag}` : 'the beginning'}`)
  process.exit(0)
}

if (compareVersions(version, current) <= 0) {
  console.error(`refusing to release ${version}: not newer than the current version ${current}`)
  process.exit(1)
}

const section = changelogSection(version, { breaking, features, fixes })
console.log(`releasing ${version} (${reason}):`)
console.log(section)

if (dryRun) {
  console.log('dry run: no files changed')
  process.exit(0)
}

setPackageVersion('package.json')
setPackageVersion('server/package.json')
setPackageVersion('web/package.json')
setPackageVersion('electron/package.json')
updateJson('package-lock.json', (d) => {
  d.version = version
  d.packages[''].version = version
  d.packages['server'].version = version
  d.packages['web'].version = version
})
updateJson('electron/package-lock.json', (d) => {
  d.version = version
  d.packages[''].version = version
})

{
  const changelog = read('CHANGELOG.md')
  const at = changelog.search(/^## /m)
  write(
    'CHANGELOG.md',
    at === -1
      ? `${changelog.trimEnd()}\n\n${section}\n`
      : `${changelog.slice(0, at)}${section}\n${changelog.slice(at)}`
  )
}

git('add', 'package.json', 'server/package.json', 'web/package.json', 'electron/package.json', 'package-lock.json', 'electron/package-lock.json', 'CHANGELOG.md')
git('-c', 'user.name=Chronicle release', '-c', 'user.email=release@chronicle.invalid', 'commit', '-m', `chore: release ${version}`)
git('tag', `v${version}`)
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `tag=v${version}\n`)
}
console.log(`release ${version} prepared: commit and tag v${version} created, waiting for the workflow to push`)
