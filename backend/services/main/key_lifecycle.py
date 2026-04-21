"""
Key lifecycle: time-based removal of compliance MEK, soft-deleted DM keys, and edit history.

Uses MESSAGE_RETENTION_DAYS from the environment (see services.shared.message_retention).
"""

import logging
from datetime import datetime
from sqlalchemy import or_
from sqlalchemy.orm import Session

from .models import DMEnvelope, DMReaction, DMFile, MessageEditHistory, DMEditHistory

logger = logging.getLogger("uvicorn.error")


def _is_empty_wrapped_key(value: str | None) -> bool:
    return value in (None, "")


def _is_decryptable_keyless(dm_envelope: DMEnvelope) -> bool:
    return (
        _is_empty_wrapped_key(dm_envelope.sender_wrapped_mek_b64)
        and _is_empty_wrapped_key(dm_envelope.recipient_wrapped_mek_b64)
        and _is_empty_wrapped_key(dm_envelope.compliance_wrapped_mek_b64)
    )


def _delete_dm_envelopes_and_related(db: Session, envelope_ids: list[int]) -> int:
    if not envelope_ids:
        return 0

    unique_ids = list(dict.fromkeys(envelope_ids))
    deleted_reactions = db.query(DMReaction).filter(
        DMReaction.dm_envelope_id.in_(unique_ids)
    ).delete(synchronize_session=False)
    deleted_files = db.query(DMFile).filter(DMFile.message_id.in_(unique_ids)).delete(synchronize_session=False)
    deleted_dm_edits = db.query(DMEditHistory).filter(
        or_(
            DMEditHistory.message_id.in_(unique_ids),
            DMEditHistory.dm_envelope_id.in_(unique_ids),
        )
    ).delete(synchronize_session=False)
    deleted_messages = db.query(DMEnvelope).filter(
        DMEnvelope.id.in_(unique_ids)
    ).delete(synchronize_session=False)

    logger.info(
        "Purging %s keyless DM envelopes. reactions=%s files=%s edit_history_rows=%s",
        deleted_messages,
        deleted_reactions,
        deleted_files,
        deleted_dm_edits,
    )

    return deleted_messages


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


def destroy_message_keys_for_user(db: Session, user_id: int, *, commit: bool = True) -> int:
    try:
        envelopes = db.query(DMEnvelope).filter(
            (DMEnvelope.sender_id == user_id) | (DMEnvelope.recipient_id == user_id)
        ).all()

        destroyed_count = 0
        for envelope in envelopes:
            if envelope.sender_id == user_id and envelope.sender_wrapped_mek_b64 not in (None, ""):
                envelope.sender_wrapped_mek_b64 = ""
                destroyed_count += 1
            if envelope.recipient_id == user_id and envelope.recipient_wrapped_mek_b64 not in (None, ""):
                envelope.recipient_wrapped_mek_b64 = ""
                destroyed_count += 1

        if destroyed_count > 0 and commit:
            db.commit()
            logger.info(
                "Destroyed sender/recipient keys that belonged to user %s in %s DM envelopes (%s keys)",
                len(envelopes),
                destroyed_count,
                user_id,
            )

        return destroyed_count

    except Exception as e:
        logger.error("Failed to destroy sender/recipient keys for user %s: %s", user_id, e)
        db.rollback()
        return 0


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
        keyless_message_ids: list[int] = []

        for message in expired_messages:
            if not _is_empty_wrapped_key(message.sender_wrapped_mek_b64):
                message.sender_wrapped_mek_b64 = ""
                keys_destroyed += 1
            if not _is_empty_wrapped_key(message.recipient_wrapped_mek_b64):
                message.recipient_wrapped_mek_b64 = ""
                keys_destroyed += 1

            logger.debug(
                "Destroyed keys for soft-deleted message id=%s (deleted %s)",
                message.id,
                message.deleted_at.isoformat(),
            )

            if _is_decryptable_keyless(message):
                keyless_message_ids.append(message.id)

        if keyless_message_ids:
            deleted_messages = _delete_dm_envelopes_and_related(db, keyless_message_ids)
        else:
            deleted_messages = 0

        db.commit()
        logger.info(
            "Message key cleanup: destroyed %s keys across %s messages; purged %s keyless messages",
            keys_destroyed,
            len(expired_messages),
            deleted_messages,
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
