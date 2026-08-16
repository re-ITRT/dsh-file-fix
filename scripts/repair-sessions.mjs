/** 修复被 system 消息污染的会话日志：
 * pre-step 注入的 role=system 消息随 user/message 批次落盘，
 * 重载校验（message must have role "user"）导致历史不可用。
 * 此脚本按帧解压 zstd 容器 → 过滤批次中的 system 消息 → 重压缩覆盖。
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { scanZstdFrames, decompressZstdFrame, compressZstdFrame } from
  'file:///C:/Users/19404/hermes-workspace/deepseek-harness/packages/session/session-persistence-jsonl/src/zstd.ts'

const SESSIONS_ROOT = 'C:/Users/19404/.dsh/sessions'

function repairEvents(text) {
  const lines = text.split('\n')
  const out = []
  let fixed = 0
  for (const line of lines) {
    if (line.trim() === '') continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      out.push(line) // 保底：原样保留
      continue
    }
    if (event.type === 'user/message') {
      const data = event.data
      if (Array.isArray(data)) {
        const kept = data.filter(m => m && m.role !== 'system')
        if (kept.length !== data.length) {
          event.data = kept
          fixed += 1
        }
      } else if (data && typeof data === 'object' && data.role === 'system') {
        // system 消息被存成独立 user/message 事件：改 role 保住 seq 与 surface 引用。
        data.role = 'user'
        fixed += 1
      }
    }
    out.push(JSON.stringify(event))
  }
  return { text: out.join('\n') + '\n', fixed }
}

async function repairFile(file) {
  const raw = readFileSync(file)
  let text = ''
  const scan = scanZstdFrames(raw)
  for (const frame of scan.frames) {
    const buf = raw.subarray(frame.start, frame.end)
    text += (await decompressZstdFrame(buf)).toString('utf8')
  }
  const { text: repaired, fixed } = repairEvents(text)
  // 容器格式：首帧恰好一行 header，其余事件行放后续帧（批）。
  // 无条件重写：修复之前单帧损坏的产物，也统一帧结构。
  const lines = repaired.split('\n')
  const headerLine = lines.findIndex(l => l.trim() !== '')
  const header = lines[headerLine] + '\n'
  const rest = lines.slice(headerLine + 1).join('\n') + '\n'
  const frame1 = await compressZstdFrame(Buffer.from(header, 'utf8'))
  const frame2 = await compressZstdFrame(Buffer.from(rest, 'utf8'))
  writeFileSync(file, Buffer.concat([frame1, frame2]))
  console.log(fixed > 0 ? '已修复:' : '已重写:', file, fixed > 0 ? `清理 system 消息: ${fixed}` : '无污染')
}

const workspaces = readdirSync(SESSIONS_ROOT).filter(w => statSync(join(SESSIONS_ROOT, w)).isDirectory())
for (const ws of workspaces) {
  const wsDir = join(SESSIONS_ROOT, ws)
  let sessions
  try {
    sessions = readdirSync(wsDir)
  } catch {
    continue
  }
  for (const sid of sessions) {
    const file = join(wsDir, sid, 'session.jsonl.zstd')
    try {
      if (statSync(file).isFile()) await repairFile(file)
    } catch { /* 跳过损坏/缺失 */ }
  }
}
console.log('修复完成')
