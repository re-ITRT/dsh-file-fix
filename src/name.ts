/** 文件名清洗：剥路径前缀 + 去控制字符 + 截断（与官方 displayName 同思路）。 */

export function sanitizeName(name: string): string {
  const leaf = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1)
  const clean = leaf.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255)
  if (clean === '' || clean === '.' || clean === '..') return 'file'
  return clean
}

/** 常见扩展名 → MIME fallback（浏览器 File.type 对未知扩展名返回空串）。 */
const EXT_MIME: Record<string, string> = {
  '.cmd': 'text/x-msdos-batch',
  '.bat': 'text/x-msdos-batch',
  '.sh': 'application/x-sh',
  '.py': 'text/x-python',
  '.c': 'text/x-c',
  '.h': 'text/x-c',
  '.cpp': 'text/x-c++src',
  '.hpp': 'text/x-c++hdr',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.json': 'application/json',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.toml': 'application/toml',
  '.xml': 'application/xml',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.rar': 'application/vnd.rar',
  '.7z': 'application/x-7z-compressed',
  '.exe': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.hex': 'application/octet-stream',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
}

/** 上传 mediaType：浏览器给的优先；空值时按扩展名补 fallback，再兜底 octet-stream。 */
export function mediaTypeOf(request: { mediaType?: string; name: string }): string {
  const given = (request.mediaType ?? '').trim()
  if (given !== '' && given !== 'application/octet-stream') return given
  const dot = request.name.lastIndexOf('.')
  if (dot >= 0) {
    const fallback = EXT_MIME[request.name.slice(dot).toLowerCase()]
    if (fallback !== undefined) return fallback
  }
  return 'application/octet-stream'
}
