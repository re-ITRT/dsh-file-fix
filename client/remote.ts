/** uploadux 命名空间的客户端 Remote 贡献：zod 严格 codec + 类型合并。 */

import { z } from 'zod'
import type {
  RemoteResult,
  TypertRemoteContribution,
  TypertRemoteNamespace,
} from '@deepseek-ai/dsh-typert-protocol'
import type {
  FilesAttachedEntry,
  MarkPendingOutcome,
  MarkPendingRequest,
  PersistFileOutcome,
  PersistFileRequest,
  RemoveFileOutcome,
  RemoveFileRequest,
  UnmarkPendingOutcome,
  UnmarkPendingRequest,
  UploadLimits,
} from '../src/types.ts'

const uploadedFile$schema = z.object({
  attachmentId: z.string(),
  name: z.string(),
  mediaType: z.string(),
  size: z.number(),
}).readonly()

const persistFileRequest$schema = z.object({
  sessionId: z.string(),
  name: z.string(),
  mediaType: z.string(),
  data: z.string(),
}).readonly()

const persistFileOutcome$schema = z.union([
  z.object({ ok: z.literal(true), file: uploadedFile$schema }).readonly(),
  z.object({ ok: z.literal(false), code: z.string(), detail: z.string().optional() }).readonly(),
]).readonly()

const uploadLimits$schema = z.object({
  maxFileBytes: z.number(),
  maxFilesPerBatch: z.number(),
  maxBatchBytes: z.number(),
}).readonly()

const removeFileRequest$schema = z.object({
  sessionId: z.string(),
  attachmentId: z.string(),
}).readonly()

const removeFileOutcome$schema = z.union([
  z.object({ ok: z.literal(true), absent: z.boolean() }).readonly(),
  z.object({ ok: z.literal(false), code: z.string(), detail: z.string().optional() }).readonly(),
]).readonly()

const markPendingRequest$schema = z.object({
  sessionId: z.string(),
  files: z.array(uploadedFile$schema).readonly(),
}).readonly()

const markPendingOutcome$schema = z.union([
  z.object({ ok: z.literal(true) }).readonly(),
  z.object({ ok: z.literal(false), code: z.string() }).readonly(),
]).readonly()

const unmarkPendingRequest$schema = z.object({
  sessionId: z.string(),
  attachmentId: z.string(),
}).readonly()

const unmarkPendingOutcome$schema = z.union([
  z.object({ ok: z.literal(true) }).readonly(),
  z.object({ ok: z.literal(false), code: z.string() }).readonly(),
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
      result: { mode: 'strict', typeSymbol: 'dsh-upload-ux#PersistFileOutcome', schema: persistFileOutcome$schema },
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
      result: { mode: 'strict', typeSymbol: 'dsh-upload-ux#RemoveFileOutcome', schema: removeFileOutcome$schema },
    },
    {
      id: 'dsh-upload-ux#uploadux/listFiles',
      service: 'uploadux',
      namespace: 'uploadux',
      method: 'listFiles',
      invocation: { kind: 'direct' },
      parameters: [{
        name: 'request',
        wire: 'request',
        source: 'json',
        codec: { mode: 'strict', typeSymbol: 'dsh-upload-ux#ListFilesRequest', schema: z.object({ sessionId: z.string() }).readonly() },
      }],
      result: { mode: 'strict', typeSymbol: 'dsh-upload-ux#ListFilesOutcome', schema: z.object({
        ok: z.literal(true),
        items: z.array(z.object({
          messageId: z.string(),
          seq: z.number(),
          files: uploadedFile$schema.array(),
        }).readonly()).readonly(),
      }).readonly() },
    },
    {
      id: 'dsh-upload-ux#uploadux/markPending',
      service: 'uploadux',
      namespace: 'uploadux',
      method: 'markPending',
      invocation: { kind: 'direct' },
      parameters: [{
        name: 'request',
        wire: 'request',
        source: 'json',
        codec: { mode: 'strict', typeSymbol: 'dsh-upload-ux#MarkPendingRequest', schema: markPendingRequest$schema },
      }],
      result: { mode: 'strict', typeSymbol: 'dsh-upload-ux#MarkPendingOutcome', schema: markPendingOutcome$schema },
    },
    {
      id: 'dsh-upload-ux#uploadux/unmarkPending',
      service: 'uploadux',
      namespace: 'uploadux',
      method: 'unmarkPending',
      invocation: { kind: 'direct' },
      parameters: [{
        name: 'request',
        wire: 'request',
        source: 'json',
        codec: { mode: 'strict', typeSymbol: 'dsh-upload-ux#UnmarkPendingRequest', schema: unmarkPendingRequest$schema },
      }],
      result: { mode: 'strict', typeSymbol: 'dsh-upload-ux#UnmarkPendingOutcome', schema: unmarkPendingOutcome$schema },
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
    listFiles: (request: { sessionId: string }) => Promise<RemoteResult<{ ok: true; items: FilesAttachedEntry[] }>>
    markPending: (request: MarkPendingRequest) => Promise<RemoteResult<MarkPendingOutcome>>
    unmarkPending: (request: UnmarkPendingRequest) => Promise<RemoteResult<UnmarkPendingOutcome>>
  }

  interface TypertRemoteMap {
    'uploadux/persistFile': (request: PersistFileRequest) => Promise<RemoteResult<PersistFileOutcome>>
    'uploadux/limits': () => Promise<RemoteResult<UploadLimits>>
    'uploadux/removeFile': (request: RemoveFileRequest) => Promise<RemoteResult<RemoveFileOutcome>>
    'uploadux/listFiles': (request: { sessionId: string }) => Promise<RemoteResult<{ ok: true; items: FilesAttachedEntry[] }>>
    'uploadux/markPending': (request: MarkPendingRequest) => Promise<RemoteResult<MarkPendingOutcome>>
    'uploadux/unmarkPending': (request: UnmarkPendingRequest) => Promise<RemoteResult<UnmarkPendingOutcome>>
  }

  interface TypertRemoteNamespaceMap {
    uploadux: TypertRemoteNamespace$uploadux
  }
}
