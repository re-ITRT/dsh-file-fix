/** 图片缩略图降采样：串行队列（照 Hermes 的 downscaleDataUrlForPreview 思路）。 */

let queue: Promise<unknown> = Promise.resolve()

function makeThumbnail(dataUrl: string, maxDim: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      try {
        const scale = Math.min(1, maxDim / Math.max(image.naturalWidth, image.naturalHeight))
        const width = Math.max(1, Math.round(image.naturalWidth * scale))
        const height = Math.max(1, Math.round(image.naturalHeight * scale))
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        if (context === null) {
          resolve('')
          return
        }
        context.drawImage(image, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', 0.8))
      } catch {
        resolve('')
      }
    }
    image.onerror = () => reject(new Error('thumbnail decode failed'))
    image.src = dataUrl
  })
}

/** 串行降采样；失败返回空串（缩略图缺失不阻塞上传）。 */
export function downscaleThumbnail(dataUrl: string, maxDim = 96): Promise<string> {
  const task = queue.then(
    () => makeThumbnail(dataUrl, maxDim).catch(() => ''),
    () => makeThumbnail(dataUrl, maxDim).catch(() => ''),
  )
  queue = task.then(
    () => undefined,
    () => undefined,
  )
  return task
}

/** 可读大小：B / KB / MB。 */
export function humanSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}
