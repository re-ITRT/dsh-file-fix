/** 用户消息气泡（wrapper 自绘版，右对齐）。 */
export const userBubbleWrap: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: 4,
  margin: '6px 0',
}

export const userBubble: CSSProperties = {
  maxWidth: '82%',
  background: 'var(--ds-color-accent, rgba(77, 111, 255, 0.14))',
  border: '1px solid var(--ds-color-accent-border, rgba(77, 111, 255, 0.3))',
  borderRadius: '16px 4px 16px 16px',
  padding: '8px 12px',
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 14,
  lineHeight: 1.55,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
}

export const userBubbleText: CSSProperties = {
  whiteSpace: 'pre-wrap',
}

export const userBubbleTime: CSSProperties = {
  marginTop: 4,
  fontSize: 11,
  opacity: 0.7,
  textAlign: 'right',
  color: 'var(--dsw-alias-label-caption)',
}

/** rail / chip / picker / 历史气泡的内联样式（主题变量内联 style 同样生效）。 */

import type { CSSProperties } from 'react'

export const rail: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  padding: '4px 0',
}

export const chip: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  maxWidth: 260,
  padding: '3px 8px',
  border: '1px solid var(--dsw-alias-border-l4)',
  borderRadius: 8,
  background: 'var(--dsw-alias-interactive-bg-hover)',
  cursor: 'default',
}

export const chipError: CSSProperties = {
  cursor: 'pointer',
}

export const thumb: CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: 4,
  objectFit: 'cover',
  flex: 'none',
}

export const name: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 12,
}

export const meta: CSSProperties = {
  flex: 'none',
  color: 'var(--dsw-alias-label-caption)',
  fontSize: 12,
}

export const remove: CSSProperties = {
  flex: 'none',
  border: 'none',
  background: 'none',
  padding: '0 2px',
  color: 'var(--dsw-alias-label-caption)',
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: 1,
}

export const notice: CSSProperties = {
  width: '100%',
  color: 'var(--dsw-alias-label-caption)',
  fontSize: 12,
}

export const picker: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid var(--dsw-alias-border-l4)',
  borderRadius: 8,
  background: 'var(--dsw-alias-interactive-bg-hover)',
  color: 'var(--dsw-alias-label-primary)',
  cursor: 'pointer',
  padding: 5,
}

export const hiddenInput: CSSProperties = {
  display: 'none',
}

export const bubble: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  margin: '2px 0 8px',
  padding: '8px 10px',
  border: '1px solid var(--dsw-alias-border-l4)',
  borderRadius: 10,
  background: 'var(--dsw-alias-interactive-bg-hover)',
  maxWidth: 420,
}

export const bubbleTitle: CSSProperties = {
  color: 'var(--dsw-alias-label-caption)',
  fontSize: 12,
  marginBottom: 2,
}

export const fileRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 13,
  textDecoration: 'none',
  padding: '2px 0',
}

export const fileName: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

export const fileMeta: CSSProperties = {
  flex: 'none',
  color: 'var(--dsw-alias-label-caption)',
  fontSize: 12,
}

export const downloadMark: CSSProperties = {
  flex: 'none',
  opacity: 0.7,
}
