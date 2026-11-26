// Class features, species traits and background benefits are not library entries of their own: each is a part of the entry of the
// class, species or background that gives it. These read which names an entry gives, so a feature on a sheet can lead there.

const norm = (s: string) => s.toLowerCase().replace(/’/g, "'").replace(/\s+/g, ' ').trim()
/** "Extra Attack (level 5, 11)", the heading of an imported class, is the feature "Extra Attack". */
export const sectionKey = (heading: string) => norm(heading.replace(/\s*\(levels?\s+[\d,\s]+\)\s*$/i, ''))

const names = (list: unknown): string[] => (Array.isArray(list) ? list.map((x: any) => String(x?.name ?? '').trim()).filter(Boolean) : [])
const textOf = (n: any): string => (typeof n?.text === 'string' ? n.text : Array.isArray(n?.content) ? n.content.map(textOf).join('') : '')

/** The headings of a page or of the text of a homebrew entry. */
export const headingNames = (doc: any): string[] => (Array.isArray(doc?.content) ? doc.content : []).filter((n: any) => n?.type === 'heading').map((n: any) => textOf(n).trim()).filter(Boolean)

/** The features of character builder rules (a class has features, a species traits). */
export const ruleNames = (rules: any): string[] => [...names(rules?.features), ...names(rules?.traits)]

/** What a library entry gives: from Open5e or from a homebrew library. */
export function entryFeatureNames(data: any): string[] {
  const features = Array.isArray(data?.features) ? data.features.filter((f: any) => f?.feature_type === 'CLASS_LEVEL_FEATURE' || f?.feature_type === 'CLASS_FEATURE_OPTION_LIST') : []
  return [...names(features), ...names(data?.traits), ...names(data?.benefits), ...ruleNames(data?.rules), ...headingNames(data?.content)]
}

/** The feature a name on a sheet means: as written, without a trailing "(…)", or the part before a colon ("Fighting Style: Defense"). */
export function matchFeature<T>(features: Map<string, T>, name: string): { found: T; section: string } | null {
  const n = norm(name)
  for (const section of [n, n.replace(/\s*\(.*\)$/, ''), n.split(':')[0].trim()]) {
    const found = features.get(section)
    if (found !== undefined) return { found, section }
  }
  return null
}
