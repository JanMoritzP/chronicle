import { FileUp, FolderUp, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { FORMAT_LABEL, plan as makePlan, type Plan } from '../lib/import/formats'
import { runImport, type ImportResult } from '../lib/import/run'
import { droppedFiles, sourcesFrom } from '../lib/import/sources'
import { useStore } from '../store'

/**
 * Brings pages in from other tools: an Obsidian vault, a Notion or Logseq export, LegendKeeper, World Anvil or Roam
 * exports, or any Markdown, HTML or text files. Links between the pages, folders, tags, aliases and pictures come along.
 */
export function ImportDialog() {
  const open = useStore((s) => s.importOpen)
  const wsId = useStore((s) => s.wsId)
  const titles = useStore((s) => s.data.pages)
  const folderInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [reading, setReading] = useState(false)
  const [over, setOver] = useState(false)
  const [intoFolder, setIntoFolder] = useState(true)
  const [folderName, setFolderName] = useState('')
  const [skipExisting, setSkipExisting] = useState(true)
  const [progress, setProgress] = useState<{ done: number; total: number; step: string } | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [err, setErr] = useState('')
  const [showSkipped, setShowSkipped] = useState(false)
  if (!open) return null

  const close = () => {
    if (progress && !result) return
    useStore.getState().setUi({ importOpen: false })
    setPlan(null); setResult(null); setProgress(null); setErr(''); setShowSkipped(false)
  }

  const read = async (files: { path: string; blob: Blob }[]) => {
    if (!files.length) return
    setReading(true); setErr(''); setPlan(null)
    try {
      const p = await makePlan(await sourcesFrom(files))
      setPlan(p)
      setFolderName(`Imported from ${FORMAT_LABEL[p.format].replace(/ (vault|export|graph|files|pages)$/i, '')}`)
      if (!p.pages.length) setErr('No pages were found in these files.')
    } catch (e: any) { setErr(e.message) }
    setReading(false)
  }

  const start = async () => {
    if (!plan || !wsId) return
    setProgress({ done: 0, total: plan.pages.length * 2, step: 'Starting' })
    try {
      setResult(await runImport(wsId, plan, { intoFolder: intoFolder ? folderName.trim() || 'Imported' : null, skipExisting }, (done, total, step) => setProgress({ done, total, step })))
    } catch (e: any) { setErr(e.message); setProgress(null) }
  }

  const taken = new Set(titles.map((p) => p.title.trim().toLowerCase()))
  const clashes = plan ? plan.pages.filter((p) => taken.has(p.title.trim().toLowerCase())).length : 0
  const folders = plan ? new Set(plan.pages.map((p) => p.folder.join('/')).filter(Boolean)).size : 0

  return (
    <div className="overlay" onMouseDown={close}>
      <div className="dialog import-dialog" role="dialog" aria-label="Import pages" style={{ padding: 16, gap: 12 }} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') close() }}>
        <b className="row"><Upload size={16} /> Import pages</b>
        {!result && !progress && (
          <>
            <div className="muted" style={{ fontSize: 13 }}>
              Brings in notes from Obsidian, Notion, Logseq, LegendKeeper, World Anvil and Roam, or any Markdown, HTML or text files.
              Choose the folder, or the .zip the other app exported. Links between the pages, folders, tags and pictures come along.
            </div>
            <div className={`import-drop${over ? ' over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
              onDrop={async (e) => { e.preventDefault(); setOver(false); read(await droppedFiles(e.dataTransfer)) }}>
              <span className="muted">Drop a folder, a .zip or files here, or</span>
              <div className="row" style={{ justifyContent: 'center' }}>
                <button className="btn" onClick={() => folderInput.current?.click()}><FolderUp size={14} /> Choose a folder</button>
                <button className="btn" onClick={() => fileInput.current?.click()}><FileUp size={14} /> Choose files or a .zip</button>
              </div>
            </div>
            <input ref={folderInput} type="file" hidden multiple {...{ webkitdirectory: '' }} onChange={(e) => { read([...(e.target.files ?? [])].map((f) => ({ path: f.webkitRelativePath || f.name, blob: f }))); e.target.value = '' }} />
            <input ref={fileInput} type="file" hidden multiple accept=".zip,.md,.markdown,.txt,.html,.htm,.json,.lk,.csv,.png,.jpg,.jpeg,.gif,.webp,.avif" onChange={(e) => { read([...(e.target.files ?? [])].map((f) => ({ path: f.name, blob: f }))); e.target.value = '' }} />
            {reading && <div className="muted">Reading the files…</div>}
            {plan && plan.pages.length > 0 && (
              <>
                <div className="import-found">
                  <b>{FORMAT_LABEL[plan.format]}</b>: {plan.pages.length} {plan.pages.length === 1 ? 'page' : 'pages'}
                  {folders ? ` in ${folders} ${folders === 1 ? 'folder' : 'folders'}` : ''}{plan.pictures.size ? `, ${plan.pictures.size} ${plan.pictures.size === 1 ? 'picture' : 'pictures'}` : ''}.
                  <div className="muted ellipsis" style={{ fontSize: 13 }}>{plan.pages.slice(0, 8).map((p) => p.title).join(', ')}{plan.pages.length > 8 ? ', …' : ''}</div>
                </div>
                <label className="row" style={{ gap: 8 }}>
                  <input type="checkbox" checked={intoFolder} onChange={(e) => setIntoFolder(e.target.checked)} /> Put everything in a new folder
                </label>
                {intoFolder && <input className="input" aria-label="Folder name" maxLength={100} value={folderName} onChange={(e) => setFolderName(e.target.value)} placeholder="Imported from Obsidian" />}
                {clashes > 0 && (
                  <label className="row" style={{ gap: 8 }}>
                    <input type="checkbox" checked={skipExisting} onChange={(e) => setSkipExisting(e.target.checked)} />
                    Leave out the {clashes} {clashes === 1 ? 'page' : 'pages'} whose title this world already has
                  </label>
                )}
              </>
            )}
            {plan && plan.skipped.length > 0 && (
              <div className="muted" style={{ fontSize: 13 }}>
                {plan.skipped.length} {plan.skipped.length === 1 ? 'file is' : 'files are'} left out. <button className="link-btn" onClick={() => setShowSkipped(!showSkipped)}>{showSkipped ? 'Hide' : 'Show which'}</button>
                {showSkipped && <ul className="import-skipped">{plan.skipped.slice(0, 200).map((s) => <li key={s.path}><b>{s.path}</b>: {s.reason}</li>)}</ul>}
              </div>
            )}
          </>
        )}
        {progress && !result && (
          <div>
            <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>{progress.step}… {progress.done} of {progress.total}</div>
            <div className="import-bar"><div style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} /></div>
          </div>
        )}
        {result && (
          <div>
            <p>Made {result.pages} {result.pages === 1 ? 'page' : 'pages'}{result.pictures ? ` with ${result.pictures} ${result.pictures === 1 ? 'picture' : 'pictures'}` : ''}.{result.skippedExisting ? ` Left out ${result.skippedExisting} that the world already had.` : ''}</p>
            {result.failed.length > 0 && (
              <>
                <p className="error">{result.failed.length} could not be imported:</p>
                <ul className="import-skipped">{result.failed.slice(0, 100).map((f, i) => <li key={i}><b>{f.title}</b>: {f.reason}</li>)}</ul>
              </>
            )}
          </div>
        )}
        {err && <div className="error">{err}</div>}
        <div className="row">
          <span className="grow" />
          {result ? <button className="btn primary" onClick={close}>Close</button> : (
            <>
              <button className="btn" onClick={close} disabled={!!progress}>Cancel</button>
              <button className="btn primary" disabled={!plan?.pages.length || !!progress} onClick={start}>Import</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
