import { build } from 'esbuild'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

const id = 'dsh-upload-ux'
const barePath = 'dist/client.bare.js'
const outPath = 'dist/client.js'

await build({
  entryPoints: ['client/index.tsx'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  jsx: 'automatic',
  target: ['es2022'],
  outfile: barePath,
  // The shell's module loader provides these at runtime (same ids the
  // shipped client plugins require); everything else is bundled.
  external: ['react', 'react/*', '@deepseek-ai/*', 'scheduler'],
  legalComments: 'none',
  logLevel: 'info',
})

const bare = readFileSync(barePath, 'utf8')
const wrapped = 'window.__ModuleLoader__.load({\n' +
  '\tid: ' + JSON.stringify(id) + ',\n' +
  '\tfactory: (require) => {\n' +
  '\t\tvar module = { exports: {} };\n' +
  '\t\tvar exports = module.exports;\n' +
  bare +
  '\n\t\treturn module.exports;\n' +
  '\t}\n' +
  '});\n'
writeFileSync(outPath, wrapped)
unlinkSync(barePath)
console.log('[dsh-upload-ux] client bundle written:', outPath, '(' + wrapped.length + ' bytes)')
