"""
Key Lifecycle Management for Compliance and Security.

This module handles automatic destruction of compliance keys, selective key destruction
on message deletion, and configurable retention policies for cryptographic keys.

Key Features:
- Automatic compliance key destruction (default: 6 months)
- Selective key destruction on message deletion (default: 6 months)
- Configurable retention policies
- Background cleanup jobs for expired keys
"""

import logging
import os
from datetime import datetime, timedelta
from typing import List, Optional
from sqlalchemy.orm import Session

from ..main.models import DMEnvelope, MessageEditHistory, DMEditHistory
from .encryption import generate_nonce, TRANSPORT_NONCE_SIZE

logger = logging.getLogger("uvicorn.error")

# Default retention periods (in days)
DEFAULT_COMPLIANCE_KEY_RETENTION_DAYS = 180  # 6 months
DEFAULT_MESSAGE_KEY_RETENTION_DAYS = 180     # 6 months for deleted messages

# Environment variable overrides
COMPLIANCE_KEY_RETENTION_DAYS = int(os.getenv("COMPLIANCE_KEY_RETENTION_DAYS", DEFAULT_COMPLIANCE_KEY_RETENTION_DAYS))
MESSAGE_KEY_RETENTION_DAYS = int(os.getenv("MESSAGE_KEY_RETENTION_DAYS", DEFAULT_MESSAGE_KEY_RETENTION_DAYS))


def get_compliance_key_retention_period() -> timedelta:
    """Get the retention period for compliance keys."""
    return timedelta(days=COMPLIANCE_KEY_RETENTION_DAYS)


def get_message_key_retention_period() -> timedelta:
    """Get the retention period for message keys after deletion."""
    return timedelta(days=MESSAGE_KEY_RETENTION_DAYS)


def destroy_compliance_keys_for_message(db: Session, message_id: int) -> int:
    """
    Destroy compliance keys for a specific message.

    This removes the compliance_wrapped_mek_b64 from DM envelopes,
    making the message permanently inaccessible for compliance purposes.

    Args:
        db: Database session
        message_id: ID of the message to destroy compliance keys for

    Returns:
        Number of envelopes affected
    """
    try:
        # Find all DM envelopes for this message
        envelopes = db.query(DMEnvelope).filter(DMEnvelope.id == message_id).all()

        destroyed_count = 0
        for envelope in envelopes:
            if envelope.compliance_wrapped_mek_b64:
                envelope.compliance_wrapped_mek_b64 = None
                destroyed_count += 1

        if destroyed_count > 0:
            db.commit()
            logger.info(f"Destroyed compliance keys for {destroyed_count} DM envelopes (message_id={message_id})")

        return destroyed_count

    except Exception as e:
        logger.error(f"Failed to destroy compliance keys for message {message_id}: {e}")
        db.rollback()
        return 0


def destroy_compliance_keys_for_dm_envelope(db: Session, dm_envelope_id: int) -> bool:
    """
    Destroy compliance key for a specific DM envelope.

    Args:
        db: Database session
        dm_envelope_id: ID of the DM envelope

    Returns:
        True if key was destroyed, False otherwise
    """
    try:
        envelope = db.query(DMEnvelope).filter(DMEnvelope.id == dm_envelope_id).first()
        if envelope and envelope.compliance_wrapped_mek_b64:
            envelope.compliance_wrapped_mek_b64 = None
            db.commit()
            logger.info(f"Destroyed compliance key for DM envelope {dm_envelope_id}")
            return True
        return False

    except Exception as e:
        logger.error(f"Failed to destroy compliance key for DM envelope {dm_envelope_id}: {e}")
        db.rollback()
        return False


def cleanup_expired_compliance_keys(db: Session) -> int:
    """
    Clean up expired compliance keys based on retention policy.

    This removes compliance_wrapped_mek_b64 from DM envelopes that are older
    than the retention period, making them permanently inaccessible for compliance.

    Args:
        db: Database session

    Returns:
        Number of keys destroyed
    """
    try:
        cutoff_date = datetime.now() - get_compliance_key_retention_period()

        # Find DM envelopes older than retention period that still have compliance keys
        expired_envelopes = db.query(DMEnvelope).filter(
            DMEnvelope.timestamp < cutoff_date,
            DMEnvelope.compliance_wrapped_mek_b64.isnot(None)
        ).all()

        destroyed_count = 0
        for envelope in expired_envelopes:
            envelope.compliance_wrapped_mek_b64 = None
            destroyed_count += 1

        if destroyed_count > 0:
            db.commit()
            logger.info(f"Cleaned up {destroyed_count} expired compliance keys (retention: {COMPLIANCE_KEY_RETENTION_DAYS} days)")

        return destroyed_count

    except Exception as e:
        logger.error(f"Failed to cleanup expired compliance keys: {e}")
        db.rollback()
        return 0


def cleanup_expired_message_keys(db: Session) -> int:
    """
    Clean up message keys for deleted messages after retention period.

    This removes sender and recipient wrapped keys from DM envelopes that have been
    soft-deleted and are past the retention period, making them completely inaccessible
    except through compliance access (which preserves the compliance key).

    Args:
        db: Database session

    Returns:
        Number of keys destroyed
    """
    try:
        from datetime import datetime, timedelta
        from ..main.models import DMEnvelope

        # Calculate cutoff date for expired messages
        cutoff_date = datetime.now() - get_message_key_retention_period()

        # Find soft-deleted messages past retention period
        expired_messages = db.query(DMEnvelope).filter(
            DMEnvelope.deleted_at.is_not(None),
            DMEnvelope.deleted_at < cutoff_date
        ).all()

        if not expired_messages:
            logger.info("Message key cleanup: No expired deleted messages to process")
            return 0

        keys_destroyed = 0

        for message in expired_messages:
            # Destroy sender and recipient keys (compliance key remains for legal access)
            message.sender_wrapped_mek_b64 = ""
            message.recipient_wrapped_mek_b64 = ""
            keys_destroyed += 2

            logger.info(
                "Destroyed keys for soft-deleted message id=%s (deleted %s)",
                message.id,
                message.deleted_at.isoformat()
            )

        db.commit()
        logger.info("Message key cleanup: Destroyed %d keys across %d messages",
                   keys_destroyed, len(expired_messages))

        return keys_destroyed

    except Exception as e:
        logger.error(f"Failed to cleanup expired message keys: {e}")
        db.rollback()
        return 0


def cleanup_expired_edit_history(db: Session) -> int:
    """
    Clean up old edit history entries based on retention policy.

    This removes edit history entries that are older than the compliance
    retention period.

    Args:
        db: Database session

    Returns:
        Number of edit history entries removed
    """
    try:
        cutoff_date = datetime.now() - get_compliance_key_retention_period()

        # Clean up public message edit history
        public_deleted = db.query(MessageEditHistory).filter(
            MessageEditHistory.edited_at < cutoff_date
        ).delete(synchronize_session=False)

        # Clean up DM edit history
        dm_deleted = db.query(DMEditHistory).filter(
            DMEditHistory.edited_at < cutoff_date
        ).delete(synchronize_session=False)

        total_deleted = public_deleted + dm_deleted

        if total_deleted > 0:
            db.commit()
            logger.info(f"Cleaned up {total_deleted} expired edit history entries (retention: {COMPLIANCE_KEY_RETENTION_DAYS} days)")

        return total_deleted

    except Exception as e:
        logger.error(f"Failed to cleanup expired edit history: {e}")
        db.rollback()
        return 0


def run_key_lifecycle_cleanup(db: Session) -> dict:
    """
    Run all key lifecycle cleanup operations.

    This should be called periodically (e.g., daily) to maintain key lifecycle policies.

    Args:
        db: Database session

    Returns:
        Dict with cleanup statistics
    """
    logger.info("Starting key lifecycle cleanup")

    stats = {
        "compliance_keys_destroyed": cleanup_expired_compliance_keys(db),
        "message_keys_destroyed": cleanup_expired_message_keys(db),
        "edit_history_entries_removed": cleanup_expired_edit_history(db),
        "timestamp": datetime.now().isoformat()
    }

    logger.info(f"Key lifecycle cleanup completed: {stats}")
    return stats


def get_key_lifecycle_config() -> dict:
    """
    Get current key lifecycle configuration.

    Returns:
        Dict with current configuration values
    """
    return {
        "compliance_key_retention_days": COMPLIANCE_KEY_RETENTION_DAYS,
        "message_key_retention_days": MESSAGE_KEY_RETENTION_DAYS,
        "default_compliance_retention": DEFAULT_COMPLIANCE_KEY_RETENTION_DAYS,
        "default_message_retention": DEFAULT_MESSAGE_KEY_RETENTION_DAYS
    }