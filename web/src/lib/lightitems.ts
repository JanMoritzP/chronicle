// Things a character carries that give light, with the light they give (5e, in feet). Matched by name, so "Torch (3)" and "hooded lantern" both count.

export interface ItemLight { bright: number; dim: number; angle?: number }
const LIGHT_ITEMS: { match: RegExp; label: string; light: ItemLight }[] = [
  { match: /bullseye/i, label: 'Bullseye lantern', light: { bright: 60, dim: 120, angle: 60 } },
  { match: /hooded.*lantern|lantern.*hooded/i, label: 'Hooded lantern', light: { bright: 30, dim: 60 } },
  { match: /lantern/i, label: 'Lantern', light: { bright: 30, dim: 60 } },
  { match: /torch/i, label: 'Torch', light: { bright: 20, dim: 40 } },
  { match: /lamp/i, label: 'Lamp', light: { bright: 15, dim: 45 } },
  { match: /candle/i, label: 'Candle', light: { bright: 5, dim: 10 } },
]

/** The light an item gives, or null when it gives none. */
export function lightOf(name: string): { label: string; light: ItemLight } | null {
  const hit = LIGHT_ITEMS.find((x) => x.match.test(name))
  return hit ? { label: hit.label, light: hit.light } : null
}

/** The carried items that give light, one entry each, with the first part of the name as it was written. */
export function lightItems(items: { name: string; qty: number }[] | undefined): { name: string; light: ItemLight }[] {
  return (items ?? []).filter((i) => i.qty > 0 && i.name.trim()).map((i) => ({ name: i.name.trim(), hit: lightOf(i.name) })).filter((x): x is { name: string; hit: NonNullable<ReturnType<typeof lightOf>> } => !!x.hit).map((x) => ({ name: x.name, light: x.hit.light }))
}
