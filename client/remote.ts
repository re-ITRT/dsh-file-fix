/** uploadux 命名空间的客户端 Remote 贡献：zod 严格 codec + 类型合并。 */

import { z } from 'zod'
import type {
  RemoteResult,
  TypertRemoteContribution,
  TypertRemoteNamespace,
} from '@deepseek-ai/dsh-typert-protocol'
import type {
  PersistFileOutcome,
  PersistFileRequest,
  RemoveFileOutcome,
  RemoveFileRequest,
  UploadLimits,
} from '../src/types.ts'

const persistFileRequest$schema = z.object({
  sessionId: z.string(),
  name: z.string(),
  mediaType: z.string(),
  data: z.string(),
}).readonly()

const persistFileOutcome$schema = z.union([
  z.object({ ok: z.literal(true), relPath: z.string(), size: z.number() }).readonly(),
  z.object({ ok: z.literal(false), code: z.string(), detail: z.string().optional() }).readonly(),
]).readonly()

const uploadLimits$schema = z.object({
  maxFileBytes: z.number(),
  maxFilesPerBatch: z.number(),
  maxBatchBytes: z.number(),
}).readonly()

const removeFileRequest$schema = z.object({
  sessionId: z.string(),
  relPath: z.string(),
}).readonly()

const removeFileOutcome$schema = z.union([
  z.object({ ok: z.literal(true), absent: z.boolean() }).readonly(),
  z.object({ ok: z.literal(false), code: z.string(), detail: z.string().optional() }).readonly(),
]).readonly()

export const UPLOAD_TYPERT_REMOTE: TypertRemoteContribution = {
  package: 'dsh-upload-ux',
  descriptors: [
    {
      id: 'dsh-upload-ux#uploadux/persistFile',
      service: 'uploadux',
      namespace: 'uploadux',
      method: 'persistFile',
      invocation: { kind: 'direct' },
      parameters: [{
        name: 'request',
        wire: 'request',
        source: 'json',
        codec: { mode: 'strict', typeSymbol: 'dsh-upload-ux#PersistFileRequest', schema: persistFileRequest$schema },
      }],
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-upload-ux#PersistFileOutcome',
        schema: persistFileOutcome$schema,
      },
    },
    {
      id: 'dsh-upload-ux#uploadux/limits',
      service: 'uploadux',
      namespace: 'uploadux',
      method: 'limits',
      invocation: { kind: 'direct' },
      parameters: [],
      result: { mode: 'strict', typeSymbol: 'dsh-upload-ux#UploadLimits', schema: uploadLimits$schema },
    },
    {
      id: 'dsh-upload-ux#uploadux/removeFile',
      service: 'uploadux',
      namespace: 'uploadux',
      method: 'removeFile',
      invocation: { kind: 'direct' },
      parameters: [{
        name: 'request',
        wire: 'request',
        source: 'json',
        codec: { mode: 'strict', typeSymbol: 'dsh-upload-ux#RemoveFileRequest', schema: removeFileRequest$schema },
      }],
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-upload-ux#RemoveFileOutcome',
        schema: removeFileOutcome$schema,
      },
    },
  ],
}

/** 客户端可用的 uploadux 命名空间完整类型（组件与管线共用）。 */
export type UploadRemote = TypertRemoteNamespace<'uploadux'>

/** 客户端类型合并：让 ctx.remote.uploadux.<method> 全程有类型。 */
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$uploadux {
    persistFile: (request: PersistFileRequest) => Promise<RemoteResult<PersistFileOutcome>>
    limits: () => Promise<RemoteResult<UploadLimits>>
    removeFile: (request: RemoveFileRequest) => Promise<RemoteResult<RemoveFileOutcome>>
  }

  interface TypertRemoteMap {
    'uploadux/persistFile': (request: PersistFileRequest) => Promise<RemoteResult<PersistFileOutcome>>
    'uploadux/limits': () => Promise<RemoteResult<UploadLimits>>
    'uploadux/removeFile': (request: RemoveFileRequest) => Promise<RemoteResult<RemoveFileOutcome>>
  }

  interface TypertRemoteNamespaceMap {
    uploadux: TypertRemoteNamespace$uploadux
  }
}
