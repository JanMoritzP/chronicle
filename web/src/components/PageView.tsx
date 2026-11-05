import { EditorContent, useEditor } from '@tiptap/react'
import { Clock, Copy, Globe, LayoutTemplate, Maximize2, MoreHorizontal, PanelRightOpen, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '../api'
import { buildExtensions } from '../editor/extensions'
import { embedPicker, imagePicker, worldPicker } from '../editor/slash'
import { EventDialog, PageWorldSection, PinDialog } from './PageWorld'
import { PageRelationsSection, RelationDialog } from './Relations'
import { ShareDialog } from './ShareDialog'
import { pageSavedBus, todoBus } from '../lib/bus'
import { ago, backlinksOf } from '../lib/data'
import { searchPages } from '../lib/linkSearch'
import { useStore } from '../store'
import { alertDialog, askText } from '../lib/dialog'
import { typeOf } from '../lib/pageTypes'
import { TypeIcon, useTypes } from './TypeIcon'
import { TypeLayout } from './TypeLayout'
import { Select } from './Select'
import type { FullPage } from '../types'
import { ReadOnlyDoc } from '../editor/Embed'

type SaveState = 'saved' | 'saving' | 'dirty' | 'error'

export function PageView({ id, anchor }: { id: string; anchor?: string }) {
  const [page, setPage] = useState<FullPage | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    setPage(null)
    setError('')
    api.getPage(id, true).then((p) => alive && setPage(p)).catch((e) => alive && setError(e instanceof ApiError && e.status === 404 ? 'This page no longer exists.' : e.message))
    return () => { alive = false }
  }, [id])
  if (error) return <div className="view muted">{error}</div>
  if (!page) return <div className="view muted">Loading…</div>
  return <PageEditor key={id} page={page} anchor={anchor} />
}

function PageEditor({ page, anchor }: { page: FullPage; anchor?: string }) {
  const user = useStore((s) => s.user)!
  const readOnly = user.role === 'viewer'
  const zen = useStore((s) => s.zen)
  const meta = useStore((s) => s.data.pages.find((p) => p.id === page.id))
  const links = useStore((s) => s.data.links)
  const allPages = useStore((s) => s.data.pages)
  const folders = useStore((s) => s.data.folders)
  const [title, setTitle] = useState(page.title)
  const [tags, setTags] = useState<string[]>(page.tags)
  const [tagDraft, setTagDraft] = useState('')
  const [save, setSave] = useState<SaveState>('saved')
  const [words, setWords] = useState(page.wordCount)
  const [showHistory, setShowHistory] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [showShare, setShowShare] = useState(false)
  const pending = useRef<{ title?: string; tags?: string[]; content?: any; props?: Record<string, any> }>({})
  const [props, setProps] = useState<Record<string, any>>(page.props ?? {})
  const types = useTypes()
  const pageType = typeOf(types, { type: props.type ?? null })
  const timer = useRef<number | undefined>(undefined)
  const fileInput = useRef<HTMLInputElement>(null)
  const [embedFor, setEmbedFor] = useState<{ range: { from: number; to: number } } | null>(null)
  const [worldDialog, setWorldDialog] = useState<'pin' | 'event' | 'relation' | null>(null)
  const [worldVersion, setWorldVersion] = useState(0)

  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    const body = pending.current
    if (!Object.keys(body).length) return
    pending.current = {}
    setSave('saving')
    try {
      const r = await api.patchPage(page.id, body)
      const st = useStore.getState()
      st.patchPageMeta(page.id, {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.tags ? { tags: body.tags } : {}),
        ...(body.props ? { type: r.type ?? null } : {}),
        outline: r.outline, text: r.text, wordCount: r.wordCount, hasStats: r.hasStats, portrait: r.portrait, updatedAt: r.updatedAt,
        ...(body.content ? { todos: r.todos } : {}),
      })
      if (body.content) st.setLinksFor(page.id, r.links)
      if (body.title !== undefined) st.refresh()
      pageSavedBus.emit(page.id)
      setSave(Object.keys(pending.current).length ? 'dirty' : 'saved')
    } catch {
      pending.current = { ...body, ...pending.current }
      setSave('error')
      timer.current = window.setTimeout(flush, 5000)
    }
  }, [page.id])

  const schedule = useCallback((patch: typeof pending.current, delay = 700) => {
    pending.current = { ...pending.current, ...patch }
    setSave('dirty')
    clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, delay)
  }, [flush])

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flush() }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [flush])

  const extensions = useMemo(() => buildExtensions(), [])
  const editor = useEditor({
    extensions,
    content: page.content,
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      const json = editor.getJSON()
      api.setCachedContent(page.id, json)
      setWords(editor.getText().trim().split(/\s+/).filter(Boolean).length)
      schedule({ content: json })
    },
  }, [page.id])

  // images
  const upload = useCallback(async (file: File) => {
    const ws = useStore.getState().wsId!
    const fd = new FormData()
    fd.append('file', file)
    const r = await fetch(`/api/workspaces/${ws}/uploads`, { method: 'POST', body: fd })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) { alertDialog(data.error ?? 'Upload failed'); return null }
    return data.url as string
  }, [])
  useEffect(() => {
    imagePicker.pick = (ed) => {
      if (ed !== editor) return
      fileInput.current?.click()
    }
    embedPicker.pick = (ed, range) => { if (ed === editor) setEmbedFor({ range }) }
    worldPicker.pin = (ed) => { if (ed === editor) setWorldDialog('pin') }
    worldPicker.event = (ed) => { if (ed === editor) setWorldDialog('event') }
    worldPicker.relation = (ed) => { if (ed === editor) setWorldDialog('relation') }
    return () => { imagePicker.pick = null; embedPicker.pick = null; worldPicker.pin = null; worldPicker.event = null; worldPicker.relation = null }
  }, [editor])

  useEffect(() => {
    if (!editor || readOnly) return
    const dom = editor.view.dom
    const onPaste = async (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'))
      if (!f) return
      e.preventDefault()
      const url = await upload(f)
      if (url) editor.chain().focus().setImage({ src: url, alt: f.name }).run()
    }
    const onDrop = async (e: DragEvent) => {
      const f = [...(e.dataTransfer?.files ?? [])].find((x) => x.type.startsWith('image/'))
      if (!f) return
      e.preventDefault()
      const url = await upload(f)
      if (url) editor.chain().focus().setImage({ src: url, alt: f.name }).run()
    }
    dom.addEventListener('paste', onPaste)
    dom.addEventListener('drop', onDrop)
    return () => { dom.removeEventListener('paste', onPaste); dom.removeEventListener('drop', onDrop) }
  }, [editor, readOnly, upload])

  // scroll to a section when opened through {{Page#Section}}, or to a todo marker when opened from the Todos tab
  useEffect(() => {
    if (!anchor || !editor) return
    const t = setTimeout(() => {
      const el = editor.view.dom.querySelector(`[data-id="${CSS.escape(anchor)}"]`)
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      if (el?.matches('[data-todo]')) {
        el.classList.add('flash')
        setTimeout(() => el.classList.remove('flash'), 2200)
      }
    }, 120)
    return () => clearTimeout(t)
  }, [anchor, editor])

  // a todo changed in the Todos tab while this page is open (e.g. in a split pane)
  useEffect(() => {
    if (!editor) return
    return todoBus.on(({ pageId, todoId, change }) => {
      if (pageId !== page.id) return
      let found: { pos: number; size: number; attrs: any } | null = null
      editor.state.doc.descendants((n, pos) => {
        if (n.type.name === 'todo' && n.attrs.id === todoId) found = { pos, size: n.nodeSize, attrs: n.attrs }
        return !found
      })
      if (!found) return
      const f = found as { pos: number; size: number; attrs: any }
      const tr = change ? editor.state.tr.setNodeMarkup(f.pos, undefined, { ...f.attrs, ...change }) : editor.state.tr.delete(f.pos, f.pos + f.size)
      editor.view.dispatch(tr)
    })
  }, [editor, page.id])

  // focus empty new pages on the title
  const titleRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (!page.title && !readOnly) titleRef.current?.focus() }, [page.id, page.title, readOnly])

  const backlinks = useMemo(() => backlinksOf(links, page.id), [links, page.id])
  const unlinked = useMemo(() => {
    const t = (meta?.title ?? title).trim().toLowerCase()
    if (t.length < 3) return []
    const linked = new Set(backlinks.map((b) => b.sourceId))
    return allPages.filter((p) => p.id !== page.id && !linked.has(p.id) && p.text.toLowerCase().includes(t))
  }, [allPages, backlinks, meta?.title, title, page.id])

  const addTag = (raw: string) => {
    const t = raw.trim().replace(/^#/, '').toLowerCase().replace(/\s+/g, '-')
    if (!t || tags.includes(t)) return setTagDraft('')
    const next = [...tags, t]
    setTags(next)
    setTagDraft('')
    schedule({ tags: next }, 200)
  }
  const removeTag = (t: string) => {
    const next = tags.filter((x) => x !== t)
    setTags(next)
    schedule({ tags: next }, 200)
  }

  const typeData = useMemo(() => ({ ...(props.data ?? {}), portrait: props.portrait }), [props])
  const setTypeValue = (key: string, value: any) => {
    const next = { ...props }
    if (key === 'portrait') {
      if (value) next.portrait = value; else delete next.portrait
    } else {
      next.data = { ...(props.data ?? {}) }
      if (value == null || value === '') delete next.data[key]; else next.data[key] = value
    }
    setProps(next)
    schedule({ props: next }, 500)
  }
  const pickImage = () => new Promise<string | null>((resolve) => {
    const el = document.createElement('input')
    el.type = 'file'
    el.accept = 'image/png,image/jpeg,image/webp,image/gif,image/avif'
    el.onchange = async () => { const f = el.files?.[0]; resolve(f ? await upload(f) : null) }
    el.oncancel = () => resolve(null)
    el.click()
  })
  const changeType = (id: string) => {
    const next = { ...props }
    if (id) next.type = id; else delete next.type
    setProps(next)
    const newTag = types.find((t) => t.id === id)?.tag
    let nextTags = tags
    if (pageType?.tag && pageType.tag !== newTag) nextTags = nextTags.filter((t) => t !== pageType.tag)
    if (newTag && !nextTags.includes(newTag)) nextTags = [...nextTags, newTag]
    if (nextTags !== tags) setTags(nextTags)
    schedule({ props: next, ...(nextTags !== tags ? { tags: nextTags } : {}) }, 100)
  }

  const nav = useStore.getState().navigate
  const folderName = folders.find((f) => f.id === meta?.folderId)?.name

  return (
    <div className={zen ? 'zen' : ''}>
      {!zen && (
        <div className="toolbar">
          <span className="muted ellipsis grow" style={{ fontSize: 13 }}>{folderName ? `${folderName} /` : ''} {title || 'Untitled'}</span>
          <span className="save-state">{readOnly ? 'Read-only' : save === 'saved' ? 'Saved' : save === 'saving' ? 'Saving…' : save === 'error' ? 'Offline, retrying…' : 'Unsaved'}</span>
          <button className="icon-btn" title="Zen mode (Alt+Z)" onClick={() => useStore.getState().setUi({ zen: true })}><Maximize2 size={16} /></button>
          <button className="icon-btn" title="Open in split view" onClick={() => nav({ type: 'page', id: page.id }, { split: true })}><PanelRightOpen size={16} /></button>
          <button className="icon-btn" title="Version history" onClick={() => setShowHistory(true)}><Clock size={16} /></button>
          {!readOnly && (
            <div style={{ position: 'relative' }}>
              <button className="icon-btn" onClick={() => setShowMenu(!showMenu)}><MoreHorizontal size={16} /></button>
              {showMenu && (
                <div className="menu" style={{ position: 'absolute', right: 0, top: 30 }} onMouseLeave={() => setShowMenu(false)}>
                  <button onClick={async () => { setShowMenu(false); await flush(); useStore.getState().setUi({ copyPages: [page.id] }) }}><Copy size={15} /> Copy to another world…</button>
                  <button onClick={async () => {
                    setShowMenu(false)
                    const name = (await askText('Save as template', { label: 'Template name (you will type /name to use it)', initial: title || '', okLabel: 'Save' }))?.trim()
                    if (!name || !editor) return
                    try {
                      const t = await api.createTemplate(useStore.getState().wsId!, { name, content: editor.getJSON() })
                      useStore.getState().upsertTemplate(t)
                      alertDialog(`Type /${t.slug} in any page to insert it.`, 'Template saved')
                    } catch (e: any) { alertDialog(e.message) }
                  }}><LayoutTemplate size={15} /> Save as template…</button>
                  <button onClick={() => { setShowMenu(false); setShowShare(true) }}><Globe size={15} /> Share publicly…</button>
                  <button onClick={async () => { await flush(); await useStore.getState().deletePage(page.id) }}><Trash2 size={15} /> Move to trash</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {zen && (
        <div className="zen-bar">
          <button className="btn sm" onClick={() => useStore.getState().setUi({ searchOpen: true })}>Search</button>
          <button className="btn sm" onClick={() => useStore.getState().createPage()}>New page</button>
          <button className="btn sm" onClick={() => useStore.getState().setUi({ zen: false })}>Exit (Esc)</button>
        </div>
      )}
      <div className="page">
        <input
          ref={titleRef}
          className="page-title"
          value={title}
          placeholder="Untitled"
          readOnly={readOnly}
          onChange={(e) => { setTitle(e.target.value); schedule({ title: e.target.value }, 600) }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); editor?.commands.focus('start') } }}
        />
        <div className="meta-row">
          {(pageType || !readOnly) && (
            <span className="type-pick" title="Page type">
              <TypeIcon name={pageType?.icon ?? 'file-text'} size={14} />
              {readOnly ? <span>{pageType?.name}</span> : (
                <Select value={pageType?.id ?? ''} onChange={changeType}>
                  <option value="">Plain page</option>
                  {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
              )}
            </span>
          )}
          {tags.map((t) => (
            <span key={t} className="chip">
              <a style={{ color: 'inherit', textDecoration: 'none', cursor: 'pointer' }} onClick={() => nav({ type: 'tag', tag: t })}>#{t}</a>
              {!readOnly && <button onClick={() => removeTag(t)} style={{ opacity: .6 }}>×</button>}
            </span>
          ))}
          {!readOnly && (
            <input
              className="tag-input" placeholder="+ tag (nested: npc/villain)" value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagDraft) }
                if (e.key === 'Backspace' && !tagDraft && tags.length) removeTag(tags[tags.length - 1])
              }}
              onBlur={() => tagDraft && addTag(tagDraft)}
            />
          )}
          {meta && <span style={{ marginLeft: 'auto' }}>{words} words · edited {ago(meta.updatedAt)}</span>}
        </div>
        {pageType ? (
          <TypeLayout layout={pageType.layout} data={typeData} readOnly={readOnly} setValue={setTypeValue} pickImage={pickImage}
            body={<EditorContent editor={editor} />} />
        ) : (
          <div className="editor"><EditorContent editor={editor} /></div>
        )}

        {!zen && (
          <>
            <PageWorldSection pageId={page.id} readOnly={readOnly} version={worldVersion} />
            <PageRelationsSection pageId={page.id} readOnly={readOnly} version={worldVersion} />
            {backlinks.length > 0 && (
              <div className="section">
                <h3>Linked from ({backlinks.length})</h3>
                {backlinks.map((b) => {
                  const src = allPages.find((p) => p.id === b.sourceId)
                  return src && (
                    <a key={b.sourceId} className="backlink" data-page-id={src.id} onClick={() => nav({ type: 'page', id: src.id })}>
                      {src.icon} {src.title || 'Untitled'}
                    </a>
                  )
                })}
              </div>
            )}
            {unlinked.length > 0 && (
              <div className="section">
                <h3>Unlinked mentions ({unlinked.length})</h3>
                {unlinked.slice(0, 8).map((p) => (
                  <a key={p.id} className="backlink" data-page-id={p.id} onClick={() => nav({ type: 'page', id: p.id })}>{p.title || 'Untitled'}</a>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      {zen && <div className="zen-count">{words} words</div>}

      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" hidden
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f || !editor) return
          const url = await upload(f)
          if (url) editor.chain().focus().setImage({ src: url, alt: f.name }).run()
        }} />

      {worldDialog === 'pin' && <PinDialog pageId={page.id} onClose={() => setWorldDialog(null)} />}
      {worldDialog === 'event' && <EventDialog pageId={page.id} pageTitle={title} onClose={() => setWorldDialog(null)} onSaved={() => setWorldVersion((v) => v + 1)} />}
      {worldDialog === 'relation' && <RelationDialog pageId={page.id} pageTitle={title} onClose={() => setWorldDialog(null)} onSaved={() => setWorldVersion((v) => v + 1)} />}
      {embedFor && editor && <EmbedPicker onClose={() => setEmbedFor(null)} onPick={(p, anchorId) => {
        editor.chain().focus().deleteRange(embedFor.range).insertContent({ type: 'embed', attrs: { pageId: p.id, name: p.title, anchor: anchorId } }).run()
        setEmbedFor(null)
      }} />}
      {showShare && <ShareDialog pageId={page.id} title={title} onClose={() => setShowShare(false)} />}
      {showHistory && <History pageId={page.id} readOnly={readOnly} onClose={() => setShowHistory(false)}
        onRestore={async (content, t) => {
          await flush()
          await api.patchPage(page.id, { content, title: t })
          api.invalidate(page.id)
          setShowHistory(false)
          location.reload()
        }} />}
    </div>
  )
}

function EmbedPicker({ onClose, onPick }: { onClose: () => void; onPick: (p: { id: string; title: string }, anchor: string | null) => void }) {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const [chosen, setChosen] = useState<{ id: string; title: string; outline: { id: string; text: string; level: number }[] } | null>(null)
  const hits = useMemo(() => searchPages(q, 10), [q])
  const rows = chosen
    ? [{ key: 'whole', label: 'Whole page', run: () => onPick(chosen, null) },
       ...chosen.outline.map((h) => ({ key: h.id, label: `${'  '.repeat(h.level - 1)}${h.text}`, run: () => onPick(chosen, h.id) }))]
    : hits.map((h) => ({ key: h.page.id, label: h.page.title || 'Untitled', run: () => (h.page.outline.length ? setChosen(h.page) : onPick(h.page, null)) }))
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <input className="big" autoFocus placeholder={chosen ? `Embed from “${chosen.title}”: whole page or a section` : 'Embed which page?'} value={chosen ? '' : q} readOnly={!!chosen}
          onChange={(e) => { setQ(e.target.value); setIdx(0) }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(rows.length - 1, i + 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)) }
            if (e.key === 'Enter') rows[idx]?.run()
          }} />
        <div className="results">
          {rows.map((r, i) => <div key={r.key} className={`result ${i === idx ? 'sel' : ''}`} onMouseEnter={() => setIdx(i)} onClick={r.run} style={{ whiteSpace: 'pre' }}>{r.label}</div>)}
        </div>
      </div>
    </div>
  )
}

function History({ pageId, readOnly, onClose, onRestore }: { pageId: string; readOnly: boolean; onClose: () => void; onRestore: (content: any, title: string) => void }) {
  const [versions, setVersions] = useState<{ id: string; title: string; wordCount: number; createdAt: number }[]>([])
  const [sel, setSel] = useState<{ id: string; content: any; title: string } | null>(null)
  useEffect(() => { api.versions(pageId).then(setVersions) }, [pageId])
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog" style={{ width: 860 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="row" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <b className="grow">Version history</b>
          <button className="btn sm" onClick={onClose}>Close</button>
        </div>
        <div className="row" style={{ alignItems: 'stretch', minHeight: 0, flex: 1 }}>
          <div className="results" style={{ width: 230, borderRight: '1px solid var(--border)', flex: 'none' }}>
            {!versions.length && <div className="muted" style={{ padding: 10 }}>No earlier versions yet. Snapshots are taken while you edit.</div>}
            {versions.map((v) => (
              <div key={v.id} className={`result ${sel?.id === v.id ? 'sel' : ''}`} onClick={() => api.version(v.id).then((d) => setSel({ id: v.id, ...d }))}>
                <div><div>{new Date(v.createdAt).toLocaleString()}</div><div className="sub">{v.wordCount} words</div></div>
              </div>
            ))}
          </div>
          <div className="grow" style={{ overflow: 'auto', padding: 16 }}>
            {sel ? (
              <>
                {!readOnly && <button className="btn primary sm" style={{ marginBottom: 10 }} onClick={() => onRestore(sel.content, sel.title)}>Restore this version</button>}
                <h2 style={{ marginTop: 0 }}>{sel.title}</h2>
                <div className="editor"><ReadOnlyDoc doc={sel.content} /></div>
              </>
            ) : <span className="muted">Select a version to preview it.</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
