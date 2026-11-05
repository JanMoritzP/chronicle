// Creates the GitHub release for the current tag before electron-builder runs
// (or updates its body on a re-run). Why pre-create:
//  - the body comes from electron/release-notes.md (extract-release-notes.mjs),
//    so the release page and the portable app's update dialog show the notes;
//  - electron-builder's publisher is one instance per artifact group, and a
//    get-or-create race once produced two release objects for one tag; with the
//    release already there, the instances only attach assets to it.
//
// Usage (the workflow provides the env vars):
//   node scripts/publish-release.mjs            # needs GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_REF_NAME
//   node scripts/publish-release.mjs --dry-run  # print what would be sent, no network

import { appendFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const dryRun = process.argv.includes('--dry-run')
const repo = process.env.GITHUB_REPOSITORY
const token = process.env.GITHUB_TOKEN
const tag = process.env.GITHUB_REF_NAME

if (!repo || !tag) {
  console.error('GITHUB_REPOSITORY and GITHUB_REF_NAME must be set (run in the workflow)')
  process.exit(1)
}

let body = ''
try {
  body = readFileSync(path.join(root, 'electron', 'release-notes.md'), 'utf8').trim()
} catch {
  console.warn('no electron/release-notes.md, the release will have no notes')
}

const name = tag.startsWith('v') ? tag.slice(1) : tag
const api = `https://api.github.com/repos/${repo}/releases`
const headers = {
  accept: 'application/vnd.github+json',
  ...(token ? { authorization: `Bearer ${token}` } : {}),
}

async function apiRequest(method, url, data) {
  const res = await fetch(url, {
    method,
    headers: data ? { ...headers, 'content-type': 'application/json' } : headers,
    body: data ? JSON.stringify(data) : undefined,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${method} ${url} failed (${res.status}): ${text.slice(0, 300)}`)
  }
  return res.status === 204 ? null : res.json()
}

async function findRelease() {
  // by tag, not by listing: a tag can have more than one release object
  // (a get-or-create race once left an orphan), and this returns the one
  // the tag resolves to
  const res = await fetch(`${api}/tags/${encodeURIComponent(tag)}`, { headers })
  if (res.status === 404) return null
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GET ${api}/tags/${tag} failed (${res.status}): ${text.slice(0, 300)}`)
  }
  const release = await res.json()
  return release.draft ? null : release
}

if (dryRun) {
  console.log(`dry run: would ${tag} exist ? patch its body : create release`)
  console.log(`payload: ${JSON.stringify({ tag_name: tag, name, body }, null, 2)}`)
  process.exit(0)
}

try {
  let release = await findRelease()
  if (release) {
    if (release.body === body) {
      console.log(`release ${tag} exists and its notes are already up to date`)
    } else {
      await apiRequest('PATCH', `${api}/${release.id}`, { body })
      console.log(`release ${tag} exists, notes updated`)
    }
  } else {
    release = await apiRequest('POST', api, { tag_name: tag, name, body })
    console.log(`release ${tag} created (id ${release.id})`)
  }

  // A get-or-create race once produced a second release object for the same tag,
  // and /releases/latest (what the portable updater reads) can return that one.
  // Drop the duplicates: their assets are regenerated and re-uploaded by this
  // same run, so nothing is lost.
  const all = await apiRequest('GET', `${api}?per_page=100`)
  for (const other of all) {
    if (other.id !== release.id && other.tag_name === tag && !other.draft) {
      await apiRequest('DELETE', `${api}/${other.id}`)
      console.log(`removed duplicate release ${other.id} for ${tag}`)
    }
  }
  console.log(`notes: ${body ? `${body.split('\n').length} line(s), first: ${body.split('\n')[0]}` : 'none'}`)
} catch (e) {
  // Fail soft: electron-builder still publishes the release (without the
  // pre-created notes), so a notes problem must not block the release. A
  // re-run of the tag fixes the notes. The error goes to the step summary so
  // it is readable without access to the full log.
  const msg = `release prep failed: ${e.message}`
  console.warn(msg)
  console.warn('continuing: the builder will create the release, but it may lack the notes; re-running the workflow fixes that')
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### Release prep failed\n\n\`${msg}\`\n`)
  }
}
