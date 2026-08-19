/** 验证 cleanup.ts 的 GC 决策逻辑（对 store 打 stub，不依赖 Cordis Service/磁盘）。 */
import { runCleanup, setSessionLister, writeCleanupConfig, cleanupConfigPath } from '../lib/cleanup.js'
import { unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const cfgPath = cleanupConfigPath()
try { unlinkSync(cfgPath) } catch {}

const AGE = 3600 * 1000 // ms/hour
const DAY = 24 * AGE

// ---- stub store ----
function makeStore({ createdAtMap = {}, bytesMap = {}, assocRecords = [], refOverride = null } = {}) {
  const blobs = Object.entries(createdAtMap).map(([id, createdAt]) => ({
    attachmentId: id,
    name: `f-${id}.txt`,
    mediaType: 'text/plain',
    size: bytesMap[id] ?? 1000,
    createdAt,
  }))
  let calls = { deleteBlobs: [], rewriteAssociations: 0 }
  return {
    calls,
    list: async () => blobs,
    hasBytes: async id => bytesMap[id] !== undefined,
    deleteBlobs: async ids => { calls.deleteBlobs.push([...ids]); return ids.length },
    rewriteAssociations: async () => { calls.rewriteAssociations += 1 },
    loadAssociationRecords: async () => assocRecords,
    totalBytes: async () => blobs.reduce((s, b) => s + (bytesMap[b.attachmentId] ?? 0), 0),
  }
}

let failures = 0
function check(name, cond, detail = '') {
  if (cond) { console.log(`  PASS ${name}`) } else { failures++; console.log(`  FAIL ${name} ${detail}`) }
}

// ---- 1. 会话级联：会话已删除（不在活会话列表）→ 记录重写 + 独有字节删除 ----
{
  console.log('[1] 会话级联 (2联动)')
  const assocRecords = [
    { messageId: 'm1', sessionId: 's-gone', seq: 1, files: [{ attachmentId: 'aaa', name: 'a', mediaType: 'application/octet-stream', size: 10 }] },
    { messageId: 'm2', sessionId: 's-live', seq: 2, files: [{ attachmentId: 'bbb', name: 'b', mediaType: 'application/octet-stream', size: 10 }] },
  ]
  const store = makeStore({
    createdAtMap: { aaa: Date.now(), bbb: Date.now() },
    bytesMap: { aaa: 10, bbb: 10 },
    assocRecords,
  })
  setSessionLister(async () => [{ id: 's-live' }])
  writeCleanupConfig({ enabled: true, maxAgeDays: 0, maxCacheBytes: 0 })
  const r = await runCleanup(store)
  console.log('  result:', JSON.stringify(r))
  check('会话级联重写关联记录', store.calls.rewriteAssociations === 1)
  check('会话级联删除独有字节 aaa', store.calls.deleteBlobs.length === 1 && store.calls.deleteBlobs[0].includes('aaa'))
  check('活会话共享字节保留', !(store.calls.deleteBlobs.flat().includes('bbb')))
}

// ---- 2. 老化：超过 maxAgeDays 未访问的字节被清理 ----
{
  console.log('[2] 老化清理 (3联动)')
  const assocRecords = [
    { messageId: 'm1', sessionId: 's-live', seq: 1, files: [{ attachmentId: 'old', name: 'old', mediaType: 'application/octet-stream', size: 10 }] },
  ]
  const store = makeStore({
    createdAtMap: { old: Date.now() - 40 * DAY, fresh: Date.now() - 10 * DAY },
    bytesMap: { old: 10, fresh: 10 },
    assocRecords,
  })
  setSessionLister(async () => [{ id: 's-live' }])
  writeCleanupConfig({ enabled: true, maxAgeDays: 30, maxCacheBytes: 0 })
  const r = await runCleanup(store)
  console.log('  result:', JSON.stringify(r))
  check('老化字节 old 被清理', store.calls.deleteBlobs.flat().includes('old'))
}

// ---- 3. 容量超限：LRU 删最久未访问（所有对象都被引用，排除孤儿干扰） ----
{
  console.log('[3] 容量清理 (3联动 LRU)')
  const assocRecords = [
    { messageId: 'm1', sessionId: 's-live', seq: 1, files: [
      { attachmentId: 'oldcap', name: 'oldcap', mediaType: 'application/octet-stream', size: 100 },
      { attachmentId: 'midcap', name: 'midcap', mediaType: 'application/octet-stream', size: 100 },
      { attachmentId: 'newcap', name: 'newcap', mediaType: 'application/octet-stream', size: 100 },
    ] },
  ]
  const store = makeStore({
    createdAtMap: { oldcap: Date.now() - 20 * DAY, midcap: Date.now() - 10 * DAY, newcap: Date.now() - DAY },
    bytesMap: { oldcap: 100, midcap: 100, newcap: 100 },
    assocRecords,
  })
  setSessionLister(async () => [{ id: 's-live' }])
  writeCleanupConfig({ enabled: true, maxAgeDays: 0, maxCacheBytes: 150 })
  const r = await runCleanup(store)
  console.log('  result:', JSON.stringify(r))
  const deleted = store.calls.deleteBlobs.flat()
  check('移除最旧 oldcap', deleted.includes('oldcap'))
  check('超限仍超时删除 midcap 但新 newcap 保留', deleted.includes('midcap') && !deleted.includes('newcap'))
}

// ---- 4. enabled=false 直接跳过 ----
{
  console.log('[4] 关闭自动清理')
  const store = makeStore({ createdAtMap: { x: Date.now() }, bytesMap: { x: 10 }, assocRecords: [] })
  setSessionLister(async () => [])
  writeCleanupConfig({ enabled: false, maxAgeDays: 30, maxCacheBytes: 0 })
  const r = await runCleanup(store)
  console.log('  result:', JSON.stringify(r))
  check('skipped=true 且不动文件', r.skipped === true && store.calls.deleteBlobs.length === 0)
}

try { unlinkSync(cfgPath) } catch {}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
