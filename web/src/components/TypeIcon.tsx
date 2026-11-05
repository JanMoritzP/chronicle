import {
  Anchor, Axe, Book, Castle, Crown, Feather, FileText, Flame, Gem, Ghost, Home, Landmark, Leaf, Map as MapIcon, MapPin, Moon, Mountain,
  Scroll, Shapes, Shield, Skull, Sparkles, Star, Sword, Swords, TreePine, User, Users, WandSparkles, type LucideIcon,
} from 'lucide-react'
import { useStore } from '../store'
import { resolveTypes, typeOf } from '../lib/pageTypes'
import type { PageMeta } from '../types'
import { useMemo } from 'react'

// Curated set so the bundle stays small. Custom page types pick one of these by name.
export const TYPE_ICONS: Record<string, LucideIcon> = {
  'file-text': FileText, user: User, users: Users, skull: Skull, 'map-pin': MapPin, shapes: Shapes, sparkles: Sparkles, castle: Castle,
  crown: Crown, sword: Sword, swords: Swords, shield: Shield, axe: Axe, 'wand-sparkles': WandSparkles, ghost: Ghost, flame: Flame, gem: Gem,
  book: Book, scroll: Scroll, feather: Feather, mountain: Mountain, 'tree-pine': TreePine, leaf: Leaf, anchor: Anchor, home: Home,
  landmark: Landmark, map: MapIcon, moon: Moon, star: Star,
}

export function TypeIcon({ name, size = 14, className }: { name: string; size?: number; className?: string }) {
  const I = TYPE_ICONS[name] ?? FileText
  return <I size={size} className={className} />
}

export function useTypes() {
  const custom = useStore((s) => s.data.pageTypes)
  return useMemo(() => resolveTypes(custom), [custom])
}

/** Icon shown next to a page: its emoji if it has one, else its type icon, else the plain document icon. */
export function PageIcon({ page, size = 14 }: { page: Pick<PageMeta, 'icon' | 'type'>; size?: number }) {
  const types = useTypes()
  if (page.icon) return <span>{page.icon}</span>
  const t = typeOf(types, page)
  return <TypeIcon name={t?.icon ?? 'file-text'} size={size} className={t ? undefined : 'muted'} />
}
