import { ExternalLink } from 'lucide-react'
import { Fragment, useMemo } from 'react'
import { StatBlockBody, richText } from '../editor/StatBlock'
import { templateById } from '../editor/templates'
import { useLibrary } from '../lib/library'
import { entryText, statBlockFor, textBlocks } from '../lib/open5e'
import type { LibraryEntry } from '../types'
import { makeLinker, useAutoLinks, type Linker } from './useAutoLinks'

function Markdownish({ text, lk }: { text: string; lk?: Linker }) {
  return (
    <>
      {textBlocks(text).map((b, i) => {
        if (b.kind === 'ul') return <ul key={i}>{b.items.map((t, k) => <li key={k}>{richText(t, lk)}</li>)}</ul>
        if (b.kind === 'p') return <p key={i}>{richText(b.text, lk)}</p>
        return (
          <div key={i} className="lib-table">
            <table>
              {b.head && <thead><tr>{b.head.map((c, k) => <th key={k}>{richText(c)}</th>)}</tr></thead>}
              <tbody>{b.rows.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{richText(c, lk)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        )
      })}
    </>
  )
}

/** A library entry as a read-only page. Used in the Library view and on public shared pages. */
export function EntryBody({ entry }: { entry: LibraryEntry }) {
  const index = useLibrary((s) => s.index)
  const links = useAutoLinks()
  const t = useMemo(() => entryText(entry), [entry])
  const sb = useMemo(() => statBlockFor(entry, index), [entry, index])
  const template = sb ? templateById(sb.template) : undefined
  // the names of other entries in the text link to them: once per section, never to the entry itself
  const self = { selfKey: entry.key, selfName: entry.name }
  const factLinker = makeLinker(links, self)
  return (
    <>
      {sb && template ? <StatBlockBody template={template} data={sb.data} libraryLinks /> : (
        <>
          {t.subtitle && <p className="muted"><i>{t.subtitle}</i></p>}
          {t.facts.length > 0 && <dl className="lib-facts">{t.facts.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{richText(v, factLinker)}</dd></Fragment>)}</dl>}
          {t.sections.map((s, i) => <section key={i}>{s.heading && <h3>{s.heading}</h3>}<Markdownish text={s.text} lk={makeLinker(links, self)} /></section>)}
        </>
      )}
      <p className="muted lib-credit">
        Source: {entry.sourceName}{entry.license ? `. ${entry.license}.` : ''}{' '}
        {entry.permalink && <a href={entry.permalink} target="_blank" rel="noreferrer noopener" title="Open the source">Open source <ExternalLink size={12} /></a>}
      </p>
    </>
  )
}

/** The card shown when the mouse rests on a link to an entry: the stat block for creatures, spells and items, else the facts and the start of the text. */
export function EntryPreview({ entry }: { entry: LibraryEntry }) {
  const index = useLibrary((s) => s.index)
  const t = useMemo(() => entryText(entry), [entry])
  const sb = useMemo(() => statBlockFor(entry, index), [entry, index])
  const template = sb ? templateById(sb.template) : undefined
  const excerpt = useMemo(() => {
    const blocks = textBlocks(t.sections.map((s) => s.text).join('\n\n')).filter((b) => b.kind !== 'table')
    const out: typeof blocks = []
    let chars = 0
    for (const b of blocks) {
      if (chars > 450) return { blocks: out, more: true }
      out.push(b)
      chars += b.kind === 'p' ? b.text.length : b.kind === 'ul' ? b.items.join('').length : 0
    }
    return { blocks: out, more: false }
  }, [t])
  return (
    <>
      {sb && template ? <StatBlockBody template={template} data={sb.data} libraryLinks /> : (
        <>
          <h4>{entry.name}</h4>
          {t.subtitle && <div className="muted"><i>{t.subtitle}</i></div>}
          {t.facts.length > 0 && <dl className="lib-facts">{t.facts.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>}
          {excerpt.blocks.map((b, i) => (b.kind === 'ul'
            ? <ul key={i}>{b.items.map((x, k) => <li key={k}>{richText(x)}</li>)}</ul>
            : b.kind === 'p' ? <p key={i}>{richText(b.text)}</p> : null))}
          {excerpt.more && <div className="muted">…</div>}
        </>
      )}
      <div className="muted lib-credit">{entry.sourceName}</div>
    </>
  )
}
