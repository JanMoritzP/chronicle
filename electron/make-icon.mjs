// Renders the web app's icon.svg to build/icon.png (512x512) for electron-builder, which derives .ico and .icns from it.
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(path.join(here, '..', 'server', 'package.json'))
const sharp = require('sharp')
fs.mkdirSync(path.join(here, 'build'), { recursive: true })
await sharp(path.join(here, '..', 'web', 'public', 'icon.svg'), { density: 384 }).resize(512, 512).png().toFile(path.join(here, 'build', 'icon.png'))
console.log('build/icon.png written')
