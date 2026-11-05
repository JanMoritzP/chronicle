export interface PageMeta {
  id: string
  folderId: string | null
  title: string
  icon: string | null
  aliases: string[]
  tags: string[]
  outline: { id: string; level: number; text: string }[]
  text: string
  hasStats: boolean
  portrait: string | null
  /** id of a page type (built-in key or custom page type id) */
  type?: string | null
  wordCount: number
  createdAt: number
  updatedAt: number
  /** open (not done) todo markers on the page */
  todos?: number
}
export interface TodoItem {
  pageId: string; id: string; message: string; done: boolean; context: string
  createdAt: number; doneAt: number | null; pageTitle: string; pageIcon: string | null
}
export interface Folder { id: string; parentId: string | null; name: string; sort: number }
export interface LinkRow { sourceId: string; targetId: string | null; targetName: string; anchor: string | null; embed: number }
export interface Zettel { id: string; body: string; tags: string[]; createdAt: number; pageId: string | null; processedAt: number | null }
export interface Workspace { id: string; name: string }
export interface User { id: string; username: string; role: 'owner' | 'editor' | 'viewer' }
export interface FullPage extends PageMeta { content: any; props: Record<string, any> }
export type Pt = [number, number]
export type Geometry = Pt | Pt[]
export interface Keyframe { t: number; geometry?: Geometry; hidden?: boolean }
export interface Waypoint { arrive: number | null; depart: number | null }
export interface Journey { mode: string; waypoints: Waypoint[] }
export interface MapMeta {
  id: string; workspaceId: string; parentMapId: string | null; name: string; width: number | null; height: number | null
  maxZoom: number | null; status: 'processing' | 'ready' | 'error'; error: string | null; scale: number | null; createdAt: number
}
export interface MapLayer { id: string; name: string; sort: number; visible: boolean }
export interface MapItem {
  id: string; mapId: string; layerId: string | null; kind: 'point' | 'line' | 'polygon'; title: string; geometry: Geometry
  pageId: string | null; targetMapId: string | null; style: { color?: string; glide?: boolean; [k: string]: any }
  timeMode: 'static' | 'timed' | 'journey'; keyframes: Keyframe[]; journey: Journey | null
}
export interface MapFull extends MapMeta { layers: MapLayer[]; items: MapItem[] }
export interface CopyPreview { pages: { id: string; title: string; exists: boolean }[]; linked: { id: string; title: string; mentions: number; exists: boolean }[]; alreadyUnresolved: number }
export interface CopyResult { workspaceId: string; pages: { from: string; to: string; title: string; renamed: boolean }[]; ghostLinks: number; unresolvedNames: number; images: number }
export interface SessionStats { pagesCreated: number; wordsWritten: number; pagesTouched: number }
export interface GameSession {
  id: string; number: number; title: string; playedOn: string; tStart: number | null; tEnd: number | null
  pageId: string | null; pageTitle: string | null; stats: SessionStats
}
export interface StatsResult {
  totals: SessionStats
  daily: { day: string; words: number; pages: number }[]
  top: { pageId: string; title: string; words: number }[]
  world: { pages: number; words: number }
}
export interface Relation { id: string; sourceId: string; targetId: string; kind: 'parent' | 'spouse' | 'sibling' | 'other'; label: string }
export interface EventRow { id: string; pageId: string | null; title: string; tStart: number; tEnd: number | null }
export interface Template { id: string; name: string; slug: string; description: string; content: any; updatedAt: number }
export interface PageType { id: string; name: string; icon: string; tag: string; source: string; definition: Record<string, any>; updatedAt: number }
export interface StatTemplateRow { id: string; name: string; sections: any[]; updatedAt: number }
export interface Bootstrap { pages: PageMeta[]; folders: Folder[]; links: LinkRow[]; zettels: Zettel[]; templates?: Template[]; pageTypes?: PageType[]; statTemplates?: StatTemplateRow[] }

export interface BackupInfo { name: string; size: number; createdAt: number; kind: 'daily' | 'pre-restore' | 'other' }
