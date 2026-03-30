# Flask backend

## Run with Docker (recommended)

From the repo root:

```bash
docker compose up --build
```

API will be at `http://localhost:5000`.

## Endpoints

- `GET /api/health`
- `GET /api/events?limit=100&lock_id=default`
- `POST /api/events`

Example `POST /api/events` body:

```json
{
  "event_type": "DOOR_OPEN",
  "lock_id": "default",
  "message": "Door opened from UI",
  "payload": { "source": "admin" }
}
```
