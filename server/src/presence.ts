/**
 * Tells the admin dashboard that who is online, or who is editing what, has changed.
 * A page load opens several connections at once, so a burst of changes becomes one notice.
 */
const listeners = new Set<() => void>()
let timer: NodeJS.Timeout | undefined

export function presenceChanged() {
  if (timer) return
  timer = setTimeout(() => {
    timer = undefined
    for (const l of listeners) l()
  }, 200)
}

export function onPresenceChange(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
