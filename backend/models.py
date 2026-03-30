from __future__ import annotations

from datetime import datetime, timezone

from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import JSON, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

db = SQLAlchemy()


class Event(db.Model):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    # For now: a single "lock". Later this can be a FK to a locks table.
    lock_id: Mapped[str] = mapped_column(String(64), nullable=False, default="default")

    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    def to_dict(self) -> dict:
        created = self.created_at
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        return {
            "id": self.id,
            "created_at": created.isoformat(),
            "lock_id": self.lock_id,
            "event_type": self.event_type,
            "message": self.message,
            "payload": self.payload,
        }
