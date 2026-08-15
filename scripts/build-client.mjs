import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'

// esbuild 解析：本地 junction 优先，缺失时用 deepseek-harness 源码树的版本兜底。
const require = createRequire(import.meta.url)
const REPO_ESBUILD = 'C:/Users/19404/hermes-workspace/deepseek-harness/node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild'

let build
try {
  ;({ build } = await import('esbuild'))
} catch {
  ;({ build } = require(REPO_ESBUILD))
}

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
  // 运行时由 shell 的模块加载器提供；zod 内联进 bundle。
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
