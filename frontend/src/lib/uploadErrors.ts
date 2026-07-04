// Shared helpers for the bulk upload modals.

/** Stable client-side row id. crypto.randomUUID() only exists in secure
 * contexts (HTTPS / localhost) — over plain http (e.g. the test server IP)
 * it is undefined, so fall back to a timestamp+random id. Uniqueness only
 * needs to hold within one modal session. */
export function newRowId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** True when the failure never got a server verdict (network error / timeout)
 * or the server itself broke (5xx) — retrying makes sense. A 4xx means the
 * server definitively rejected the request (duplicate doc, validation, auth):
 * retrying would replay the same rejection, so only Remove is offered. */
export function isRetryableUploadError(err: unknown): boolean {
  const status = (err as { response?: { status?: number } })?.response?.status
  return status === undefined || status >= 500
}

/** Extract the backend's error detail, falling back to a generic message. */
export function uploadErrorDetail(err: unknown, fallback = 'Upload failed'): string {
  const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
  return typeof detail === 'string' ? detail : fallback
}
