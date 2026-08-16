/** 📎 文件选择按钮：composer 输入行左侧，选择任意类型文件走同一上传管线。 */

import { useRef } from 'react'
import type { ChangeEvent } from 'react'
import { IconPlusOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { UploadLimits } from '../src/types.ts'
import type { UploadRemote } from './remote.ts'
import type { BakedUploadActions } from './store.ts'
import type { LoggerLike } from './upload-controller.ts'
import { intakeFiles } from './upload-controller.ts'
import * as s from './styles.ts'

export interface UploadPickerProps {
  sessionId: string
  actions: BakedUploadActions
  upload: UploadRemote
  getLimits: () => UploadLimits | null
  logger: LoggerLike
}

export function UploadPickerButton(props: UploadPickerProps): React.ReactElement {
  const { sessionId, actions, upload, getLimits, logger } = props
  const inputRef = useRef<HTMLInputElement>(null)

  const onChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) return
    void intakeFiles({ sessionId, remote: upload, actions, getLimits, logger }, files, 'picker')
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
        <IconPlusOutline16 />
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
