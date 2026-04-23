# Flask backend

## Run with Docker (recommended)

From the repo root:

```bash
docker compose up --build
```

API will be at `http://localhost:5000` (or `http://<your-lan-ip>:5000` from the Arduino on the same Wi‑Fi / phone hotspot).

---

## Admin / React (existing)

- `GET /api/health`
- `GET /api/events?limit=100&lock_id=default`
- `POST /api/events`
- `DELETE /api/events?lock_id=default`

---

## Cards (admin UI + device)

### `GET /api/cards`

All registered cards: `[{ "uid", "owner_name", "is_active" }, ...]`.

### `POST /api/cards`

Register or update a card.

```json
{ "uid": "A1B2C3D4", "owner_name": "Alice", "is_active": true }
```

Returns `201` on create, `200` on update.

### `GET /api/cards/unknown-candidates`

UIDs that appear in **`card_interactions`** but are **not** in **`cards`** (never registered). One entry per UID — **latest** server time only — sorted **newest first**.

```json
[
  { "uid": "DEADBEEF", "last_seen_at": "2026-03-31T12:00:00+00:00", "name": null }
]
```

`name` is the registrant name if we ever resolved it from `cards` at interaction time; otherwise `null` (treat as unknown in the UI).

### `GET /api/cards/history?uid=HEX`

Merged timeline for one UID (newest first): device **`logs`** plus **`card_interactions`**, including activity **before** the card was registered.

Example: `/api/cards/history?uid=A1B2C3D4`

Response: `{ "items": [ { "kind": "device_log" | "interaction", "created_at": "...", ... }, ... ] }`.

Alternate path (same data): `GET /api/cards/<uid>/history`.

---

## Arduino / IoT

### `POST /api/cards/check`

Validate a RFID UID against the `cards` table. Also appends a row to **`card_interactions`**.

**Request**

```json
{ "uid": "A1B2C3D4" }
```

UIDs are normalized: spaces/colons stripped, hex only, stored uppercase.

**Response**

```json
{ "allowed": true, "name": "Alice" }
```

or if unknown / inactive:

```json
{ "allowed": false, "name": "" }
```

### `POST /api/logs`

Append one device log row (table `logs`). **No timestamps in the request** — `created_at` is set on the server when the request arrives. If `uid` is present, a **`card_interactions`** row is also recorded.

**Request**

```json
{
  "event": "door_open",
  "uid": "A1B2C3D4",
  "name": "Alice"
}
```

**`event`** must be one of:

`access_granted` | `access_denied` | `door_open` | `door_closed` | `alarm`

- **`uid`**, **`name`**: optional; omit or use `""` for empty.
- **`success`**: optional boolean. If omitted, inferred:
  - `access_granted` → `true`
  - `access_denied` → `false`
  - `alarm` → `false`
  - `door_open` / `door_closed` → `null`

**Response** `201`: JSON row with `id`, `event_type`, `uid`, `resolved_name`, `success`, `created_at`.

---

## Database

### `cards`

| Column        | Type    |
|---------------|---------|
| `uid`         | PK, hex string |
| `owner_name`  | string  |
| `is_active`   | `bool`  |

### `card_interactions`

Every time a UID is seen (`/api/cards/check` or `/api/logs` with `uid`).

| Column        | Type      |
|---------------|-----------|
| `id`          | serial PK |
| `uid`         | indexed   |
| `name`        | nullable — registrant name if in `cards`, else `null` (unknown) |
| `created_at`  | timestamptz — **server only** |

### `logs`

| Column          | Type      |
|-----------------|-----------|
| `id`            | serial PK |
| `event_type`    | string    |
| `uid`           | nullable  |
| `resolved_name` | nullable  |
| `success`       | nullable bool |
| `created_at`    | timestamptz — **server only** |

`events` is a separate table used by the React admin log stream.

---

## Seed a test card (PostgreSQL)

Or use `POST /api/cards` from the admin UI.

```bash
docker compose exec db psql -U door -d door_monitor -c \
  "INSERT INTO cards (uid, owner_name, is_active) VALUES ('YOUR_UID', 'Test User', true) ON CONFLICT (uid) DO NOTHING;"
```

---

## Local network

Use your machine’s LAN IP in the Arduino `http://...` base URL. Hotspot from a phone is fine if the laptop and device share it.
