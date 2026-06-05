import axios from 'axios'

// All requests go through the Vite dev proxy (/api → backend).
// This keeps auth cookies same-origin so HttpOnly cookies work correctly.
export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
})

// Queue of callbacks waiting for a token refresh to complete
let isRefreshing = false
let pendingQueue: Array<() => void> = []

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
        return new Promise((resolve) => {
          pendingQueue.push(() => resolve(api(original)))
        })
      }

      original._retry = true
      isRefreshing = true

      try {
        await axios.post('/api/auth/refresh', {}, { withCredentials: true })
        // Flush all queued requests that were waiting on the refresh
        pendingQueue.forEach((cb) => cb())
        pendingQueue = []
        return api(original)
      } catch {
        pendingQueue = []
        // Only redirect if not already on a public page — prevents infinite reload
        const { pathname } = window.location
        if (pathname !== '/login' && pathname !== '/register') {
          window.location.href = '/login'
        }
      } finally {
        isRefreshing = false
      }
    }

    return Promise.reject(error)
  }
)
