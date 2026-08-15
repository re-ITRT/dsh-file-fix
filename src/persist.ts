/** 文件落盘/删除的纯逻辑：文件名清洗、唯一化、node:fs 写删。 */

import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

/** 与官方 attachment displayName 同思路：剥两种分隔符的路径前缀 + 控制字符 + 截断。 */
export function sanitizeName(name: string): string {
  const leaf = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1)
  const clean = leaf.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255)
  if (clean === '' || clean === '.' || clean === '..') return 'file'
  return clean
}

/** 目录内不冲突的文件名：`a.txt` → `a-1.txt`（在扩展名前插入序号）。 */
export async function uniqueName(dir: string, name: string): Promise<string> {
  const dot = name.lastIndexOf('.')
  const base = dot <= 0 ? name : name.slice(0, dot)
  const ext = dot <= 0 ? '' : name.slice(dot)
  let candidate = name
  for (let i = 1; ; i += 1) {
    try {
      // O_EXCL 语义：文件已存在会抛 ENOENT/EEXIST 之外的路径错误，用 stat 判断更直白。
      const { stat } = await import('node:fs/promises')
      await stat(join(dir, candidate))
      candidate = `${base}-${i}${ext}`
    } catch {
      return candidate
    }
  }
}

/** 把 base64 数据写入 `<cwd>/<dirName>/<uniqueName>`，返回相对路径。 */
export async function persistFileBytes(
  cwd: string,
  dirName: string,
  name: string,
  data: string,
): Promise<{ relPath: string; size: number }> {
  const bytes = Buffer.from(data, 'base64')
  const dir = join(cwd, dirName)
  await mkdir(dir, { recursive: true })
  const unique = await uniqueName(dir, sanitizeName(name))
  await writeFile(join(dir, unique), bytes)
  return { relPath: `${dirName}/${unique}`, size: bytes.byteLength }
}

/** 删除工作区内文件。relPath 必须保持在 `<cwd>/<dirName>` 内（防路径逃逸）。 */
export async function removeFileBytes(
  cwd: string,
  dirName: string,
  relPath: string,
): Promise<boolean> {
  const root = resolve(cwd, dirName)
  const target = resolve(cwd, relPath)
  if (target !== root && !target.startsWith(root + sep)) return false
  try {
    await unlink(target)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
