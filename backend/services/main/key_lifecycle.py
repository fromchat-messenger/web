"""
Key lifecycle: time-based removal of compliance MEK, soft-deleted DM keys, and edit history.

Uses MESSAGE_RETENTION_DAYS from the environment (see services.shared.message_retention).
"""

import logging
from datetime import datetime
from sqlalchemy.orm import Session

from .models import DMEnvelope, MessageEditHistory, DMEditHistory

logger = logging.getLogger("uvicorn.error")


def _retention_timedelta_or_skip():
    try:
        from services.shared.message_retention import get_message_retention
    except ImportError:
        from backend.services.shared.message_retention import get_message_retention  # type: ignore
    r = get_message_retention()
    if not r.cleanup_enabled():
        return None
    return r.retention_timedelta()


def destroy_compliance_keys_for_message(db: Session, message_id: int) -> int:
    try:
        envelopes = db.query(DMEnvelope).filter(DMEnvelope.id == message_id).all()

        destroyed_count = 0
        for envelope in envelopes:
            if envelope.compliance_wrapped_mek_b64:
                envelope.compliance_wrapped_mek_b64 = None
                destroyed_count += 1

        if destroyed_count > 0:
            db.commit()
            logger.info(
                "Destroyed compliance keys for %s DM envelopes (message_id=%s)",
                destroyed_count,
                message_id,
            )

        return destroyed_count

    except Exception as e:
        logger.error("Failed to destroy compliance keys for message %s: %s", message_id, e)
        db.rollback()
        return 0


def destroy_compliance_keys_for_dm_envelope(db: Session, dm_envelope_id: int) -> bool:
    try:
        envelope = db.query(DMEnvelope).filter(DMEnvelope.id == dm_envelope_id).first()
        if envelope and envelope.compliance_wrapped_mek_b64:
            envelope.compliance_wrapped_mek_b64 = None
            db.commit()
            logger.info("Destroyed compliance key for DM envelope %s", dm_envelope_id)
            return True
        return False

    except Exception as e:
        logger.error("Failed to destroy compliance key for DM envelope %s: %s", dm_envelope_id, e)
        db.rollback()
        return False


def cleanup_expired_compliance_keys(db: Session) -> int:
    delta = _retention_timedelta_or_skip()
    if delta is None:
        return 0

    try:
        cutoff_date = datetime.now() - delta

        expired_envelopes = db.query(DMEnvelope).filter(
            DMEnvelope.timestamp < cutoff_date,
            DMEnvelope.compliance_wrapped_mek_b64.isnot(None),
        ).all()

        destroyed_count = 0
        for envelope in expired_envelopes:
            envelope.compliance_wrapped_mek_b64 = None
            destroyed_count += 1

        if destroyed_count > 0:
            db.commit()
            logger.info("Cleaned up %s expired compliance MEK fields", destroyed_count)

        return destroyed_count

    except Exception as e:
        logger.error("Failed to cleanup expired compliance keys: %s", e)
        db.rollback()
        return 0


def cleanup_expired_message_keys(db: Session) -> int:
    delta = _retention_timedelta_or_skip()
    if delta is None:
        return 0

    try:
        cutoff_date = datetime.now() - delta

        expired_messages = db.query(DMEnvelope).filter(
            DMEnvelope.deleted_at.is_not(None),
            DMEnvelope.deleted_at < cutoff_date,
        ).all()

        if not expired_messages:
            return 0

        keys_destroyed = 0

        for message in expired_messages:
            message.sender_wrapped_mek_b64 = ""
            message.recipient_wrapped_mek_b64 = ""
            keys_destroyed += 2

            logger.debug(
                "Destroyed keys for soft-deleted message id=%s (deleted %s)",
                message.id,
                message.deleted_at.isoformat(),
            )

        db.commit()
        logger.info(
            "Message key cleanup: destroyed %s keys across %s messages",
            keys_destroyed,
            len(expired_messages),
        )

        return keys_destroyed

    except Exception as e:
        logger.error("Failed to cleanup expired message keys: %s", e)
        db.rollback()
        return 0


def cleanup_expired_edit_history(db: Session) -> int:
    delta = _retention_timedelta_or_skip()
    if delta is None:
        return 0

    try:
        cutoff_date = datetime.now() - delta

        public_deleted = db.query(MessageEditHistory).filter(
            MessageEditHistory.edited_at < cutoff_date
        ).delete(synchronize_session=False)

        dm_deleted = db.query(DMEditHistory).filter(
            DMEditHistory.edited_at < cutoff_date
        ).delete(synchronize_session=False)

        total_deleted = public_deleted + dm_deleted

        if total_deleted > 0:
            db.commit()
            logger.info("Cleaned up %s expired edit history entries", total_deleted)

        return total_deleted

    except Exception as e:
        logger.error("Failed to cleanup expired edit history: %s", e)
        db.rollback()
        return 0


def run_key_lifecycle_cleanup(db: Session) -> dict:
    stats = {
        "compliance_keys_destroyed": cleanup_expired_compliance_keys(db),
        "message_keys_destroyed": cleanup_expired_message_keys(db),
        "edit_history_entries_removed": cleanup_expired_edit_history(db),
        "timestamp": datetime.now().isoformat(),
    }

    if (
        stats["compliance_keys_destroyed"]
        or stats["message_keys_destroyed"]
        or stats["edit_history_entries_removed"]
    ):
        logger.info("Key lifecycle cleanup completed: %s", stats)
    return stats


def get_key_lifecycle_config() -> dict:
    try:
        from services.shared.message_retention import get_message_retention
    except ImportError:
        from backend.services.shared.message_retention import get_message_retention  # type: ignore
    r = get_message_retention()
    return {
        "message_retention_days": r.days,
        "cleanup_enabled": r.cleanup_enabled(),
        "never_store_compliance_mek": r.never_store_compliance_mek(),
    }
