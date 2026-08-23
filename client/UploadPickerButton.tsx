/** 📎 文件选择按钮：composer 输入行左侧，选择任意类型文件走插件文件层。 */

import { useRef } from 'react'
import type { ChangeEvent } from 'react'
import { IconPaperclipOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LoggerLike } from './upload-controller.ts'
import { getTwoLayerHandle } from './two-layer-bridge.ts'
import * as s from './styles.ts'

/** 模块级注入面（slot 无自定义 inject）。 */
let pickerUpload: { upload: import('./remote.ts').UploadRemote; getLimits: () => import('../src/types.ts').UploadLimits | null; logger: LoggerLike } | null = null
export function setPickerShare(share: typeof pickerUpload): void {
  pickerUpload = share
}
function getPickerShare(): typeof pickerUpload {
  return pickerUpload
}

export interface UploadPickerProps {
  sessionId: string
}

export function UploadPickerButton(props: UploadPickerProps): React.ReactElement {
  const { sessionId } = props
  const inputRef = useRef<HTMLInputElement>(null)

  const onChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) return
    // 统一走两层 handle：文件进文件层（本地 state）。
    const handle = getTwoLayerHandle()
    if (handle !== null) handle.handleFiles(files, 'picker')
  }

  return (
    <>
      <button
        type="button"
        style={s.picker}
        aria-label="上传文件"
        title="上传文件"
        onClick={() => inputRef.current?.click()}
      >
        <IconPaperclipOutline16 />
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        style={s.hiddenInput}
        onChange={onChange}
      />
    </>
  )
}