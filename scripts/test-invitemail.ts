import { inviteMail } from '../web/src/lib/inviteMail'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

const url = inviteMail('The Hollow Crown', 'https://table.example/join/abc123', 'editor')
check('it is a mailto address with no one in it yet', url.startsWith('mailto:?subject='))
const params = new URLSearchParams(url.slice('mailto:?'.length))
check('the subject names the world', params.get('subject') === 'Join The Hollow Crown on Chronicle')
check('the message holds the link and says what the person is', (params.get('body') ?? '').includes('https://table.example/join/abc123') && (params.get('body') ?? '').includes('as a player'))
check('a spectator is called one', (new URLSearchParams(inviteMail('W', 'https://x/j/1', 'viewer').slice(8)).get('body') ?? '').includes('as a spectator'))
check('odd characters in the name are encoded', !inviteMail('Dragons & "Dungeons"', 'https://x/j/1', 'editor').includes(' ') && new URLSearchParams(inviteMail('Dragons & "Dungeons"', 'https://x/j/1', 'editor').slice(8)).get('subject') === 'Join Dragons & "Dungeons" on Chronicle')

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
