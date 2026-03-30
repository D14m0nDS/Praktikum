import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const COUNTDOWN_SECONDS = 10
const MAX_LOGS = 100
const LOCK_ID = 'default'

/** Base URL for API (empty = same origin; Vite proxies /api to Flask in dev). */
function apiUrl(path) {
  const base = import.meta.env.VITE_API_URL ?? ''
  if (!base) return path.startsWith('/') ? path : `/${path}`
  return `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}

function formatEventLabel(event) {
  switch (event) {
    case 'DOOR_OPEN':
      return 'Door opened'
    case 'DOOR_CLOSE':
      return 'Door closed'
    case 'ALARM_COUNTDOWN_START':
      return 'Alarm countdown started (10s)'
    case 'BEEP':
      return 'Beep'
    case 'ALARM_CONTINUOUS':
      return 'Alarm continuous (timeout/invalid)'
    case 'NFC_CORRECT':
      return 'NFC scanned (correct)'
    case 'NFC_INCORRECT':
      return 'NFC scanned (incorrect)'
    case 'ALARM_STOP':
      return 'Alarm stopped'
    case 'LOGS_CLEARED':
      return 'Logs cleared'
    default:
      return event
  }
}

function App() {
  const [doorOpen, setDoorOpen] = useState(false)
  const [alarmMode, setAlarmMode] = useState('idle') // idle | countdown | continuous | stopped
  const [countdownLeft, setCountdownLeft] = useState(0)
  const [logs, setLogs] = useState([])
  const [apiError, setApiError] = useState(null)

  const countdownIntervalRef = useRef(null)
  const beepIntervalRef = useRef(null)

  const statusText = useMemo(() => {
    const door = doorOpen ? 'open' : 'closed'
    if (alarmMode === 'countdown') {
      return `Door: ${door} • Alarm: countdown (${countdownLeft}s)`
    }
    if (alarmMode === 'continuous') {
      return `Door: ${door} • Alarm: continuous`
    }
    if (alarmMode === 'stopped') {
      return `Door: ${door} • Alarm: stopped`
    }
    if (doorOpen) return 'Door: open • Alarm: idle'
    return 'Door: closed'
  }, [alarmMode, countdownLeft, doorOpen])

  /** NFC works when door is open, or door closed but alarm is active (countdown / continuous). Blocked after correct scan. */
  const canUseNfc = useMemo(() => {
    if (alarmMode === 'stopped') return false
    return doorOpen || alarmMode === 'countdown' || alarmMode === 'continuous'
  }, [alarmMode, doorOpen])

  const refreshLogs = useCallback(async () => {
    const q = new URLSearchParams({
      limit: String(MAX_LOGS),
      lock_id: LOCK_ID,
    })
    const r = await fetch(apiUrl(`/api/events?${q}`))
    if (!r.ok) {
      const t = await r.text()
      throw new Error(t || r.statusText)
    }
    const rows = await r.json()
    setLogs(
      rows.map((row) => ({
        id: row.id,
        ts: row.created_at,
        event: row.event_type,
      })),
    )
    setApiError(null)
  }, [])

  const postEvent = useCallback(
    async (eventType) => {
      const r = await fetch(apiUrl('/api/events'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_type: eventType, lock_id: LOCK_ID }),
      })
      if (!r.ok) {
        const t = await r.text()
        throw new Error(t || r.statusText)
      }
      await refreshLogs()
    },
    [refreshLogs],
  )

  function stopTimers() {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current)
      countdownIntervalRef.current = null
    }
    if (beepIntervalRef.current) {
      clearInterval(beepIntervalRef.current)
      beepIntervalRef.current = null
    }
  }

  const startCountdown = useCallback(async () => {
    stopTimers()
    setAlarmMode('countdown')
    setCountdownLeft(COUNTDOWN_SECONDS)
    await postEvent('ALARM_COUNTDOWN_START')

    countdownIntervalRef.current = setInterval(() => {
      setCountdownLeft((prev) => {
        if (prev <= 1) return 0
        return prev - 1
      })
    }, 1000)

    beepIntervalRef.current = setInterval(() => {
      void postEvent('BEEP').catch((e) => setApiError(String(e.message ?? e)))
    }, 2000)
  }, [postEvent])

  async function openDoor() {
    if (doorOpen) return
    setDoorOpen(true)
    try {
      await postEvent('DOOR_OPEN')
      // New alarm window only when nothing is actively armed, or after a successful scan (stopped).
      // If countdown/continuous is already running (e.g. door was closed mid-alarm), do not reset.
      if (alarmMode === 'idle' || alarmMode === 'stopped') {
        await startCountdown()
      }
    } catch (e) {
      setApiError(String(e.message ?? e))
    }
  }

  async function closeDoor() {
    if (!doorOpen) return
    setDoorOpen(false)
    try {
      await postEvent('DOOR_CLOSE')
    } catch (e) {
      setApiError(String(e.message ?? e))
    }
  }

  async function scanCorrect() {
    if (!canUseNfc) return
    try {
      await postEvent('NFC_CORRECT')
      stopTimers()
      setAlarmMode('stopped')
      setCountdownLeft(0)
      await postEvent('ALARM_STOP')
    } catch (e) {
      setApiError(String(e.message ?? e))
    }
  }

  async function scanIncorrect() {
    if (!canUseNfc) return
    try {
      await postEvent('NFC_INCORRECT')
      if (alarmMode === 'continuous') {
        return
      }
      stopTimers()
      setAlarmMode('continuous')
      setCountdownLeft(0)
      await postEvent('ALARM_CONTINUOUS')
    } catch (e) {
      setApiError(String(e.message ?? e))
    }
  }

  async function clearLogs() {
    try {
      const q = new URLSearchParams({ lock_id: LOCK_ID })
      const r = await fetch(apiUrl(`/api/events?${q}`), { method: 'DELETE' })
      if (!r.ok) {
        const t = await r.text()
        throw new Error(t || r.statusText)
      }
      await refreshLogs()
    } catch (e) {
      setApiError(String(e.message ?? e))
    }
  }

  // When countdown hits 0, switch to continuous alarm (even if door was closed meanwhile).
  useEffect(() => {
    if (alarmMode !== 'countdown') return
    if (countdownLeft !== 0) return

    stopTimers()
    setAlarmMode('continuous')
    void postEvent('ALARM_CONTINUOUS').catch((e) => setApiError(String(e.message ?? e)))
  }, [alarmMode, countdownLeft, postEvent])

  useEffect(() => {
    void refreshLogs().catch((e) => setApiError(String(e.message ?? e)))
  }, [refreshLogs])

  useEffect(() => {
    return () => stopTimers()
  }, [])

  return (
    <>
      <div className="page">
        <header className="topbar">
          <div>
            <h1 className="title">Door monitor admin</h1>
            <div className="subtitle">{statusText}</div>
            {apiError ? <div className="apiError">{apiError}</div> : null}
          </div>
          <div className="topbarActions">
            <button
              type="button"
              className="secondary"
              onClick={() => void clearLogs()}
            >
              Clear logs
            </button>
          </div>
        </header>

        <main className="layout">
          <section className="panel">
            <h2 className="panelTitle">Events</h2>
            <div className="buttonGrid">
              <button type="button" onClick={() => void openDoor()} disabled={doorOpen}>
                Open door
              </button>
              <button type="button" onClick={() => void closeDoor()} disabled={!doorOpen}>
                Close door
              </button>
              <button
                type="button"
                onClick={() => void scanCorrect()}
                disabled={!canUseNfc}
              >
                Scan correct NFC
              </button>
              <button
                type="button"
                onClick={() => void scanIncorrect()}
                disabled={!canUseNfc}
              >
                Scan incorrect NFC
              </button>
            </div>

            <div className="hint">
              NFC works with the door open, or with the door closed while the alarm is in countdown or continuous. A correct scan stops the alarm and disables NFC until a new cycle (e.g. close and open the door). Incorrect scan during countdown switches to continuous; if already continuous, only another log is added. Logs are stored in PostgreSQL (refresh keeps them).
            </div>
          </section>

          <section className="panel">
            <h2 className="panelTitle">Latest logs (max {MAX_LOGS})</h2>
            <div className="logs">
              <table className="logsTable">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Event</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="emptyLogs">
                        No events yet. Use the buttons or wait for the API.
                      </td>
                    </tr>
                  ) : (
                    logs.map((l) => (
                      <tr key={String(l.id)}>
                        <td className="mono">{l.ts}</td>
                        <td>{formatEventLabel(l.event)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      </div>
    </>
  )
}

export default App
