import { ExternalLink } from 'lucide-react'
import { Fragment, useMemo } from 'react'
import { StatBlockBody, richText } from '../editor/StatBlock'
import { templateById } from '../editor/templates'
import { creatureToStatBlock, entryText } from '../lib/open5e'
import type { LibraryEntry } from '../types'

function Markdownish({ text }: { text: string }) {
  const lines = text.split('\n')
  const out: React.ReactNode[] = []
  for (let i = 0; i < lines.length;) {
    if (lines[i].startsWith('* ')) {
      const items: string[] = []
      while (i < lines.length && lines[i].startsWith('* ')) items.push(lines[i++].slice(2))
      out.push(<ul key={i}>{items.map((t, k) => <li key={k}>{richText(t)}</li>)}</ul>)
    } else {
      if (lines[i].trim()) out.push(<p key={i}>{richText(lines[i])}</p>)
      i++
    }
  }
  return <>{out}</>
}

/** A library entry as a read-only page. Used in the Library view and on public shared pages. */
export function EntryBody({ entry }: { entry: LibraryEntry }) {
  const t = useMemo(() => entryText(entry), [entry])
  const sb = useMemo(() => (entry.category === 'creature' ? creatureToStatBlock(entry) : null), [entry])
  const template = sb ? templateById(sb.template) : undefined
  return (
    <>
      {sb && template ? <StatBlockBody template={template} data={sb.data} /> : (
        <>
          {t.subtitle && <p className="muted"><i>{t.subtitle}</i></p>}
          {t.facts.length > 0 && <dl className="lib-facts">{t.facts.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>}
          {t.sections.map((s, i) => <section key={i}>{s.heading && <h3>{s.heading}</h3>}<Markdownish text={s.text} /></section>)}
        </>
      )}
      <p className="muted lib-credit">
        Source: {entry.sourceName}{entry.license ? `. ${entry.license}.` : ''}{' '}
        {entry.permalink && <a href={entry.permalink} target="_blank" rel="noreferrer noopener" title="Open the source">Open source <ExternalLink size={12} /></a>}
      </p>
    </>
  )
}
