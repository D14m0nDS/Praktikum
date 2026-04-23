from __future__ import annotations

import os
from datetime import datetime, timezone

from flask import Flask, jsonify, request
from flask_cors import CORS
from sqlalchemy import delete, desc, select, text

from .models import Card, CardInteraction, DeviceLog, Event, db
from .uidutil import normalize_uid

ALLOWED_DEVICE_EVENTS = frozenset(
    {
        "access_granted",
        "access_denied",
        "door_open",
        "door_closed",
        "alarm",
    }
)


def _infer_success(event: str) -> bool | None:
    if event == "access_granted":
        return True
    if event == "access_denied":
        return False
    if event == "alarm":
        return False
    if event in ("door_open", "door_closed"):
        return None
    return None


def create_app() -> Flask:
    app = Flask(__name__)

    app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get(
        "DATABASE_URL",
        "postgresql+psycopg://door:doorpass@localhost:5432/door_monitor",
    )
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    CORS(app, resources={r"/api/*": {"origins": "*"}})
    db.init_app(app)

    with app.app_context():
        db.create_all()

    @app.get("/api/health")
    def health():
        return jsonify({"ok": True})

    @app.post("/api/cards/check")
    def check_card():
        """
        Arduino: validate UID against registered cards.
        Body: { "uid": "HEX" }
        Response: { "allowed": bool, "name": str }
        """
        data = request.get_json(silent=True) or {}
        raw = data.get("uid")
        if not raw or not isinstance(raw, str):
            return jsonify({"error": "uid (hex string) is required"}), 400
        try:
            uid = normalize_uid(raw)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

        card = db.session.get(Card, uid)
        name_at = card.owner_name if card is not None else None

        db.session.add(CardInteraction(uid=uid, interaction_name=name_at))
        db.session.commit()

        if card is None or not card.is_active:
            return jsonify({"allowed": False, "name": ""})

        return jsonify({"allowed": True, "name": card.owner_name})

    @app.get("/api/cards")
    def list_cards():
        """All registered cards (for admin UI)."""
        rows = db.session.scalars(select(Card).order_by(Card.uid)).all()
        return jsonify([c.to_dict() for c in rows])

    @app.post("/api/cards")
    def upsert_card():
        """
        Register or update a card (admin UI).
        Body: { "uid": "HEX", "owner_name": "...", "is_active": true }
        """
        data = request.get_json(silent=True) or {}
        raw = data.get("uid")
        owner = data.get("owner_name")
        if not raw or not isinstance(raw, str):
            return jsonify({"error": "uid (hex string) is required"}), 400
        if not owner or not isinstance(owner, str):
            return jsonify({"error": "owner_name (string) is required"}), 400
        try:
            uid = normalize_uid(raw)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

        active = data.get("is_active", True)
        if not isinstance(active, bool):
            return jsonify({"error": "is_active must be a boolean"}), 400

        card = db.session.get(Card, uid)
        if card is None:
            card = Card(uid=uid, owner_name=owner.strip(), is_active=active)
            db.session.add(card)
            status = 201
        else:
            card.owner_name = owner.strip()
            card.is_active = active
            status = 200
        db.session.commit()
        return jsonify(card.to_dict()), status

    @app.get("/api/cards/unknown-candidates")
    def unknown_card_candidates():
        """
        UIDs seen in interactions but not in `cards` (not registered).
        One row per uid: latest server time only, sorted newest first.
        `name` is null when never matched a registrant (unknown).
        """
        sql = text(
            """
            SELECT DISTINCT ON (ci.uid) ci.uid, ci.created_at, ci.name
            FROM card_interactions ci
            WHERE NOT EXISTS (SELECT 1 FROM cards c WHERE c.uid = ci.uid)
            ORDER BY ci.uid, ci.created_at DESC
            """
        )
        rows = db.session.execute(sql).mappings().all()
        items = [
            {
                "uid": r["uid"],
                "last_seen_at": r["created_at"].isoformat(),
                "name": r["name"],
            }
            for r in rows
        ]
        items.sort(key=lambda x: x["last_seen_at"], reverse=True)
        return jsonify(items)

    def _card_history_json(uid: str):
        def iso(dt: datetime) -> str:
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.isoformat()

        log_rows = (
            DeviceLog.query.filter_by(uid=uid)
            .order_by(desc(DeviceLog.created_at))
            .limit(250)
            .all()
        )
        int_rows = (
            CardInteraction.query.filter_by(uid=uid)
            .order_by(desc(CardInteraction.created_at))
            .limit(250)
            .all()
        )

        items: list[dict] = []
        for L in log_rows:
            items.append(
                {
                    "kind": "device_log",
                    "created_at": iso(L.created_at),
                    "event_type": L.event_type,
                    "resolved_name": L.resolved_name,
                    "success": L.success,
                }
            )
        for I in int_rows:
            items.append(
                {
                    "kind": "interaction",
                    "created_at": iso(I.created_at),
                    "name": I.interaction_name,
                }
            )
        items.sort(key=lambda x: x["created_at"], reverse=True)
        return jsonify({"items": items[:300]})

    @app.get("/api/cards/history")
    def card_history_query():
        """
        Preferred: GET /api/cards/history?uid=HEX
        (Avoids proxy/path quirks; path is only /api/cards/history + query.)
        """
        uid_raw = (request.args.get("uid") or "").strip()
        if not uid_raw:
            return jsonify({"error": "uid query parameter is required"}), 400
        try:
            uid = normalize_uid(uid_raw)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        return _card_history_json(uid)

    @app.get("/api/cards/<uid_raw>/history")
    def card_history_path(uid_raw: str):
        """Alternate: GET /api/cards/<uid>/history"""
        try:
            uid = normalize_uid(uid_raw)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        return _card_history_json(uid)

    @app.route("/api/logs", methods=["GET", "POST", "DELETE"])
    def device_logs():
        """
        GET: list recent device log rows (admin UI).
        DELETE: clear all device log rows.
        POST: Arduino — append a device log line.
        Body (POST): {
          "event": "access_granted | access_denied | door_open | door_closed | alarm",
          "uid": "HEX" (optional),
          "name": "UserName" (optional),
          "success": bool (optional; if omitted, inferred from event)
        }
        Timestamps are set only on the server when the request is received.
        """
        if request.method == "GET":
            limit = request.args.get("limit", default="100")
            try:
                limit_int = max(1, min(500, int(limit)))
            except ValueError:
                return jsonify({"error": "limit must be an integer"}), 400
            rows = (
                DeviceLog.query.order_by(desc(DeviceLog.id)).limit(limit_int).all()
            )
            return jsonify([r.to_dict() for r in rows])

        if request.method == "DELETE":
            result = db.session.execute(delete(DeviceLog))
            db.session.commit()
            return jsonify({"deleted": result.rowcount})

        data = request.get_json(silent=True) or {}
        event = data.get("event")
        if not event or not isinstance(event, str):
            return jsonify({"error": "event (string) is required"}), 400
        event = event.strip()
        if event not in ALLOWED_DEVICE_EVENTS:
            return (
                jsonify(
                    {
                        "error": "invalid event",
                        "allowed": sorted(ALLOWED_DEVICE_EVENTS),
                    }
                ),
                400,
            )

        uid_norm: str | None = None
        raw_uid = data.get("uid")
        if raw_uid is not None:
            if raw_uid == "":
                uid_norm = None
            elif isinstance(raw_uid, str):
                try:
                    uid_norm = normalize_uid(raw_uid)
                except ValueError as e:
                    return jsonify({"error": f"uid: {e}"}), 400
            else:
                return jsonify({"error": "uid must be a string"}), 400

        resolved = data.get("name")
        resolved_name = resolved.strip() if isinstance(resolved, str) else None
        if resolved_name == "":
            resolved_name = None

        created_at = datetime.now(timezone.utc)

        success = data.get("success", None)
        if success is not None and not isinstance(success, bool):
            return jsonify({"error": "success must be a boolean if provided"}), 400
        if success is None:
            success = _infer_success(event)

        row = DeviceLog(
            event_type=event,
            uid=uid_norm,
            resolved_name=resolved_name,
            success=success,
            created_at=created_at,
        )
        db.session.add(row)

        if uid_norm is not None:
            reg = db.session.get(Card, uid_norm)
            interaction_name = reg.owner_name if reg is not None else resolved_name
            db.session.add(
                CardInteraction(uid=uid_norm, interaction_name=interaction_name)
            )

        db.session.commit()
        return jsonify(row.to_dict()), 201

    @app.get("/api/events")
    def list_events():
        limit = request.args.get("limit", default="100")
        lock_id = request.args.get("lock_id", default=None)

        try:
            limit_int = max(1, min(500, int(limit)))
        except ValueError:
            return jsonify({"error": "limit must be an integer"}), 400

        q = Event.query
        if lock_id:
            q = q.filter_by(lock_id=lock_id)

        items = q.order_by(desc(Event.id)).limit(limit_int).all()
        return jsonify([e.to_dict() for e in items])

    @app.post("/api/events")
    def create_event():
        data = request.get_json(silent=True) or {}
        event_type = data.get("event_type")
        if not event_type or not isinstance(event_type, str):
            return jsonify({"error": "event_type (string) is required"}), 400

        lock_id = data.get("lock_id") or "default"
        message = data.get("message")
        payload = data.get("payload")

        ev = Event(
            lock_id=str(lock_id),
            event_type=event_type.strip(),
            message=message if isinstance(message, str) else None,
            payload=payload if isinstance(payload, dict) else None,
        )
        db.session.add(ev)
        db.session.commit()
        return jsonify(ev.to_dict()), 201

    @app.delete("/api/events")
    def delete_events():
        lock_id = request.args.get("lock_id", default=None)
        stmt = delete(Event)
        if lock_id:
            stmt = stmt.where(Event.lock_id == lock_id)
        result = db.session.execute(stmt)
        db.session.commit()
        return jsonify({"deleted": result.rowcount})

    return app


app = create_app()
