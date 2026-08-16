/** host 调试日志：dsh 日志系统吞 console，写文件绝对可见。 */
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'

const LOG = join('C:/Users/19404/.dsh', 'uploadux-debug.log')

export function debugLog(...args: unknown[]): void {
  const line = `${new Date().toISOString()} ${args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`
  try {
    appendFileSync(LOG, line + '\n')
  } catch {
    /* ignore */
  }
}
