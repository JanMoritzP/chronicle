// electron-builder publishes release notes from <app>/release-notes.md only, and they end up
// in the GitHub release body and in latest.yml (what the in-app update dialog reads).
// Write it from the version section of the repo CHANGELOG.md.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const version = JSON.parse(readFileSync(path.join(root, 'electron', 'package.json'), 'utf8')).version
const lines = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').split('\n')
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
writeFileSync(path.join(root, 'electron', 'release-notes.md'), out.join('\n').trim() + '\n')
console.log(`release notes for ${version} written to electron/release-notes.md`)
