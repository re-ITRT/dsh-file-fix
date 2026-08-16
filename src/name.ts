/** 文件名清洗：剥路径前缀 + 去控制字符 + 截断（与官方 displayName 同思路）。 */

export function sanitizeName(name: string): string {
  const leaf = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1)
  const clean = leaf.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255)
  if (clean === '' || clean === '.' || clean === '..') return 'file'
  return clean
}
