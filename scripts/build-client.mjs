import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

// esbuild 解析：本地 devDep 优先，缺失时用全局 esbuild 兜底。
const require = createRequire(import.meta.url)

async function resolveBuild() {
  try {
    // 本地 esbuild（devDependencies）优先。
    return (await import('esbuild')).build
  } catch {
    // 兜底：全局 npm 安装的 esbuild（npm root -g）。
    const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()
    try {
      return require(require.resolve('esbuild', { paths: [globalRoot] })).build
    } catch {
      throw new Error('[dsh-file-fix] esbuild not found — run `npm install` (local devDep) or `npm install -g esbuild` (fallback)')
    }
  }
}

const build = await resolveBuild()

const id = 'dsh-file-fix'
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
console.log('[dsh-file-fix] client bundle written:', outPath, '(' + wrapped.length + ' bytes)')
