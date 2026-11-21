// The time of day at the table, as how dark it is: dark at night, a steady fade at dawn and dusk, none in daylight. Pure.

const NIGHT = 0.85
const BY_HOUR = [NIGHT, NIGHT, NIGHT, NIGHT, NIGHT, 0.55, 0.3, 0.1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.3, 0.55, NIGHT, NIGHT, NIGHT]

/** How dark it is at an hour of the day (0 to 23), from 0 (daylight) to 0.85 (night). Anything else counts as noon. */
export const darknessAt = (hour: number) => BY_HOUR[Math.floor(hour)] ?? 0

/** A name for the hour, for the person setting it. */
export function partOfDay(hour: number): string {
  const h = Math.floor(hour)
  return h >= 22 || h < 4 ? 'Night' : h < 7 ? 'Dawn' : h < 11 ? 'Morning' : h < 14 ? 'Midday' : h < 18 ? 'Afternoon' : h < 21 ? 'Dusk' : 'Evening'
}
