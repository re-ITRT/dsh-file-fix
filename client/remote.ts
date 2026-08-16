/** filefix 命名空间的客户端 Remote 贡献：zod 严格 codec + 类型合并。 */

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

const visionConfig$schema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
}).readonly()

const visionCandidate$schema = z.object({
  provider: z.string(),
  displayName: z.string(),
  models: z.array(z.object({
    id: z.string(),
    name: z.string(),
    image: z.boolean(),
  })).readonly(),
}).readonly()

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
  package: 'dsh-file-fix',
  descriptors: [
    {
      id: 'dsh-file-fix#filefix/persistFile',
      service: 'filefix',
      namespace: 'filefix',
      method: 'persistFile',
      invocation: { kind: 'direct' },
      parameters: [{
        name: 'request',
        wire: 'request',
        source: 'json',
        codec: { mode: 'strict', typeSymbol: 'dsh-file-fix#PersistFileRequest', schema: persistFileRequest$schema },
      }],
      result: { mode: 'strict', typeSymbol: 'dsh-file-fix#PersistFileOutcome', schema: persistFileOutcome$schema },
    },
    {
      id: 'dsh-file-fix#filefix/limits',
      service: 'filefix',
      namespace: 'filefix',
      method: 'limits',
      invocation: { kind: 'direct' },
      parameters: [],
      result: { mode: 'strict', typeSymbol: 'dsh-file-fix#UploadLimits', schema: uploadLimits$schema },
    },
    {
      id: 'dsh-file-fix#filefix/removeFile',
      service: 'filefix',
      namespace: 'filefix',
      method: 'removeFile',
      invocation: { kind: 'direct' },
      parameters: [{
        name: 'request',
        wire: 'request',
        source: 'json',
        codec: { mode: 'strict', typeSymbol: 'dsh-file-fix#RemoveFileRequest', schema: removeFileRequest$schema },
      }],
      result: { mode: 'strict', typeSymbol: 'dsh-file-fix#RemoveFileOutcome', schema: removeFileOutcome$schema },
    },
    {
      id: 'dsh-file-fix#filefix/listFiles',
      service: 'filefix',
      namespace: 'filefix',
      method: 'listFiles',
      invocation: { kind: 'direct' },
      parameters: [{
        name: 'request',
        wire: 'request',
        source: 'json',
        codec: { mode: 'strict', typeSymbol: 'dsh-file-fix#ListFilesRequest', schema: z.object({ sessionId: z.string() }).readonly() },
      }],
      result: { mode: 'strict', typeSymbol: 'dsh-file-fix#ListFilesOutcome', schema: z.object({
        ok: z.literal(true),
        items: z.array(z.object({
          messageId: z.string(),
          seq: z.number(),
          files: uploadedFile$schema.array(),
        }).readonly()).readonly(),
      }).readonly() },
    },
    {
      id: 'dsh-file-fix#filefix/getVisionConfig',
      service: 'filefix',
      namespace: 'filefix',
      method: 'getVisionConfig',
      invocation: { kind: 'direct' },
      parameters: [],
      result: {
        mode: 'strict',
        typeSymbol: 'GetVisionConfigResult',
        schema: z.object({
          ok: z.literal(true),
          config: visionConfig$schema,
        }),
      },
    },
    {
      id: 'dsh-file-fix#filefix/setVisionConfig',
      service: 'filefix',
      namespace: 'filefix',
      method: 'setVisionConfig',
      invocation: { kind: 'direct' },
      parameters: [{
        name: 'request',
        wire: 'request',
        source: 'json',
        codec: {
          mode: 'strict',
          typeSymbol: 'SetVisionConfigRequest',
          schema: z.object({ config: visionConfig$schema }),
        },
      }],
      result: {
        mode: 'strict',
        typeSymbol: 'SetVisionConfigResult',
        schema: z.object({ ok: z.literal(true) }),
      },
    },
    {
      id: 'dsh-file-fix#filefix/testVisionModel',
      service: 'filefix',
      namespace: 'filefix',
      method: 'testVisionModel',
      invocation: { kind: 'direct' },
      parameters: [{
        name: 'request',
        wire: 'request',
        source: 'json',
        codec: {
          mode: 'strict',
          typeSymbol: 'TestVisionModelRequest',
          schema: z.object({
            provider: z.string(),
            model: z.string(),
          }),
        },
      }],
      result: {
        mode: 'strict',
        typeSymbol: 'TestVisionModelResult',
        schema: z.object({
          ok: z.boolean(),
          image: z.boolean(),
          error: z.string().optional(),
        }),
      },
    },
    {
      id: 'dsh-file-fix#filefix/listVisionCandidates',
      service: 'filefix',
      namespace: 'filefix',
      method: 'listVisionCandidates',
      invocation: { kind: 'direct' },
      parameters: [],
      result: {
        mode: 'strict',
        typeSymbol: 'ListVisionCandidatesResult',
        schema: z.object({
          ok: z.literal(true),
          providers: z.array(visionCandidate$schema),
        }),
      },
    },
    {
      id: 'dsh-file-fix#filefix/markPending',
      service: 'filefix',
      namespace: 'filefix',
      method: 'markPending',
      invocation: { kind: 'direct' },
      parameters: [{
        name: 'request',
        wire: 'request',
        source: 'json',
        codec: { mode: 'strict', typeSymbol: 'dsh-file-fix#MarkPendingRequest', schema: markPendingRequest$schema },
      }],
      result: { mode: 'strict', typeSymbol: 'dsh-file-fix#MarkPendingOutcome', schema: markPendingOutcome$schema },
    },
    {
      id: 'dsh-file-fix#filefix/unmarkPending',
      service: 'filefix',
      namespace: 'filefix',
      method: 'unmarkPending',
      invocation: { kind: 'direct' },
      parameters: [{
        name: 'request',
        wire: 'request',
        source: 'json',
        codec: { mode: 'strict', typeSymbol: 'dsh-file-fix#UnmarkPendingRequest', schema: unmarkPendingRequest$schema },
      }],
      result: { mode: 'strict', typeSymbol: 'dsh-file-fix#UnmarkPendingOutcome', schema: unmarkPendingOutcome$schema },
    },
  ],
}

/** 客户端可用的 filefix 命名空间完整类型（组件与管线共用）。 */
export type UploadRemote = TypertRemoteNamespace<'filefix'>

/** 客户端类型合并：让 ctx.remote.filefix.<method> 全程有类型。 */
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$filefix {
    persistFile: (request: PersistFileRequest) => Promise<RemoteResult<PersistFileOutcome>>
    limits: () => Promise<RemoteResult<UploadLimits>>
    removeFile: (request: RemoveFileRequest) => Promise<RemoteResult<RemoveFileOutcome>>
    listFiles: (request: { sessionId: string }) => Promise<RemoteResult<{ ok: true; items: FilesAttachedEntry[] }>>
    markPending: (request: MarkPendingRequest) => Promise<RemoteResult<MarkPendingOutcome>>
    unmarkPending: (request: UnmarkPendingRequest) => Promise<RemoteResult<UnmarkPendingOutcome>>
    getVisionConfig: () => Promise<RemoteResult<{ ok: true; config: { provider?: string; model?: string } }>>
    setVisionConfig: (request: { config: { provider?: string; model?: string } }) => Promise<RemoteResult<{ ok: true }>>
    testVisionModel: (request: { provider: string; model: string }) => Promise<RemoteResult<{ ok: boolean; image: boolean; error?: string }>>
    listVisionCandidates: () => Promise<RemoteResult<{ ok: true; providers: { provider: string; displayName: string; models: { id: string; name: string; image: boolean }[] }[] }>>
  }

  interface TypertRemoteMap {
    'filefix/persistFile': (request: PersistFileRequest) => Promise<RemoteResult<PersistFileOutcome>>
    'filefix/limits': () => Promise<RemoteResult<UploadLimits>>
    'filefix/removeFile': (request: RemoveFileRequest) => Promise<RemoteResult<RemoveFileOutcome>>
    'filefix/listFiles': (request: { sessionId: string }) => Promise<RemoteResult<{ ok: true; items: FilesAttachedEntry[] }>>
    'filefix/markPending': (request: MarkPendingRequest) => Promise<RemoteResult<MarkPendingOutcome>>
    'filefix/unmarkPending': (request: UnmarkPendingRequest) => Promise<RemoteResult<UnmarkPendingOutcome>>
    'filefix/getVisionConfig': () => Promise<RemoteResult<{ ok: true; config: { provider?: string; model?: string } }>>
    'filefix/setVisionConfig': (request: { config: { provider?: string; model?: string } }) => Promise<RemoteResult<{ ok: true }>>
    'filefix/testVisionModel': (request: { provider: string; model: string }) => Promise<RemoteResult<{ ok: boolean; image: boolean; error?: string }>>
    'filefix/listVisionCandidates': () => Promise<RemoteResult<{ ok: true; providers: { provider: string; displayName: string; models: { id: string; name: string; image: boolean }[] }[] }>>
  }

  interface TypertRemoteNamespaceMap {
    filefix: TypertRemoteNamespace$filefix
  }
}
