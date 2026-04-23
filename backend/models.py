from __future__ import annotations

from datetime import datetime, timezone

from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import JSON, Boolean, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

db = SQLAlchemy()


class Card(db.Model):
    """Registered RFID cards (hex UID)."""

    __tablename__ = "cards"

    uid: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_name: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    def to_dict(self) -> dict:
        return {
            "uid": self.uid,
            "owner_name": self.owner_name,
            "is_active": self.is_active,
        }


class CardInteraction(db.Model):
    """
    Every time a UID is seen (card check or device log with uid).
    `name` is the registrant name if the card exists in `cards`, else NULL (unknown).
    Timestamps are server-side only.
    """

    __tablename__ = "card_interactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    uid: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    interaction_name: Mapped[str | None] = mapped_column("name", String(255), nullable=True)

    def to_dict(self) -> dict:
        created = self.created_at
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        return {
            "id": self.id,
            "uid": self.uid,
            "created_at": created.isoformat(),
            "name": self.interaction_name,
        }


class DeviceLog(db.Model):
    """Device-facing log rows (Arduino). Maps to table `logs`."""

    __tablename__ = "logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    uid: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    resolved_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    success: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        index=True,
    )

    def to_dict(self) -> dict:
        created = self.created_at
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        return {
            "id": self.id,
            "event_type": self.event_type,
            "uid": self.uid,
            "resolved_name": self.resolved_name,
            "success": self.success,
            "created_at": created.isoformat(),
        }


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
