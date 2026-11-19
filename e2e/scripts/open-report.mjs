import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'report', 'features.html')
const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', file]] : process.platform === 'darwin' ? ['open', [file]] : ['xdg-open', [file]]
spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref()
console.log(`Opened ${file}`)
