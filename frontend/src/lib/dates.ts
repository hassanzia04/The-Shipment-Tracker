import { format, parseISO, isValid } from 'date-fns'

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  try {
    const d = typeof value === 'string' ? parseISO(value) : value
    return isValid(d) ? format(d, 'dd/MM/yyyy') : '—'
  } catch {
    return '—'
  }
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  try {
    const d = typeof value === 'string' ? parseISO(value) : value
    return isValid(d) ? format(d, 'dd/MM/yyyy HH:mm') : '—'
  } catch {
    return '—'
  }
}

export function toApiDate(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
