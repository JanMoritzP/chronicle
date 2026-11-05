// electron-builder takes the release notes from two places, both named
// release-notes.md: <app>/release-notes.md becomes the GitHub release body,
// and the one in the build resources dir (electron/build) becomes the
// releaseNotes field of latest.yml, which the installed app's update dialog
// reads. Write both from the version section of the repo CHANGELOG.md.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const version = JSON.parse(readFileSync(path.join(root, 'electron', 'package.json'), 'utf8')).version
// \r?\n, not \n: on Windows checkouts (core.autocrlf) the file is CRLF and a
// trailing \r would hide the "## X.Y.Z" header, so the release shipped with no notes
const lines = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').split(/\r?\n/)
const header = `## ${version}`

let start = -1
lines.forEach((l, i) => {
  if (start === -1 && (l === header || l.startsWith(header + ' '))) start = i
})
if (start === -1) {
  console.warn(`no "## ${version}" section in CHANGELOG.md, the release will have no notes`)
  process.exit(0)
}
const out = []
for (let i = start + 1; i < lines.length && !lines[i].startsWith('## '); i++) out.push(lines[i])
const notes = out.join('\n').trim() + '\n'

const targets = [
  path.join(root, 'electron', 'release-notes.md'),
  path.join(root, 'electron', 'build', 'release-notes.md'),
]
for (const file of targets) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, notes)
}
console.log(`release notes for ${version} written to ${targets.map((f) => path.relative(root, f)).join(' and ')}`)
