/** Base URL for API (empty = same origin; Vite proxies /api to Flask in dev). */
export function apiUrl(path) {
  const base = import.meta.env.VITE_API_URL ?? ''
  if (!base) return path.startsWith('/') ? path : `/${path}`
  return `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}
