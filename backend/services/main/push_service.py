import json
import logging
import os
from pathlib import Path
from typing import List, Optional
from sqlalchemy.orm import Session
from pywebpush import webpush, WebPushException
from .models import PushSubscription, User, Message, DMEnvelope, FcmToken
import firebase_admin
from firebase_admin import credentials as firebase_credentials
from firebase_admin import messaging as firebase_messaging

logger = logging.getLogger("uvicorn.error")

# backend/firebase-cert.json — fixed path; Docker bind-mounts this file to /app/firebase-cert.json
_FIREBASE_CERT_PATH = Path(__file__).resolve().parents[2] / "firebase-cert.json"


def _load_firebase_service_account_dict(cert_path: Path) -> dict:
    """Load Firebase service account JSON from ``cert_path`` (must exist)."""
    cert_path = cert_path.resolve()
    if not cert_path.is_file():
        raise FileNotFoundError(
            f"Firebase credentials file missing or not a file: {cert_path} (expected backend/firebase-cert.json)"
        )

    with cert_path.open(encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict) or data.get("type") != "service_account":
        raise ValueError("Firebase credentials file must be a service account JSON object")
    return data


class PushNotificationService:
    def _short_token(self, token: str) -> str:
        value = (token or "").strip()
        if len(value) <= 14:
            return value
        return f"...{value[-8:]}"

    def __init__(self):
        self.vapid_private_key = os.getenv("VAPID_PRIVATE_KEY")
        self.vapid_public_key = os.getenv("VAPID_PUBLIC_KEY")
        # Firebase Admin is required for main (FCM); cert path is backend/firebase-cert.json.
        self.firebase_initialized = False
        try:
            sa_dict = _load_firebase_service_account_dict(_FIREBASE_CERT_PATH)

            cred = firebase_credentials.Certificate(sa_dict)
            firebase_admin.initialize_app(cred)
            self.firebase_initialized = True
            logger.info("Firebase Admin SDK initialized (%s)", _FIREBASE_CERT_PATH)
        except Exception as e:
            logger.error("Failed to initialize Firebase Admin SDK from %s: %s", _FIREBASE_CERT_PATH, e)
            raise

        if (not self.vapid_public_key) or (not self.vapid_private_key):
            raise ValueError("VAPID public or private key is None")

        self.vapid_claims = {
            "sub": "mailto:support@fromchat.ru",
            "aud": "https://fcm.googleapis.com"
        }

    async def subscribe_user(self, db: Session, user_id: int, endpoint: str, p256dh_key: str, auth_key: str) -> bool:
        """Subscribe a user to push notifications"""
        try:
            # Check if user already has a subscription
            existing_sub = db.query(PushSubscription).filter(PushSubscription.user_id == user_id).first()
            
            if existing_sub:
                # Update existing subscription
                existing_sub.endpoint = endpoint
                existing_sub.p256dh_key = p256dh_key
                existing_sub.auth_key = auth_key
            else:
                # Create new subscription
                new_sub = PushSubscription(
                    user_id=user_id,
                    endpoint=endpoint,
                    p256dh_key=p256dh_key,
                    auth_key=auth_key
                )
                db.add(new_sub)
            
            db.commit()
            logger.info(f"Push subscription saved for user {user_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to save push subscription for user {user_id}: {e}")
            db.rollback()
            return False

    async def send_public_message_notification(self, db: Session, message: Message, exclude_user_id: Optional[int] = None):
        """Send push notification for a new public chat message"""
        logger.info(
            "send_public_message_notification start: message_id=%s sender_id=%s exclude_user=%s",
            message.id,
            message.user_id,
            exclude_user_id,
        )
        try:
            # Get all users except the sender
            users = db.query(User).filter(User.id != message.user_id)
            if exclude_user_id:
                users = users.filter(User.id != exclude_user_id)
            user_list = users.all()
            logger.debug(
                "send_public_message_notification targets=%s",
                [user.id for user in user_list],
            )
            logger.info(
                "send_public_message_notification user_count=%s for message_id=%s",
                len(user_list),
                message.id,
            )

            for user in user_list:
                # Check if user has push subscription before trying to send
                # Try all FCM tokens first (Android). If none or all fail, fall back to web push subscription.
                fcm_rows = db.query(FcmToken).filter(FcmToken.user_id == user.id).all()
                if not fcm_rows:
                    logger.debug("No FCM tokens for user %s for message %s", user.id, message.id)
                payload_data = {
                    "type": "public_message",
                    "message_id": message.id,
                    "sender_id": message.user_id,
                    "sender_username": message.author.username
                }
                title = f"{message.author.username}"
                body = message.content[:100] + ("..." if len(message.content) > 100 else "")
                logger.debug(
                    "send_public_message_notification: user=%s fcm_tokens=%d",
                    user.id,
                    len(fcm_rows),
                )

                if fcm_rows and self.firebase_initialized:
                    for fcm in fcm_rows:
                        try:
                            response = self._send_fcm_to_token(
                                fcm.token,
                                title,
                                body,
                                payload_data,
                            )
                            logger.info(
                                "FCM public push sent user=%s token=%s response=%s",
                                user.id,
                                self._short_token(fcm.token),
                                response,
                            )
                        except Exception as e:
                            logger.error(
                                "Failed to send FCM to user %s token %s: %s",
                                user.id,
                                self._short_token(fcm.token),
                                e,
                            )
                            # Check if this is a permanent failure and clean up the token
                            self._cleanup_failed_fcm_token(db, fcm, str(e))
                if fcm_rows and not self.firebase_initialized:
                    logger.warning(
                        "Firebase SDK not initialized, skipped FCM pushes for message %s",
                        message.id,
                    )

                subscription = db.query(PushSubscription).filter(PushSubscription.user_id == user.id).first()
                if subscription:
                    await self._send_notification_to_user(
                        db, user.id, title, body, message.author.profile_picture, payload_data
                    )
        except Exception as e:
            logger.error(f"Failed to send public message notifications: {e}")

    async def send_dm_notification(self, db: Session, dm_envelope: DMEnvelope, sender: User):
        """Send push notification for a new DM"""
        logger.info(
            "send_dm_notification start: dm_id=%s sender_id=%s recipient=%s",
            dm_envelope.id,
            sender.id,
            dm_envelope.recipient_id,
        )
        try:
            title = f"{sender.username}"
            body = "New direct message"
            payload_data = {
                "type": "dm",
                "dm_id": dm_envelope.id,
                "sender_id": sender.id,
                "sender_username": sender.username
            }

            fcm_rows = db.query(FcmToken).filter(FcmToken.user_id == dm_envelope.recipient_id).all()
            logger.debug(
                "send_dm_notification: recipient=%s fcm_tokens=%d",
                dm_envelope.recipient_id,
                len(fcm_rows),
            )
            if fcm_rows and self.firebase_initialized:
                for fcm in fcm_rows:
                    try:
                        response = self._send_fcm_to_token(
                            fcm.token,
                            title,
                            body,
                            payload_data,
                            include_notification=False,
                        )
                        logger.info(
                            "FCM dm push sent recipient=%s token=%s response=%s",
                            dm_envelope.recipient_id,
                            self._short_token(fcm.token),
                            response,
                        )
                    except Exception as e:
                        logger.error(
                            "Failed to send FCM to user %s token %s: %s",
                            dm_envelope.recipient_id,
                            self._short_token(fcm.token),
                            e,
                        )
                        # Check if this is a permanent failure and clean up the token
                        self._cleanup_failed_fcm_token(db, fcm, str(e))
                if fcm_rows and not self.firebase_initialized:
                    logger.warning(
                        "Firebase SDK not initialized, skipped FCM DM push for dm %s",
                        dm_envelope.id,
                    )

            await self._send_notification_to_user(
                db, dm_envelope.recipient_id, title, body, sender.profile_picture, payload_data
            )
        except Exception as e:
            logger.error(f"Failed to send DM notification: {e}")

    async def _send_notification_to_user(self, db: Session, user_id: int, title: str, body: str, icon: Optional[str], data: dict):
        """Send a push notification to a specific user"""
        try:
            subscription = db.query(PushSubscription).filter(PushSubscription.user_id == user_id).first()
            if not subscription:
                logger.debug("No web push subscription for user %s", user_id)
            if not subscription:
                return

            payload = {
                "title": title,
                "body": body,
                "icon": icon or "about:blank",
                "tag": f"message_{user_id}",
                "data": data
            }

            subscription_info = {
                "endpoint": subscription.endpoint,
                "keys": {
                    "p256dh": subscription.p256dh_key,
                    "auth": subscription.auth_key
                }
            }

            webpush(
                subscription_info=subscription_info,
                data=json.dumps(payload),
                vapid_private_key=self.vapid_private_key,
                vapid_claims=self.vapid_claims
            )
            logger.info("WebPush sent to user=%s", user_id)
            
        except WebPushException as e:
            logger.error(f"WebPush error for user {user_id}: {e}")
            # If the subscription is invalid, remove it
            if hasattr(e, 'response') and e.response and e.response.status_code in [410, 404]:
                db.query(PushSubscription).filter(PushSubscription.user_id == user_id).delete()
                db.commit()
        except Exception as e:
            logger.error(f"Failed to send push notification to user {user_id}: {e}")

    def _send_fcm_to_token(self, token: str, title: str, body: str, data: dict, include_notification: bool = True):
        """Send an FCM push to a single device token using Firebase Admin SDK.

        By default this sends both notification + data payloads, but callers can disable
        the notification payload for custom client-side rendering.
        """
        if not self.firebase_initialized:
            raise RuntimeError("Firebase Admin SDK not initialized")

        try:
            payload = {
                "title": title,
                "body": body,
                **{k: str(v) for k, v in (data or {}).items()}
            }

            if include_notification:
                # Send notification + data payload:
                # notification ensures visibility in system tray when app is background,
                # data keeps app-level handling usable when app is foreground.
                msg = firebase_messaging.Message(
                    token=token,
                    notification=firebase_messaging.Notification(
                        title=title,
                        body=body,
                    ),
                    data=payload,
                    android=firebase_messaging.AndroidConfig(priority="high"),
                    apns=firebase_messaging.APNSConfig(headers={"apns-priority": "10"})
                )
            else:
                # Data-only push for custom client-side rendering.
                msg = firebase_messaging.Message(
                    token=token,
                    data=payload,
                    android=firebase_messaging.AndroidConfig(priority="high"),
                    apns=firebase_messaging.APNSConfig(headers={"apns-priority": "10"})
                )
            resp = firebase_messaging.send(msg)
            logger.debug("Firebase message queued token=%s", self._short_token(token))
            return resp
        except Exception as e:
            logger.error("Firebase Admin send failed for token %s: %s", self._short_token(token), e)
            raise

    def _cleanup_failed_fcm_token(self, db: Session, fcm_token_entry, error_message: str):
        """Clean up FCM tokens that have permanent failures"""
        try:
            # Check for permanent failure indicators in the error message
            permanent_errors = [
                "unregistered", "invalidregistration", "notregistered",
                "sender_id_mismatch", "invalid_argument"
            ]

            error_lower = error_message.lower()
            is_permanent = any(permanent_error in error_lower for permanent_error in permanent_errors)

            if is_permanent:
                logger.info(
                    "Removing permanently failed FCM token for user %s: %s",
                    fcm_token_entry.user_id,
                    self._short_token(fcm_token_entry.token),
                )
                db.query(FcmToken).filter(FcmToken.id == fcm_token_entry.id).delete()
                db.commit()
            else:
                logger.debug(
                    "Temporary FCM failure for token %s, keeping token: %s",
                    self._short_token(fcm_token_entry.token),
                    error_message,
                )
        except Exception as e:
            logger.error(
                "Failed to cleanup FCM token for user %s: %s",
                fcm_token_entry.user_id,
                e,
            )
            try:
                db.rollback()
            except Exception:
                pass

    async def unsubscribe_user(self, db: Session, user_id: int) -> bool:
        """Unsubscribe a user from push notifications"""
        try:
            db.query(PushSubscription).filter(PushSubscription.user_id == user_id).delete()
            db.commit()
            logger.info(f"Push subscription removed for user {user_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to remove push subscription for user {user_id}: {e}")
            db.rollback()
            return False

# Global instance
push_service = PushNotificationService()
