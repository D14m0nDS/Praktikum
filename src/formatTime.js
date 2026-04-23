/**
 * Format an ISO-8601 timestamp for display (locale + medium date, short time).
 */
export function formatDateTime(isoString) {
  if (isoString == null || isoString === '') return ''
  const d = new Date(isoString)
  if (Number.isNaN(d.getTime())) return String(isoString)
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d)
}
