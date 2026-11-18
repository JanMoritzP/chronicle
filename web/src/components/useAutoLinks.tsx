import { useEffect, useMemo, type MouseEvent, type ReactNode } from 'react'
import { buildMatcher, splitByHits, type Matcher } from '../lib/autolink'
import { useLibrary } from '../lib/library'
import { useStore } from '../store'

export interface AutoLinks {
  matcher: Matcher
  /** the page of this world that an entry was imported as, if any */
  pageOf: (key: string) => string | undefined
}

/** The library names in a text turn into links. Only for signed in users with the library loaded; shared pages show plain text. */
export function useAutoLinks(): AutoLinks | null {
  const signedIn = useStore((s) => !!s.user)
  const index = useLibrary((s) => s.index)
  const loaded = useLibrary((s) => s.loaded)
  const pages = useStore((s) => s.data.pages)
  useEffect(() => { if (signedIn && !loaded) useLibrary.getState().load().catch(() => {}) }, [signedIn, loaded])
  return useMemo(() => {
    if (!signedIn || !index) return null
    const imported = new Map<string, string>()
    for (const p of pages) if (p.library) imported.set(p.library, p.id)
    return { matcher: buildMatcher(index), pageOf: (k) => imported.get(k) }
  }, [signedIn, index, pages])
}

export type Linker = (text: string, italic: boolean) => ReactNode[]

function AutoLink({ links, entryKey, text, preferPage }: { links: AutoLinks; entryKey: string; text: string; preferPage: boolean }) {
  const page = preferPage ? links.pageOf(entryKey) : undefined
  const open = (e: MouseEvent) => {
    const how = e.ctrlKey || e.metaKey ? { newTab: true } : e.shiftKey ? { split: true } : {}
    const st = useStore.getState()
    if (page) st.navigate({ type: 'page', id: page }, how)
    else st.navigate({ type: 'library', key: entryKey }, how)
  }
  // the hover card reads data-page-id / data-lib-key
  return <button type="button" className="autolink" {...(page ? { 'data-page-id': page } : { 'data-lib-key': entryKey })} onClick={open}>{text}</button>
}

/**
 * A function that turns one piece of text into text and links. It remembers what it has linked, so make one per
 * section or field: the first mention in each is linked, the rest stay plain.
 */
export function makeLinker(links: AutoLinks | null, opts: { selfKey?: string; selfName?: string; preferPage?: boolean } = {}): Linker | undefined {
  if (!links) return undefined
  const seen = new Set<string>()
  return (text, italic) => splitByHits(text, links.matcher.find(text, { italic, seen, selfKey: opts.selfKey, selfName: opts.selfName }))
    .map((p, i) => (typeof p === 'string' ? p : <AutoLink key={i} links={links} entryKey={p.target.key} text={text.slice(p.start, p.end)} preferPage={!!opts.preferPage} />))
}
