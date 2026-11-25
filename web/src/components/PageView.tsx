import { EditorContent, useEditor } from '@tiptap/react'
import { BookMarked, BookUp, Clock, Copy, Globe, LayoutTemplate, Maximize2, MoreHorizontal, MoveHorizontal, PanelRightOpen, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '../api'
import { buildExtensions } from '../editor/extensions'
import { embedPicker, imagePicker, worldPicker } from '../editor/slash'
import { EventDialog, PageWorldSection, PinDialog } from './PageWorld'
import { PageRelationsSection, RelationDialog } from './Relations'
import { ShareDialog } from './ShareDialog'
import { liveBus } from '../lib/bus'
import { CollabProvider, colorFor, type CollabStatus } from '../lib/collab'
import { ago, backlinksOf } from '../lib/data'
import { autolinkDoc, buildMatcher } from '../lib/autolink'
import { useLibrary } from '../lib/library'
import { searchPages } from '../lib/linkSearch'
import { useStore } from '../store'
import { alertDialog, askText, confirmDialog } from '../lib/dialog'
import { importCharacter } from '../lib/importers'
import { typeOf } from '../lib/pageTypes'
import { TypeIcon, useTypes } from './TypeIcon'
import { TypeLayout } from './TypeLayout'
import type { SheetPatch } from './SheetView'
import { emptyCharacter, emptyPf2eCharacter, emptyPf2eCreature, pfDerived, patchSheetLocal, sheetOf, wholeSheetPatch, type Sheet } from '../lib/sheet'
import { CharacterBuilder } from './CharacterBuilder'
import { CharacterSheet, type PictureKey } from './CharacterSheet'
import { PushDialog, RulesPanel } from './Homebrew'
import { emptyRules, hasRules, isHomebrewKey } from '../lib/homebrew'
import { Pf2eCharacterSheet } from './Pf2eCharacterSheet'
import { Select } from './Select'
import { PlayedBy } from './PlayedBy'
import type { FullPage, PageVersion } from '../types'
import { ReadOnlyDoc } from '../editor/Embed'
import { BlockHandle } from '../editor/BlockHandle'
import { FormatBubble } from '../editor/FormatBubble'
import { PAGE_WIDTHS, setPageWidth, usePageWidth } from '../lib/pageWidth'

type SaveState = 'saved' | 'saving' | 'dirty' | 'error'

export function PageView({ id, anchor }: { id: string; anchor?: string }) {
  const [page, setPage] = useState<FullPage | null>(null)
  const [error, setError] = useState('')
  // bumped when the page was replaced behind our back (version restore, backup restore): load it again
  const [epoch, setEpoch] = useState(0)
  useEffect(() => {
    let alive = true
    setPage(null)
    setError('')
    api.getPage(id, true).then((p) => alive && setPage(p)).catch((e) => alive && setError(e instanceof ApiError && e.status === 404 ? 'This page no longer exists.' : e.message))
    return () => { alive = false }
  }, [id, epoch])
  if (error) return <div className="view muted">{error}</div>
  if (!page) return <div className="view muted">Loading…</div>
  return <PageEditor key={`${id}:${epoch}`} page={page} anchor={anchor} onReload={() => setEpoch((e) => e + 1)} />
}

type PropsPatch = { data?: Record<string, any>; portrait?: string | null; type?: string | null; sheet?: Record<string, unknown>; players?: string[]; rules?: Record<string, any> | null; library?: string | null }
type Pending = { title?: string; tags?: string[]; propsPatch?: PropsPatch }

function PageEditor({ page, anchor, onReload }: { page: FullPage; anchor?: string; onReload: () => void }) {
  const user = useStore((s) => s.user)!
  const online = useStore((s) => s.online)
  const others = online.filter((o) => o.id !== user.id)
  /** reads the world only; may still change the page of a character they play (its text and sheet, not its place in the world) */
  const viewer = user.role === 'viewer'
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
  const [pushing, setPushing] = useState(false)
  const pending = useRef<Pending>({})
  const [props, setProps] = useState<Record<string, any>>(page.props ?? {})
  const players: string[] = Array.isArray(props.players) ? props.players : []
  const readOnly = viewer && !players.includes(user.id)
  const setPlayers = (next: string[]) => { setProps({ ...props, players: next }); schedule({ propsPatch: { players: next } }, 100) }
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
      // the text itself is saved by the server from the shared document; only the page's own fields go through here
      st.patchPageMeta(page.id, {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.tags ? { tags: body.tags } : {}),
        ...(body.propsPatch ? { type: r.type ?? null, portrait: r.portrait } : {}),
        updatedAt: r.updatedAt,
      })
      if (body.title !== undefined) st.refresh()
      setSave(Object.keys(pending.current).length ? 'dirty' : 'saved')
    } catch {
      pending.current = { ...body, ...pending.current }
      setSave('error')
      timer.current = window.setTimeout(flush, 5000)
    }
  }, [page.id])

  const schedule = useCallback((patch: Pending, delay = 700) => {
    const cur = pending.current
    pending.current = { ...cur, ...patch }
    // field changes pile up until the save goes out, so none is lost
    if (patch.propsPatch) {
      const data = cur.propsPatch?.data || patch.propsPatch.data ? { data: { ...cur.propsPatch?.data, ...patch.propsPatch.data } } : {}
      const sheet = cur.propsPatch?.sheet || patch.propsPatch.sheet ? { sheet: { ...cur.propsPatch?.sheet, ...patch.propsPatch.sheet } } : {}
      pending.current.propsPatch = { ...cur.propsPatch, ...patch.propsPatch, ...data, ...sheet }
    }
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

  // The text lives in a shared document that everyone editing this page is connected to. Until it has loaded the page
  // shows the last saved text, read-only, so nobody types into a document that is about to be replaced.
  const reloadRef = useRef(onReload)
  reloadRef.current = onReload
  const [provider, setProvider] = useState<CollabProvider | null>(null)
  const [live, setLive] = useState(false)
  const [conn, setConn] = useState<CollabStatus>('connecting')
  useEffect(() => {
    const p = new CollabProvider(page.id)
    const offs = [
      p.subscribe(() => { setConn(p.status); if (p.synced) setLive(true) }),
      p.onReloadNotice(() => { api.invalidate(page.id); reloadRef.current() }),
    ]
    setProvider(p)
    return () => { offs.forEach((off) => off()); setProvider(null); setLive(false); p.destroy() }
  }, [page.id])

  const collab = live && provider ? { provider, user: { name: user.username, color: colorFor(user.username) } } : undefined
  const extensions = useMemo(() => buildExtensions({ collab }), [collab?.provider])
  const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length
  const editor = useEditor({
    extensions,
    content: collab ? undefined : page.content,
    editable: !readOnly && !!collab,
    onCreate: ({ editor }) => setWords(countWords(editor.getText())),
    onUpdate: ({ editor }) => setWords(countWords(editor.getText())),
  }, [page.id, collab?.provider])

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
    /** Uploads the images and puts them in at `at` (a document position), or at the cursor. */
    const insertImages = async (files: File[], at?: number) => {
      const nodes = []
      for (const f of files) {
        const url = await upload(f)
        if (url) nodes.push({ type: 'image', attrs: { src: url, alt: f.name } })
      }
      if (!nodes.length || editor.isDestroyed) return
      const c = editor.chain().focus()
      ;(at != null ? c.insertContentAt(Math.min(at, editor.state.doc.content.size), nodes) : c.insertContent(nodes)).run()
    }
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((x) => x.type.startsWith('image/'))
      if (!files.length) return
      e.preventDefault()
      insertImages(files).catch((err) => alertDialog(err.message))
    }
    const onDrop = (e: DragEvent) => {
      const files = [...(e.dataTransfer?.files ?? [])].filter((x) => x.type.startsWith('image/'))
      if (!files.length) return
      e.preventDefault()
      // where the pictures were let go, not where the cursor happened to be
      const at = editor.view.posAtCoords({ left: e.clientX, top: e.clientY })?.pos
      insertImages(files, at).catch((err) => alertDialog(err.message))
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
      if (el?.matches('[data-todo], [data-comment]')) {
        el.classList.add('flash')
        setTimeout(() => el.classList.remove('flash'), 2200)
      }
    }, 120)
    return () => clearTimeout(t)
  }, [anchor, editor])

  // someone else changed this page's title, tags or fields: show it unless we have our own change on its way
  useEffect(() => liveBus.on((c) => {
    if (c.pageId !== page.id) return
    api.getPage(page.id, true).then((p) => {
      const mine = pending.current
      if (mine.title === undefined && document.activeElement !== titleRef.current) setTitle(p.title)
      if (!mine.tags) setTags(p.tags)
      if (!mine.propsPatch) setProps(p.props ?? {})
    }).catch(() => {})
  }), [page.id])

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
      if (key === 'main') delete next.sheet
    }
    setProps(next)
    schedule({ propsPatch: key === 'portrait' ? { portrait: value || null } : { data: { [key]: value == null || value === '' ? null : value } } }, 500)
  }
  /** Edits the creature sheet. The first edit of an old stat block stores the whole converted sheet. */
  const setSheetFields = (patch: SheetPatch) => {
    const base = sheetOf(props)
    if (!base) return
    setProps({ ...props, sheet: patchSheetLocal(base, patch) })
    schedule({ propsPatch: { sheet: props.sheet ? patch : { ...wholeSheetPatch(base), ...patch } } }, 500)
  }
  const system = useStore((s) => s.workspaces.find((w) => w.id === s.wsId)?.settings?.system ?? '5e')
  const addPf2eSheet = () => {
    const sheet = { ...emptyPf2eCreature(), name: title }
    setProps({ ...props, sheet })
    schedule({ propsPatch: { sheet: wholeSheetPatch(sheet) } }, 200)
  }
  const addPf2eCharacter = () => {
    const base = { ...emptyPf2eCharacter(), name: title }
    const sheet = patchSheetLocal(base, pfDerived(base))
    setProps({ ...props, sheet })
    schedule({ propsPatch: { sheet: wholeSheetPatch(sheet) } }, 200)
  }
  const addCharacterSheet = () => {
    const sheet = { ...emptyCharacter(system === '5e-2024' ? '5e-2024' : '5e'), name: title }
    setProps({ ...props, sheet })
    schedule({ propsPatch: { sheet: wholeSheetPatch(sheet) } }, 200)
  }
  /** The rules a homebrew class, species or background gives the character builder. */
  const setRules = (rules: Record<string, any>) => {
    setProps({ ...props, rules })
    schedule({ propsPatch: { rules } }, 100)
  }
  const [building, setBuilding] = useState(false)
  const createBuilt = (sheet: Sheet) => {
    setBuilding(false)
    setProps({ ...props, sheet })
    if (!title.trim() && sheet.name) setTitle(sheet.name)
    schedule({ propsPatch: { sheet: wholeSheetPatch(sheet) }, ...(!title.trim() && sheet.name ? { title: sheet.name } : {}) }, 100)
  }
  const importCharacterFile = async () => {
    const f = await new Promise<File | null>((resolve) => { const el = document.createElement('input'); el.type = 'file'; el.accept = '.json,application/json'; el.onchange = () => resolve(el.files?.[0] ?? null); el.oncancel = () => resolve(null); el.click() })
    if (!f) return
    let raw: unknown
    try { raw = JSON.parse(await f.text()) } catch { alertDialog('That file could not be read. A character is a JSON file.'); return }
    const r = importCharacter(raw, system === '5e-2024' ? '5e-2024' : '5e')
    if ('error' in r) { alertDialog(r.error); return }
    const sheet = { ...r.sheet, kind: 'character' as const, name: r.sheet.name || title }
    setProps({ ...props, sheet })
    schedule({ propsPatch: { sheet: wholeSheetPatch(sheet) } }, 200)
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
    schedule({ propsPatch: { type: id || null }, ...(nextTags !== tags ? { tags: nextTags } : {}) }, 100)
  }

  const nav = useStore.getState().navigate
  const width = usePageWidth()
  const nextWidth = PAGE_WIDTHS[(PAGE_WIDTHS.findIndex((w) => w.id === width) + 1) % PAGE_WIDTHS.length]
  const hasSide = !!pageType && pageType.layout.columns !== 'single' && pageType.layout.side.length > 0
  const surface = (
    <div className="editor-surface">
      <BlockHandle editor={editor} />
      <EditorContent editor={editor} />
      {!readOnly && <FormatBubble editor={editor} />}
    </div>
  )
  const folderName = folders.find((f) => f.id === meta?.folderId)?.name

  return (
    <div className={zen ? 'zen' : ''}>
      {!zen && (
        <div className="toolbar">
          <span className="muted ellipsis grow" style={{ fontSize: 13 }}>{folderName ? `${folderName} /` : ''} {title || 'Untitled'}</span>
          {others.length > 0 && (
            <span className="presence" title={`Also here: ${others.map((o) => o.username).join(', ')}`}>
              {others.slice(0, 4).map((o) => <span key={o.id} className="avatar" style={{ background: colorFor(o.username) }}>{o.username.slice(0, 1).toUpperCase()}</span>)}
              {others.length > 4 && <span className="avatar more">+{others.length - 4}</span>}
            </span>
          )}
          <span className="save-state">{readOnly ? (conn === 'offline' ? 'Offline' : 'Read-only') : conn === 'offline' ? 'Offline, changes sync later' : !live ? 'Connecting…' : save === 'saved' ? 'Saved' : save === 'saving' ? 'Saving…' : save === 'error' ? 'Offline, retrying…' : 'Unsaved'}</span>
          <button className="icon-btn" aria-label="Page width" title={`Page width: ${PAGE_WIDTHS.find((w) => w.id === width)?.label}. Click for ${nextWidth.label.toLowerCase()}.`} onClick={() => setPageWidth(nextWidth.id)}><MoveHorizontal size={16} /></button>
          <button className="icon-btn" title="Zen mode (Alt+Z)" onClick={() => useStore.getState().setUi({ zen: true })}><Maximize2 size={16} /></button>
          <button className="icon-btn" title="Open in split view" onClick={() => nav({ type: 'page', id: page.id }, { split: true })}><PanelRightOpen size={16} /></button>
          <button className="icon-btn" title="Version history" onClick={() => setShowHistory(true)}><Clock size={16} /></button>
          {!viewer && (
            <div style={{ position: 'relative' }}>
            <button className="icon-btn" title="More actions" onClick={() => setShowMenu(!showMenu)}><MoreHorizontal size={16} /></button>
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
                  <button title="Turns the names of spells, conditions, abilities and other library entries in the text into links" onClick={async () => {
                    setShowMenu(false)
                    if (!editor) return
                    const lib = useLibrary.getState()
                    if (!lib.loaded) await lib.load().catch(() => {})
                    const index = useLibrary.getState().index
                    if (!index) { alertDialog('The library is empty. The owner can download it from the Library view.'); return }
                    const { doc, count } = autolinkDoc(editor.getJSON(), buildMatcher(index), { key: meta?.library ?? undefined, name: title })
                    if (!count) { alertDialog('No names of library entries were found that are not linked yet.', 'Nothing to link'); return }
                    editor.chain().setContent(doc, { emitUpdate: true }).run()
                    alertDialog(`${count === 1 ? '1 name is' : `${count} names are`} now linked to the library.`, 'Links added')
                  }}><BookMarked size={15} /> Link library terms</button>
                  <button title="Copies the page into one of your libraries, so every world on this server can add it" onClick={async () => { setShowMenu(false); await flush(); setPushing(true) }}><BookUp size={15} /> {isHomebrewKey(meta?.library) ? 'Update in the library…' : 'Put in a library…'}</button>
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
      <div className={zen ? 'page' : `page width-${width}${hasSide ? ' has-side' : ''}`}>
        <input
          ref={titleRef}
          className="page-title"
          aria-label="Page title"
          value={title}
          placeholder="Untitled"
          readOnly={readOnly}
          onChange={(e) => { setTitle(e.target.value); schedule({ title: e.target.value }, 600) }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); editor?.commands.focus('start') } }}
        />
        <div className="meta-row">
          {(pageType || !viewer) && (
            <span className="type-pick" title="Page type">
              <TypeIcon name={pageType?.icon ?? 'file-text'} size={14} />
              {viewer ? <span>{pageType?.name}</span> : (
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
              {!viewer && <button onClick={() => removeTag(t)} style={{ opacity: .6 }}>×</button>}
            </span>
          ))}
          {!viewer && (
            <input
              className="tag-input" aria-label="Add tags" placeholder="+ tag (nested: npc/villain)" value={tagDraft}
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
        {(pageType?.id === 'person' || sheetOf(props)?.kind === 'character' || players.length > 0) && !zen && <PlayedBy players={players} readOnly={viewer} onChange={setPlayers} />}
        {viewer && !readOnly && <p className="player-note muted">You play this character: you can change its text and sheet.</p>}
        {sheetOf(props)?.kind === 'character' ? (
          sheetOf(props)!.pf2e?.char
            ? <Pf2eCharacterSheet sheet={sheetOf(props)!} set={readOnly ? undefined : setSheetFields} />
            : <CharacterSheet sheet={sheetOf(props)!} set={readOnly ? undefined : setSheetFields} pictures={{
              banner: typeof props.data?.banner === 'string' ? props.data.banner : undefined,
              portrait: typeof props.portrait === 'string' ? props.portrait : undefined,
              token: typeof props.data?.token === 'string' ? props.data.token : undefined,
              ...(readOnly ? {} : { set: (k: PictureKey, url: string | null) => setTypeValue(k, url), pick: pickImage }),
            }} />
        ) : pageType?.id === 'person' && !readOnly && !zen ? (
          <div className="cs-start">
            <div>
              <b>No character sheet yet</b>
              <span className="muted">{system === 'pf2e' ? 'Add a Pathfinder sheet and fill it in.' : 'Build one step by step with the rules, start from a blank sheet, or bring one from another tool.'}</span>
            </div>
            <div className="cs-start-actions">
              {system !== 'pf2e' && <button className="btn primary" onClick={() => setBuilding(true)}>Build a character</button>}
              <button className="btn sm" onClick={system === 'pf2e' ? addPf2eCharacter : addCharacterSheet}>Add a character sheet</button>
              {system !== 'pf2e' && <button className="btn sm" title="From a Chronicle, Foundry, D&D Beyond or Roll20 file" onClick={importCharacterFile}>Import a character</button>}
            </div>
          </div>
        ) : null}
        {pageType && hasRules(pageType.id) && (props.rules || !readOnly) && !zen && (props.rules
          ? <RulesPanel category={pageType.id} rules={props.rules} readOnly={readOnly} ruleset={system === '5e-2024' ? '5e-2024' : '5e'} onSave={setRules} />
          : <div className="cs-start"><div><b>Not in the character builder yet</b><span className="muted">Give this {pageType.name.toLowerCase()} the numbers the builder needs, and it can be chosen there.</span></div><button className="btn sm" onClick={() => setRules(emptyRules(pageType.id as 'class'))}>Add rules for the builder</button></div>)}
        {pageType ? (
          <TypeLayout layout={pageType.layout} data={typeData} readOnly={readOnly} setValue={setTypeValue} pickImage={pickImage} sheet={{ value: sheetOf(props), set: setSheetFields, createPf2e: system === 'pf2e' ? addPf2eSheet : undefined }}
            body={surface} />
        ) : (
          <div className="editor">{surface}</div>
        )}

        {!zen && (
          <>
            <PageWorldSection pageId={page.id} readOnly={viewer} version={worldVersion} />
            <PageRelationsSection pageId={page.id} readOnly={viewer} version={worldVersion} />
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
          if (url) editor.chain().focus().insertContent({ type: 'image', attrs: { src: url, alt: f.name } }).run()
        }} />

      {worldDialog === 'pin' && <PinDialog pageId={page.id} onClose={() => setWorldDialog(null)} />}
      {worldDialog === 'event' && <EventDialog pageId={page.id} pageTitle={title} onClose={() => setWorldDialog(null)} onSaved={() => setWorldVersion((v) => v + 1)} />}
      {worldDialog === 'relation' && <RelationDialog pageId={page.id} pageTitle={title} onClose={() => setWorldDialog(null)} onSaved={() => setWorldVersion((v) => v + 1)} />}
      {embedFor && editor && <EmbedPicker onClose={() => setEmbedFor(null)} onPick={(p, anchorId) => {
        editor.chain().focus().deleteRange(embedFor.range).insertContent({ type: 'embed', attrs: { pageId: p.id, name: p.title, anchor: anchorId } }).run()
        setEmbedFor(null)
      }} />}
      {showShare && <ShareDialog pageId={page.id} title={title} onClose={() => setShowShare(false)} />}
      {pushing && <PushDialog pageId={page.id} onClose={() => setPushing(false)} />}
      {building && <CharacterBuilder ruleset={system === '5e-2024' ? '5e-2024' : '5e'} name={title} onCreate={createBuilt} onClose={() => setBuilding(false)} />}
      {showHistory && <History pageId={page.id} readOnly={viewer} onClose={() => setShowHistory(false)}
        onRestore={async (vid) => {
          await flush()
          const r = await api.restoreVersion(vid, page.id)
          useStore.getState().patchPageMeta(page.id, {
            title: r.title, icon: r.icon, aliases: r.aliases, tags: r.tags, outline: r.outline, text: r.text,
            wordCount: r.wordCount, hasStats: r.hasStats, portrait: r.portrait, updatedAt: r.updatedAt, todos: r.todos, type: r.type,
          })
          useStore.getState().setLinksFor(page.id, r.links)
          setShowHistory(false)
          onReload()
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
        <input className="big" autoFocus aria-label={chosen ? `Embed from ${chosen.title}: whole page or a section` : 'Embed which page?'} placeholder={chosen ? `Embed from "${chosen.title}": whole page or a section` : 'Embed which page?'} value={chosen ? '' : q} readOnly={!!chosen}
          onChange={(e) => { setQ(e.target.value); setIdx(0) }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(rows.length - 1, i + 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)) }
            if (e.key === 'Enter') rows[idx]?.run()
          }} />
        <div className="results" aria-live="polite">
          {rows.map((r, i) => <div key={r.key} className={`result ${i === idx ? 'sel' : ''}`} role="option" aria-selected={i === idx} onMouseEnter={() => setIdx(i)} onClick={r.run} style={{ whiteSpace: 'pre' }}>{r.label}</div>)}
        </div>
      </div>
    </div>
  )
}

function History({ pageId, readOnly, onClose, onRestore }: { pageId: string; readOnly: boolean; onClose: () => void; onRestore: (versionId: string) => Promise<void> }) {
  const [versions, setVersions] = useState<PageVersion[]>([])
  const [sel, setSel] = useState<{ id: string; content: any; title: string; meta: { icon: string | null; aliases: string[]; tags: string[] } | null; createdAt: number } | null>(null)
  useEffect(() => { api.versions(pageId).then(setVersions).catch((e) => alertDialog(e.message)) }, [pageId])
  const restore = async () => {
    if (!sel) return
    const when = new Date(sel.createdAt).toLocaleString()
    if (!await confirmDialog(`Restore the page as it was on ${when}? The page as it is now stays in the history, so you can go back.`, { title: 'Restore this version', okLabel: 'Restore' })) return
    onRestore(sel.id).catch((e) => alertDialog(e.message))
  }
  return (
    <div className="overlay" onMouseDown={onClose} role="dialog" aria-modal="true" aria-label="Version history">
      <div className="dialog" style={{ width: 860 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="row" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <b className="grow">Version history</b>
          <button className="btn sm" onClick={onClose} aria-label="Close">Close</button>
        </div>
        <div className="row" style={{ alignItems: 'stretch', minHeight: 0, flex: 1 }}>
          <div className="results" style={{ width: 230, borderRight: '1px solid var(--border)', flex: 'none' }} role="listbox" aria-label="Versions">
            {!versions.length && <div className="muted" style={{ padding: 10 }}>No versions yet. Every edit to this page is recorded here, with who made it.</div>}
            {versions.map((v) => (
              <div key={v.id} className={`result ${sel?.id === v.id ? 'sel' : ''}`} role="option" aria-selected={sel?.id === v.id} tabIndex={0}
                onClick={() => api.version(v.id).then((d) => setSel({ id: v.id, createdAt: v.createdAt, ...d })).catch((e) => alertDialog(e.message))}>
                <div>
                  <div>{new Date(v.createdAt).toLocaleString()}</div>
                  <div className="sub">{v.authorName ?? 'Earlier version'} · {v.wordCount} words</div>
                  {v.reason === 'restore' && v.restoredFrom && <div className="sub">Restored the version from {new Date(v.restoredFrom).toLocaleString()}</div>}
                </div>
              </div>
            ))}
          </div>
          <div className="grow" style={{ overflow: 'auto', padding: 16 }} role="region" aria-label="Version preview">
            {sel ? (
              <>
                {!readOnly && <button className="btn primary sm" style={{ marginBottom: 10 }} onClick={restore}>Restore this version</button>}
                <h2 style={{ marginTop: 0 }}>{sel.title}</h2>
                {sel.meta && (sel.meta.tags.length > 0 || sel.meta.aliases.length > 0) && (
                  <div className="muted" style={{ marginBottom: 8 }}>
                    {sel.meta.tags.length > 0 && <div>Tags: {sel.meta.tags.map((t) => `#${t}`).join(', ')}</div>}
                    {sel.meta.aliases.length > 0 && <div>Also known as: {sel.meta.aliases.join(', ')}</div>}
                  </div>
                )}
                <div className="editor"><ReadOnlyDoc doc={sel.content} /></div>
              </>
            ) : <span className="muted">Select a version to preview it.</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
