import axios from 'axios'

// All requests go through the Vite dev proxy (/api → backend).
// This keeps auth cookies same-origin so HttpOnly cookies work correctly.
export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
})

// Queue of requests waiting for a token refresh to complete. Entries must be
// settled (resolved or rejected) in every outcome so no caller hangs forever.
let isRefreshing = false
let pendingQueue: Array<{ retry: () => void; fail: (err: unknown) => void }> = []

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config

    // Only attempt refresh on 401, once per request, and not on the refresh call itself
    if (
      error.response?.status === 401 &&
      !original._retry &&
      !original.url?.includes('/auth/refresh')
    ) {
      if (isRefreshing) {
        // Another refresh is already in flight — queue this request to retry after
        return new Promise((resolve, reject) => {
          pendingQueue.push({
            retry: () => resolve(api(original)),
            fail: (err) => reject(err),
          })
        })
      }

      original._retry = true
      isRefreshing = true

      try {
        await axios.post('/api/auth/refresh', {}, { withCredentials: true })
        // Flush all queued requests that were waiting on the refresh
        pendingQueue.forEach((p) => p.retry())
        pendingQueue = []
        return api(original)
      } catch (refreshError) {
        // Settle queued requests so their callers see the failure instead of hanging
        pendingQueue.forEach((p) => p.fail(refreshError))
        pendingQueue = []

        // Only a definitive rejection of the refresh token means the session is
        // really gone. A timeout / connection error / 5xx is the server being
        // unreachable — logging the user out then would revoke nothing (the
        // cookie stays valid) and just dumps everyone to the login page during
        // a blip. Stay put; the next user action retries naturally.
        const status = (refreshError as { response?: { status?: number } })?.response?.status
        if (status === 401 || status === 403) {
          // Only redirect if not already on a public page — prevents infinite reload
          const { pathname } = window.location
          if (pathname !== '/login' && pathname !== '/register') {
            window.location.href = '/login'
          }
        }
      } finally {
        isRefreshing = false
      }
    }

    return Promise.reject(error)
  }
)
