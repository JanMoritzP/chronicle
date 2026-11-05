import { EditorContent, useEditor } from '@tiptap/react'
import { FilePlus2, LayoutTemplate, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { buildExtensions } from '../editor/extensions'
import { askText, confirmDialog } from '../lib/dialog'
import { useStore } from '../store'
import type { Template } from '../types'

const BLANK = { type: 'doc', content: [{ type: 'paragraph' }] }

export function TemplatesView() {
  const templates = useStore((s) => s.data.templates) ?? []
  const wsId = useStore((s) => s.wsId)!
  const readOnly = useStore((s) => s.user?.role === 'viewer')
  const navigate = useStore((s) => s.navigate)
  const [error, setError] = useState('')

  const create = async () => {
    const name = (await askText('New template', { label: 'Template name (you will type /name to use it)', okLabel: 'Create' }))?.trim()
    if (!name) return
    try {
      const t = await api.createTemplate(wsId, { name, content: BLANK })
      useStore.getState().upsertTemplate(t)
      navigate({ type: 'template', id: t.id })
    } catch (e: any) { setError(e.message) }
  }

  return (
    <div className="view">
      <h1 style={{ marginTop: 0 }}><LayoutTemplate size={26} style={{ verticalAlign: -3 }} /> Templates</h1>
      <p className="muted">
        A template is a piece of page you write once and reuse. Type <kbd>/</kbd> and its name in any page to insert it at the cursor.
        You can also turn an existing page into a template from its <kbd>…</kbd> menu.
      </p>
      {!readOnly && <p><button className="btn primary" onClick={create}><Plus size={14} style={{ verticalAlign: -2 }} /> New template</button></p>}
      {error && <div className="error">{error}</div>}
      {!templates.length && <div className="muted">No templates yet.</div>}
      {templates.map((t) => (
        <div key={t.id} className="todo-row" style={{ cursor: 'pointer' }} onClick={() => navigate({ type: 'template', id: t.id })}>
          <div className="grow" style={{ minWidth: 0 }}>
            <div><b>{t.name}</b> <code>/{t.slug}</code></div>
            {t.description && <div className="muted todo-context">{t.description}</div>}
          </div>
          {!readOnly && (
            <button className="btn sm" title="Create a new page from this template" onClick={async (e) => {
              e.stopPropagation()
              await useStore.getState().createPage({ content: t.content })
            }}><FilePlus2 size={13} style={{ verticalAlign: -2 }} /> New page</button>
          )}
        </div>
      ))}
    </div>
  )
}

export function TemplateEditor({ id }: { id: string }) {
  const template = useStore((s) => s.data.templates?.find((t) => t.id === id))
  const loaded = useStore((s) => s.loaded)
  if (!template) return <div className="view muted">{loaded ? 'This template no longer exists.' : 'Loading…'}</div>
  return <TemplateBody key={template.id} template={template} />
}

function TemplateBody({ template }: { template: Template }) {
  const readOnly = useStore((s) => s.user?.role === 'viewer')
  const navigate = useStore((s) => s.navigate)
  const [name, setName] = useState(template.name)
  const [description, setDescription] = useState(template.description)
  const [save, setSave] = useState<'saved' | 'saving' | 'dirty' | 'error'>('saved')
  const [error, setError] = useState('')
  const pending = useRef<{ name?: string; description?: string; content?: any }>({})
  const timer = useRef<number | undefined>(undefined)

  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    const body = pending.current
    if (!Object.keys(body).length) return
    pending.current = {}
    setSave('saving')
    try {
      const t = await api.patchTemplate(template.id, body)
      useStore.getState().upsertTemplate(t)
      setError('')
      setSave(Object.keys(pending.current).length ? 'dirty' : 'saved')
    } catch (e: any) {
      // a rejected name (e.g. already taken) must not block saving the rest
      if (body.name !== undefined && /already/.test(e.message)) {
        setError(e.message)
        const { name: _skip, ...rest } = body
        pending.current = { ...rest, ...pending.current }
        if (Object.keys(pending.current).length) { timer.current = window.setTimeout(flush, 300); return }
        setSave('saved')
      } else {
        pending.current = { ...body, ...pending.current }
        setError(e.message)
        setSave('error')
      }
    }
  }, [template.id])

  const schedule = useCallback((patch: typeof pending.current) => {
    pending.current = { ...pending.current, ...patch }
    setSave('dirty')
    clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, 700)
  }, [flush])

  useEffect(() => () => { flush() }, [flush])
  useEffect(() => {
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [flush])

  const extensions = useMemo(() => buildExtensions(), [])
  const editor = useEditor({
    extensions,
    content: template.content,
    editable: !readOnly,
    onUpdate: ({ editor }) => schedule({ content: editor.getJSON() }),
  }, [template.id])

  const slug = name.toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')

  return (
    <div>
      <div className="toolbar">
        <a className="muted grow" style={{ fontSize: 13, cursor: 'pointer' }} onClick={() => navigate({ type: 'templates' })}>Templates /</a>
        <span className="save-state">{readOnly ? 'Read-only' : save === 'saved' ? 'Saved' : save === 'saving' ? 'Saving…' : save === 'error' ? 'Not saved' : 'Unsaved'}</span>
        {!readOnly && (
          <>
            <button className="btn sm" onClick={async () => { await flush(); await useStore.getState().createPage({ content: editor?.getJSON() }) }}>
              <FilePlus2 size={13} style={{ verticalAlign: -2 }} /> New page from this
            </button>
            <button className="icon-btn" title="Delete this template" onClick={async () => {
              if (!(await confirmDialog('Pages already made from it are not affected.', { title: `Delete the template “${template.name}”?`, okLabel: 'Delete', danger: true }))) return
              clearTimeout(timer.current); pending.current = {}
              await api.deleteTemplate(template.id)
              useStore.getState().removeTemplateLocal(template.id)
              navigate({ type: 'templates' })
            }}><Trash2 size={16} /></button>
          </>
        )}
      </div>
      <div className="page">
        <input className="page-title" value={name} readOnly={readOnly} placeholder="Template name"
          onChange={(e) => { setName(e.target.value); schedule({ name: e.target.value }) }} />
        <div className="meta-row">
          <span>Insert with <code>/{slug || 'name'}</code></span>
        </div>
        <input className="input" style={{ width: '100%', margin: '4px 0 14px' }} value={description} readOnly={readOnly} maxLength={200}
          placeholder="Short description (shown in the slash menu)"
          onChange={(e) => { setDescription(e.target.value); schedule({ description: e.target.value }) }} />
        {error && <div className="error" style={{ marginBottom: 8 }}>{error}</div>}
        <div className="editor"><EditorContent editor={editor} /></div>
      </div>
    </div>
  )
}
