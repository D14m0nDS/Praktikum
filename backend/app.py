from __future__ import annotations

import os

from flask import Flask, jsonify, request
from flask_cors import CORS
from sqlalchemy import delete, desc

from .models import Event, db


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
