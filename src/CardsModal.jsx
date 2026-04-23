import { useCallback, useEffect, useState } from 'react'
import { apiUrl } from './api.js'
import { formatDateTime } from './formatTime.js'

const DEVICE_EVENT_LABELS = {
  access_granted: 'Access granted',
  access_denied: 'Access denied',
  door_open: 'Door open',
  door_closed: 'Door closed',
  alarm: 'Alarm',
}

function labelDeviceEvent(t) {
  return DEVICE_EVENT_LABELS[t] ?? t
}

export function CardsModal({ open, onClose, onGlobalError }) {
  const [view, setView] = useState('list')
  const [cards, setCards] = useState([])
  const [unknownCandidates, setUnknownCandidates] = useState([])
  const [historyItems, setHistoryItems] = useState([])
  const [menuForUid, setMenuForUid] = useState(null)
  const [loading, setLoading] = useState(false)
  const [localError, setLocalError] = useState(null)

  const [addUid, setAddUid] = useState('')
  const [addName, setAddName] = useState('')
  const [editCard, setEditCard] = useState(null)
  const [editName, setEditName] = useState('')
  const [editActive, setEditActive] = useState(true)
  const [historyUid, setHistoryUid] = useState(null)

  const reportError = useCallback(
    (e) => {
      const msg = String(e?.message ?? e)
      setLocalError(msg)
      onGlobalError?.(msg)
    },
    [onGlobalError],
  )

  const loadCards = useCallback(async () => {
    setLoading(true)
    setLocalError(null)
    try {
      const r = await fetch(apiUrl('/api/cards'))
      if (!r.ok) throw new Error(await r.text())
      setCards(await r.json())
    } catch (e) {
      reportError(e)
    } finally {
      setLoading(false)
    }
  }, [reportError])

  const loadUnknown = useCallback(async () => {
    setLoading(true)
    setLocalError(null)
    try {
      const r = await fetch(apiUrl('/api/cards/unknown-candidates'))
      if (!r.ok) throw new Error(await r.text())
      setUnknownCandidates(await r.json())
    } catch (e) {
      reportError(e)
    } finally {
      setLoading(false)
    }
  }, [reportError])

  const loadHistory = useCallback(
    async (uid) => {
      setLoading(true)
      setLocalError(null)
      try {
        const q = new URLSearchParams({ uid })
        const r = await fetch(apiUrl(`/api/cards/history?${q}`))
        if (!r.ok) throw new Error(await r.text())
        const data = await r.json()
        setHistoryItems(data.items ?? [])
      } catch (e) {
        setHistoryItems([])
        reportError(e)
      } finally {
        setLoading(false)
      }
    },
    [reportError],
  )

  useEffect(() => {
    if (!open) {
      setView('list')
      setMenuForUid(null)
      setLocalError(null)
      setAddUid('')
      setAddName('')
      setEditCard(null)
      setHistoryUid(null)
      setHistoryItems([])
      return
    }
    void loadCards()
  }, [open, loadCards])

  useEffect(() => {
    if (!open || view !== 'add') return
    void loadUnknown()
  }, [open, view, loadUnknown])

  useEffect(() => {
    if (!open || view !== 'history' || !historyUid) return
    void loadHistory(historyUid)
  }, [open, view, historyUid, loadHistory])

  useEffect(() => {
    if (!open || menuForUid == null) return
    const close = () => setMenuForUid(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [open, menuForUid])

  async function submitAdd() {
    setLocalError(null)
    try {
      const r = await fetch(apiUrl('/api/cards'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: addUid.trim(),
          owner_name: addName.trim(),
          is_active: true,
        }),
      })
      if (!r.ok) throw new Error(await r.text())
      setAddUid('')
      setAddName('')
      setView('list')
      await loadCards()
    } catch (e) {
      reportError(e)
    }
  }

  async function submitEdit() {
    if (!editCard) return
    setLocalError(null)
    try {
      const r = await fetch(apiUrl('/api/cards'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: editCard.uid,
          owner_name: editName.trim(),
          is_active: editActive,
        }),
      })
      if (!r.ok) throw new Error(await r.text())
      setEditCard(null)
      setView('list')
      await loadCards()
    } catch (e) {
      reportError(e)
    }
  }

  function openEdit(card) {
    setMenuForUid(null)
    setEditCard(card)
    setEditName(card.owner_name)
    setEditActive(card.is_active)
    setView('edit')
  }

  function openHistory(uid) {
    setMenuForUid(null)
    setHistoryUid(uid)
    setView('history')
  }

  function goBack() {
    setLocalError(null)
    if (view === 'add' || view === 'edit' || view === 'history') {
      setView('list')
      setEditCard(null)
      setHistoryUid(null)
      void loadCards()
    }
  }

  if (!open) return null

  let title = 'Registered cards'
  if (view === 'add') title = 'Add card'
  else if (view === 'edit') title = 'Edit card'
  else if (view === 'history') title = `History · ${historyUid ?? ''}`

  return (
    <div
      className="cardsModalBackdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="cardsModalPanel"
        role="dialog"
        aria-labelledby="cardsModalTitle"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="cardsModalHeader">
          <div className="cardsModalHeaderLeft">
            {view !== 'list' ? (
              <button
                type="button"
                className="cardsModalIconBtn"
                aria-label="Back"
                onClick={goBack}
              >
                ←
              </button>
            ) : (
              <span className="cardsModalHeaderSpacer" />
            )}
          </div>
          <h2 id="cardsModalTitle" className="cardsModalTitle">
            {title}
          </h2>
          <div className="cardsModalHeaderRight">
            <button
              type="button"
              className="cardsModalIconBtn"
              aria-label="Close"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </header>

        {localError ? (
          <div className="cardsModalError">{localError}</div>
        ) : null}

        <div
          className={
            view === 'list'
              ? 'cardsModalBody cardsModalBodyWithFab'
              : 'cardsModalBody'
          }
        >
          {view === 'list' && (
            <>
              {loading && cards.length === 0 ? (
                <p className="cardsModalMuted">Loading…</p>
              ) : cards.length === 0 ? (
                <p className="cardsModalMuted">
                  No registered cards yet. Tap + to add one.
                </p>
              ) : (
                <ul className="cardsModalList">
                  {cards.map((c) => (
                    <li key={c.uid} className="cardsModalRow">
                      <div className="cardsModalRowMain">
                        <div className="cardsModalRowName">{c.owner_name}</div>
                        <div className="cardsModalRowMeta mono">{c.uid}</div>
                        <div
                          className={
                            c.is_active
                              ? 'cardsModalBadge cardsModalBadgeOn'
                              : 'cardsModalBadge cardsModalBadgeOff'
                          }
                        >
                          {c.is_active ? 'Active' : 'Inactive'}
                        </div>
                      </div>
                      <div className="cardsModalRowActions">
                        <button
                          type="button"
                          className="cardsModalKebab"
                          aria-label="Card actions"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setMenuForUid((u) => (u === c.uid ? null : c.uid))
                          }}
                        >
                          ⋮
                        </button>
                        {menuForUid === c.uid ? (
                          <div
                            className="cardsModalMenu"
                            role="menu"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => openEdit(c)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => openHistory(c.uid)}
                            >
                              History
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                className="cardsModalFab"
                aria-label="Add card"
                onClick={() => {
                  setMenuForUid(null)
                  setView('add')
                }}
              >
                +
              </button>
            </>
          )}

          {view === 'add' && (
            <div className="cardsModalForm">
              <label className="cardsModalLabel">
                Card UID (hex)
                <input
                  className="cardsModalInput"
                  value={addUid}
                  onChange={(e) => setAddUid(e.target.value)}
                  placeholder="e.g. A1B2C3D4"
                  autoComplete="off"
                />
              </label>
              <label className="cardsModalLabel">
                Display name
                <input
                  className="cardsModalInput"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder="Owner name"
                  autoComplete="off"
                />
              </label>
              <p className="cardsModalSectionTitle">Recently seen (not registered)</p>
              {loading && unknownCandidates.length === 0 ? (
                <p className="cardsModalMuted">Loading…</p>
              ) : unknownCandidates.length === 0 ? (
                <p className="cardsModalMuted">No unknown UIDs yet.</p>
              ) : (
                <ul className="cardsModalPickList">
                  {unknownCandidates.map((u) => (
                    <li key={u.uid}>
                      <button
                        type="button"
                        className="cardsModalPickBtn"
                        onClick={() => setAddUid(u.uid)}
                      >
                        <span className="mono">{u.uid}</span>
                        <span className="cardsModalPickSub">
                          {formatDateTime(u.last_seen_at)}
                          {u.name ? ` · ${u.name}` : ''}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                className="cardsModalPrimary"
                disabled={!addUid.trim() || !addName.trim()}
                onClick={() => void submitAdd()}
              >
                Add card
              </button>
            </div>
          )}

          {view === 'edit' && editCard && (
            <div className="cardsModalForm">
              <label className="cardsModalLabel">
                Card UID
                <input
                  className="cardsModalInput cardsModalInputReadonly"
                  value={editCard.uid}
                  readOnly
                  tabIndex={-1}
                />
              </label>
              <label className="cardsModalLabel">
                Display name
                <input
                  className="cardsModalInput"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </label>
              <label className="cardsModalLabel">
                Status
                <select
                  className="cardsModalInput"
                  value={editActive ? 'active' : 'inactive'}
                  onChange={(e) =>
                    setEditActive(e.target.value === 'active')
                  }
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
              <button
                type="button"
                className="cardsModalPrimary"
                disabled={!editName.trim()}
                onClick={() => void submitEdit()}
              >
                Save
              </button>
            </div>
          )}

          {view === 'history' && (
            <div className="cardsModalHistory">
              {loading && historyItems.length === 0 ? (
                <p className="cardsModalMuted">Loading…</p>
              ) : historyItems.length === 0 ? (
                <p className="cardsModalMuted">No history for this UID.</p>
              ) : (
                <ul className="cardsModalHistoryList">
                  {historyItems.map((item, i) => (
                    <li key={`${item.kind}-${item.created_at}-${i}`}>
                      {item.kind === 'device_log' ? (
                        <div className="cardsModalHistoryRow">
                          <div className="cardsModalHistoryTime">
                            {formatDateTime(item.created_at)}
                          </div>
                          <div className="cardsModalHistoryKind">Device log</div>
                          <div>{labelDeviceEvent(item.event_type)}</div>
                          {item.resolved_name ? (
                            <div className="cardsModalMuted">
                              Name: {item.resolved_name}
                            </div>
                          ) : null}
                          <div className="cardsModalMuted">
                            Success:{' '}
                            {item.success === true
                              ? 'yes'
                              : item.success === false
                                ? 'no'
                                : '—'}
                          </div>
                        </div>
                      ) : (
                        <div className="cardsModalHistoryRow">
                          <div className="cardsModalHistoryTime">
                            {formatDateTime(item.created_at)}
                          </div>
                          <div className="cardsModalHistoryKind">
                            Card seen (check / scan)
                          </div>
                          <div className="cardsModalMuted">
                            {item.name
                              ? `Resolved name: ${item.name}`
                              : 'Unknown at time'}
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
