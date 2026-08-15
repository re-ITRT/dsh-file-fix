/** rail / chip / picker 的内联样式（主题变量内联 style 同样生效，避免 css 产物加载问题）。 */

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
