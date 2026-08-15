/** upload 命名空间的客户端 Remote 贡献：zod 严格 codec + 类型合并。 */

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
      id: 'dsh-upload-ux#upload/persistFile',
      service: 'upload',
      namespace: 'upload',
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
      id: 'dsh-upload-ux#upload/limits',
      service: 'upload',
      namespace: 'upload',
      method: 'limits',
      invocation: { kind: 'direct' },
      parameters: [],
      result: { mode: 'strict', typeSymbol: 'dsh-upload-ux#UploadLimits', schema: uploadLimits$schema },
    },
    {
      id: 'dsh-upload-ux#upload/remove',
      service: 'upload',
      namespace: 'upload',
      method: 'remove',
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

/** 客户端可用的 upload 命名空间完整类型（组件与管线共用）。 */
export type UploadRemote = TypertRemoteNamespace<'upload'>

/** 客户端类型合并：让 ctx.remote.upload.<method> 全程有类型。 */
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$upload {
    persistFile: (request: PersistFileRequest) => Promise<RemoteResult<PersistFileOutcome>>
    limits: () => Promise<RemoteResult<UploadLimits>>
    remove: (request: RemoveFileRequest) => Promise<RemoteResult<RemoveFileOutcome>>
  }

  interface TypertRemoteMap {
    'upload/persistFile': (request: PersistFileRequest) => Promise<RemoteResult<PersistFileOutcome>>
    'upload/limits': () => Promise<RemoteResult<UploadLimits>>
    'upload/remove': (request: RemoveFileRequest) => Promise<RemoteResult<RemoveFileOutcome>>
  }

  interface TypertRemoteNamespaceMap {
    upload: TypertRemoteNamespace$upload
  }
}
