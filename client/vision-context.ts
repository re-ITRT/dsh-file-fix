/** client 端视觉上下文缓存：查询当前 session 是否需要视觉（直接图片注入）。
 * host 端通过会话事件实时判定（vision-state.ts），本模块按 sessionId 缓存，
 * 供模型选择组件（置灰无视觉模型）与两层 UI 共用。
 */

import type { UploadRemote } from './remote.ts'

/** 当前 session 的视觉需求状态（true = 需要视觉 / false = 不需要 / null = 未知）。 */
const visionBySession = new Map<string, boolean>()

/** 拉取一个 session 的视觉需求并缓存（幂等；并发去重）。 */
const inflight = new Map<string, Promise<boolean>>()
export function fetchSessionNeedsVision(
  remote: UploadRemote,
  sessionId: string,
): Promise<boolean> {
  const cached = visionBySession.get(sessionId)
  if (cached !== undefined) return Promise.resolve(cached)
  const pending = inflight.get(sessionId)
  if (pending !== undefined) return pending
  const task = remote.getSessionNeedsVision({ sessionId }).then(result => {
    inflight.delete(sessionId)
    const value = result.ok ? result.value.needsVision : false
    visionBySession.set(sessionId, value)
    return value
  }).catch(() => {
    inflight.delete(sessionId)
    return false
  })
  inflight.set(sessionId, task)
  return task
}

/** 本地标记一个 session 需要视觉（图片注入发生时立即置位，不等 host RPC）。 */
export function markLocalSessionNeedsVision(sessionId: string): void {
  visionBySession.set(sessionId, true)
}

/** 读取缓存（不同步 RPC）。 */
export function cachedSessionNeedsVision(sessionId: string): boolean | null {
  return visionBySession.get(sessionId) ?? null
}
