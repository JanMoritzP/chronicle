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
  let res
  try {
    res = await fetch(url, {
      method,
      headers: data ? { ...headers, 'content-type': 'application/json' } : headers,
      body: data ? JSON.stringify(data) : undefined,
    })
  } catch (e) {
    // fetch() rejects (no status) on network-level failures; surface the cause
    throw new Error(`${method} ${url} network error: ${e.message}${e.cause ? ` (${e.cause.code || e.cause.message})` : ''}`)
  }
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

console.log(`repo=${repo} tag=${tag} token=${token ? `present (len ${token.length})` : 'MISSING'} notes=${body.length} chars`)

try {
  const release = await findRelease()
  console.log(`release for ${tag}: ${release ? `found id=${release.id}` : 'not found, will create'}`)

  // Remove duplicates first: while two releases share a tag, GitHub's release
  // validation rejects updating either one (422 already_exists on tag_name),
  // and the builder's get-or-create picks from the listing nondeterministically.
  // The orphan's assets are regenerated and re-uploaded by this same run.
  const all = await apiRequest('GET', `${api}?per_page=100`)
  for (const other of all) {
    if (other.tag_name === tag && !other.draft && (release == null || other.id !== release.id)) {
      await apiRequest('DELETE', `${api}/${other.id}`)
      console.log(`removed duplicate release ${other.id} for ${tag}`)
    }
  }

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
  console.log(`notes: ${body ? `${body.split('\n').length} line(s), first: ${body.split('\n')[0]}` : 'none'}`)
} catch (e) {
  // Fail soft: electron-builder still publishes the release (without the
  // pre-created notes), so a notes problem must not block the release. A
  // re-run of the tag fixes the notes. The error goes to the step summary and
  // as a workflow annotation, both readable without access to the run log.
  const msg = `release prep failed: ${e.message}`
  console.warn(msg)
  console.warn('continuing: the builder will create the release, but it may lack the notes; re-running the workflow fixes that')
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### Release prep failed\n\n\`${msg}\`\n`)
  }
  // diagnostics that do not leak values: was the token even present, and is
  // a proxy in play (Node's fetch ignores proxy env vars, so a 401 here can
  // mean the request went through something that dropped the auth header)
  const proxyVars = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY'].filter((k) => process.env[k]).join(',') || 'none'
  const detail = `token=${token ? `set (len ${token.length})` : 'MISSING'} proxy vars: ${proxyVars}`
  const anno = `${msg} | ${detail}`.replace(/\r?\n/g, ' ').replace(/%/g, '%25')
  console.error(`::error file=.github/workflows/release-desktop.yml,title=release prep failed::${anno}`)
}
