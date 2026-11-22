// An invite as an e-mail the person's own mail program opens, ready to send: no mail server is involved, and nothing leaves this browser until they send it.

/** The `mailto:` address for an invite link: a subject, and a few friendly lines with the link in them. */
export function inviteMail(world: string, link: string, role: 'editor' | 'viewer'): string {
  const subject = `Join ${world} on Chronicle`
  const body = `You are invited to ${world} as ${role === 'editor' ? 'a player' : 'a spectator'}.\n\nOpen this link to join:\n${link}\n`
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
