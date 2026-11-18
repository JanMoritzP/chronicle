import { useEffect, useState } from 'react'
import { ReadOnlyDoc } from '../editor/Embed'
import type { LibraryEntry } from '../types'
import { EntryBody } from './LibraryEntry'

interface PublicData { title: string; icon: string | null; updatedAt: number; portrait: string | null; content: any }

/** A library entry that the shared page links to (/s/:token?lib=key). Only entries linked from a shared page are served. */
function PublicEntry({ token, libKey }: { token: string; libKey: string }) {
  const [entry, setEntry] = useState<LibraryEntry | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    fetch(`/api/public/library/${encodeURIComponent(libKey)}`)
      .then(async (r) => {
        const j = await r.json().catch(() => null)
        if (!r.ok) throw new Error(j?.error ?? 'This entry is not shared.')
        return j as LibraryEntry
      })
      .then((e) => { if (alive) { setEntry(e); document.title = e.name } })
      .catch((e) => alive && setError(e.message))
    return () => { alive = false }
  }, [libKey])
  if (error) return <div className="login"><div className="public-missing"><h1>Chronicle</h1><p className="muted">{error}</p><p><a href={`/s/${token}`}>Back to the page</a></p></div></div>
  if (!entry) return <div className="public-wrap muted">Loading…</div>
  return (
    <div className="public-scroll">
      <article className="public-wrap">
        <p><a href={`/s/${token}`}>← Back to the page</a></p>
        <h1 className="public-title">{entry.name}</h1>
        <div className="lib-detail"><EntryBody entry={entry} /></div>
        <footer className="public-foot muted">Shared from Chronicle</footer>
      </article>
    </div>
  )
}

export function PublicPage({ token }: { token: string }) {
  const libKey = new URLSearchParams(location.search).get('lib')
  return libKey ? <PublicEntry token={token} libKey={libKey} /> : <PublicDoc token={token} />
}

/** Anonymous read-only view of a shared page, reached through /s/:token. No login, no sidebar, no links into the private world. */
function PublicDoc({ token }: { token: string }) {
  const [data, setData] = useState<PublicData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    fetch(`/api/public/${encodeURIComponent(token)}`)
      .then(async (r) => {
        const j = await r.json().catch(() => null)
        if (!r.ok) throw new Error(j?.error ?? 'This page is not shared (any more).')
        return j as PublicData
      })
      .then((d) => { if (alive) { setData(d); document.title = d.title || 'Shared page' } })
      .catch((e) => alive && setError(e.message))
    return () => { alive = false }
  }, [token])

  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1))
    if (!data || !id) return
    const t = setTimeout(() => document.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'start' }), 150)
    return () => clearTimeout(t)
  }, [data])

  if (error) return <div className="login"><div className="public-missing"><h1>Chronicle</h1><p className="muted">{error}</p></div></div>
  if (!data) return <div className="public-wrap muted">Loading…</div>
  const portraitInDoc = data.portrait ? JSON.stringify(data.content).includes(data.portrait) : false
  return (
    <div className="public-scroll">
      <article className="public-wrap">
        <h1 className="public-title">{data.icon ? `${data.icon} ` : ''}{data.title || 'Untitled'}</h1>
        {data.portrait && !portraitInDoc && <img className="public-portrait" src={data.portrait} alt="" />}
        <div className="editor"><ReadOnlyDoc doc={data.content} /></div>
        <footer className="public-foot muted">Shared from Chronicle · updated {new Date(data.updatedAt).toLocaleDateString()}</footer>
      </article>
    </div>
  )
}
