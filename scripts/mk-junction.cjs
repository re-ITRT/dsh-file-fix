// 通用 junction 工具：node_modules 链接或 profile 内插件包链接。
// 用法: node scripts/mk-junction.cjs <linkPath> <targetPath>
const { execSync } = require('child_process')
const fs = require('fs')

const [, , linkPath, targetPath] = process.argv
if (!linkPath || !targetPath) {
  console.error('usage: node mk-junction.cjs <linkPath> <targetPath>')
  process.exit(1)
}

const abs = require('path').resolve(linkPath)
try {
  fs.lstatSync(abs)
  fs.rmSync(abs, { recursive: true, force: true })
  console.log(`removed existing: ${abs}`)
} catch {
  /* not present */
}
fs.mkdirSync(require('path').dirname(abs), { recursive: true })
try {
  const out = execSync(`mklink /J "${abs}" "${targetPath}"`, { stdio: 'pipe' })
  console.log('junction OK:', out.toString().trim())
} catch (e) {
  console.error('junction ERR:', (e.stdout || '').toString(), (e.stderr || '').toString(), e.message)
  process.exit(1)
}
