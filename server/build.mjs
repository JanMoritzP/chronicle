import { build } from 'esbuild'
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
})
