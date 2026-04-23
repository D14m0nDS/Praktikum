import { useCallback, useEffect, useState } from 'react'
import { apiUrl } from './api.js'
import { CardsModal } from './CardsModal.jsx'
import { formatDateTime } from './formatTime.js'
import './App.css'

const MAX_LOGS = 100
const LOCK_ID = 'default'
/** How often to pull new log rows from the API (ms). */
const LOG_POLL_MS = 3000

/** Readable message when the API returns HTML error pages (e.g. 405). */
function shortApiError(status, bodyText) {
  const raw = String(bodyText ?? '')
  const stripped = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const base = stripped || `HTTP ${status}`
  return base.length > 160 ? `${base.slice(0, 157)}…` : base
}

function normalizeUid(uid) {
  return uid.replace(/[^a-fA-F0-9]/g, '').toUpperCase()
}

function formatEventLabel(event) {
  switch (event) {
    case 'door_open':
    case 'DOOR_OPEN':
      return 'Door opened'
    case 'door_closed':
    case 'DOOR_CLOSE':
      return 'Door closed'
    case 'access_granted':
    case 'NFC_CORRECT':
      return 'Access granted / NFC OK'
    case 'access_denied':
    case 'NFC_INCORRECT':
      return 'Access denied / NFC bad'
    case 'alarm':
    case 'ALARM_CONTINUOUS':
      return 'Alarm'
    case 'ALARM_COUNTDOWN_START':
      return 'Alarm countdown started (10s)'
    case 'BEEP':
      return 'Beep'
    case 'ALARM_STOP':
      return 'Alarm stopped'
    case 'LOGS_CLEARED':
      return 'Logs cleared'
    default:
      return event
  }
}

function App() {
  const [logs, setLogs] = useState([])
  const [logsFeedNote, setLogsFeedNote] = useState(null)
  const [apiError, setApiError] = useState(null)
  const [cardsModalOpen, setCardsModalOpen] = useState(false)
  const [scanUidInput, setScanUidInput] = useState('')
  const [doorOpen, setDoorOpen] = useState(false)
  const [alarmOn, setAlarmOn] = useState(false)
  const [scanCompletedForCurrentOpen, setScanCompletedForCurrentOpen] =
    useState(false)

  const refreshLogs = useCallback(async () => {
    const q = new URLSearchParams({ limit: String(MAX_LOGS) })
    let r = await fetch(apiUrl(`/api/logs?${q}`))
    if (r.ok) {
      const rows = await r.json()
      setLogs(
        rows.map((row) => ({
          id: row.id,
          ts: row.created_at,
          event: row.event_type,
        })),
      )
      setLogsFeedNote(null)
      setApiError(null)
      return
    }

    // Older backends only had POST /api/logs — GET returns 405.
    if (r.status === 405) {
      const qEv = new URLSearchParams({
        limit: String(MAX_LOGS),
        lock_id: LOCK_ID,
      })
      r = await fetch(apiUrl(`/api/events?${qEv}`))
      if (!r.ok) {
        const t = await r.text()
        throw new Error(shortApiError(r.status, t))
      }
      const rows = await r.json()
      setLogs(
        rows.map((row) => ({
          id: row.id,
          ts: row.created_at,
          event: row.event_type,
        })),
      )
      setLogsFeedNote(
        'Using the legacy event feed (GET /api/events). Rebuild or restart the API so GET /api/logs is available to list Arduino device rows.',
      )
      setApiError(null)
      return
    }

    const t = await r.text()
    throw new Error(shortApiError(r.status, t))
  }, [])

  async function clearLogs() {
    try {
      let r = await fetch(apiUrl('/api/logs'), { method: 'DELETE' })
      if (!r.ok && r.status !== 405) {
        const t = await r.text()
        throw new Error(shortApiError(r.status, t))
      }
      const q = new URLSearchParams({ lock_id: LOCK_ID })
      r = await fetch(apiUrl(`/api/events?${q}`), { method: 'DELETE' })
      if (!r.ok) {
        const t = await r.text()
        throw new Error(shortApiError(r.status, t))
      }
      await refreshLogs()
    } catch (e) {
      setApiError(String(e.message ?? e))
    }
  }

  const postMockEvent = useCallback(
    async (eventType) => {
      const r = await fetch(apiUrl('/api/events'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lock_id: LOCK_ID,
          event_type: eventType,
        }),
      })
      if (!r.ok) {
        const t = await r.text()
        throw new Error(shortApiError(r.status, t))
      }
      await refreshLogs()
    },
    [refreshLogs],
  )

  const postDeviceLog = useCallback(async (event, uid = '', name = '') => {
    const r = await fetch(apiUrl('/api/logs'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event,
        uid,
        name,
      }),
    })
    if (!r.ok) {
      const t = await r.text()
      throw new Error(shortApiError(r.status, t))
    }
  }, [])

  const checkCardWithBackend = useCallback(async (uid) => {
    const r = await fetch(apiUrl('/api/cards/check'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid }),
    })
    if (!r.ok) {
      const t = await r.text()
      throw new Error(shortApiError(r.status, t))
    }
    return r.json()
  }, [])

  const isScanDisabled =
    !doorOpen || (scanCompletedForCurrentOpen && !alarmOn) || !scanUidInput.trim()
  const isOpenDoorDisabled = doorOpen
  const isCloseDoorDisabled = !doorOpen || alarmOn

  async function handleOpenDoor() {
    if (doorOpen) return
    try {
      await postDeviceLog('door_open')
      await postMockEvent('DOOR_OPEN')
      setDoorOpen(true)
      setScanCompletedForCurrentOpen(false)
      setApiError(null)
    } catch (e) {
      setApiError(String(e.message ?? e))
    }
  }

  async function handleCloseDoor() {
    if (!doorOpen || alarmOn) return
    try {
      await postDeviceLog('door_closed')
      await postMockEvent('DOOR_CLOSE')
      setDoorOpen(false)
      setScanCompletedForCurrentOpen(false)
      setApiError(null)
    } catch (e) {
      setApiError(String(e.message ?? e))
    }
  }

  async function handleScanCard() {
    if (isScanDisabled) return
    const uid = normalizeUid(scanUidInput)
    if (!uid) {
      setApiError('Enter a valid hex UID to scan.')
      return
    }

    try {
      const check = await checkCardWithBackend(uid)
      const isAllowed = check.allowed === true
      const resolvedName = String(check.name ?? '')

      if (isAllowed) {
        await postDeviceLog('access_granted', uid, resolvedName)
        await postMockEvent('NFC_CORRECT')
        if (alarmOn) {
          await postMockEvent('ALARM_STOP')
        }
        setAlarmOn(false)
        setScanCompletedForCurrentOpen(true)
      } else {
        await postDeviceLog('access_denied', uid, '')
        await postMockEvent('NFC_INCORRECT')
        await postDeviceLog('alarm', uid, '')
        await postMockEvent('ALARM_CONTINUOUS')
        setAlarmOn(true)
      }
      setApiError(null)
    } catch (e) {
      setApiError(String(e.message ?? e))
    }
  }

  useEffect(() => {
    void refreshLogs().catch((e) =>
      setApiError(shortApiError(500, String(e?.message ?? e))),
    )

    const poll = () => {
      if (document.visibilityState === 'hidden') return
      void refreshLogs().catch(() => {
        /* background poll: keep last good rows; avoid flashing errors every tick */
      })
    }

    const id = window.setInterval(poll, LOG_POLL_MS)

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refreshLogs().catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refreshLogs])

  return (
    <>
      <div className="page">
        <header className="topbar">
          <div>
            <h1 className="title">Door monitor admin</h1>
            <div className="subtitle">
              Web activity log · physical door and RFID use the Arduino device
            </div>
            {logsFeedNote ? (
              <div className="subtitle logsFeedNote">{logsFeedNote}</div>
            ) : null}
            {apiError ? <div className="apiError">{apiError}</div> : null}
          </div>
          <div className="topbarActions">
            <button
              type="button"
              className="secondary"
              onClick={() => setCardsModalOpen(true)}
            >
              Cards
            </button>
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
            <h2 className="panelTitle">Mock IoT panel (frontend only)</h2>
            <div className="buttonGrid">
              <button
                type="button"
                className="secondary"
                disabled={isOpenDoorDisabled}
                onClick={() => void handleOpenDoor()}
              >
                Open door
              </button>
              <button
                type="button"
                className="secondary"
                disabled={isCloseDoorDisabled}
                onClick={() => void handleCloseDoor()}
              >
                Close door
              </button>
            </div>

            <label className="mockFieldLabel" htmlFor="scanUidInput">
              Scan card UID (hex)
            </label>
            <input
              id="scanUidInput"
              className="mockInput mono"
              value={scanUidInput}
              onChange={(e) => setScanUidInput(e.target.value)}
              placeholder="e.g. A1B2C3D4"
              autoComplete="off"
            />

            <button
              type="button"
              className="secondary mockScanBtn"
              disabled={isScanDisabled}
              onClick={() => void handleScanCard()}
            >
              Scan card
            </button>

            <p className="hint">
              Rules: you can only scan while door is open. After a correct scan,
              close and reopen the door before scanning again. Door cannot be
              closed while alarm is active.
            </p>
          </section>

          <section className="panel panelMain">
            <h2 className="panelTitle">
              Latest logs (max {MAX_LOGS})
              <span className="panelTitleMeta">
                · auto-refresh every {LOG_POLL_MS / 1000}s
              </span>
            </h2>
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
                        No entries yet. Device and other clients can post to the
                        API, or use Clear logs after testing.
                      </td>
                    </tr>
                  ) : (
                    logs.map((l) => (
                      <tr key={String(l.id)}>
                        <td className="timeCell">{formatDateTime(l.ts)}</td>
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

      <CardsModal
        open={cardsModalOpen}
        onClose={() => setCardsModalOpen(false)}
        onGlobalError={(msg) => setApiError(msg)}
      />
    </>
  )
}

export default App
