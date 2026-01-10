import json
import logging
import os
from typing import List, Optional
from sqlalchemy.orm import Session
from pywebpush import webpush, WebPushException
from .models import PushSubscription, User, Message, DMEnvelope, FcmToken
import firebase_admin
from firebase_admin import credentials as firebase_credentials
from firebase_admin import messaging as firebase_messaging
import base64

logger = logging.getLogger("uvicorn.error")

class PushNotificationService:
    def __init__(self):
        self.vapid_private_key = os.getenv("VAPID_PRIVATE_KEY")
        self.vapid_public_key = os.getenv("VAPID_PUBLIC_KEY")
        # Firebase Admin initialization (modern API). Only FIREBASE_CERT env is supported.
        self.firebase_initialized = False
        try:
            firebase_cert = os.getenv("FIREBASE_CERT")
            if not firebase_cert:
                raise RuntimeError("FIREBASE_CERT env variable is required for Firebase Admin SDK initialization")

            # Support raw JSON or base64-encoded JSON in FIREBASE_CERT
            decoded = base64.b64decode(firebase_cert).decode("utf-8")
            sa_dict = json.loads(decoded)

            cred = firebase_credentials.Certificate(sa_dict)
            firebase_admin.initialize_app(cred)
            self.firebase_initialized = True
            logger.info("Firebase Admin SDK initialized for push sending (FIREBASE_CERT)")
        except Exception as e:
            logger.error(f"Failed to initialize Firebase Admin SDK from FIREBASE_CERT: {e}")
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
        try:
            # Get all users except the sender
            users = db.query(User).filter(User.id != message.user_id)
            if exclude_user_id:
                users = users.filter(User.id != exclude_user_id)

            for user in users:
                # Check if user has push subscription before trying to send
                # Try all FCM tokens first (Android). If none or all fail, fall back to web push subscription.
                fcm_rows = db.query(FcmToken).filter(FcmToken.user_id == user.id).all()
                payload_data = {
                    "type": "public_message",
                    "message_id": message.id,
                    "sender_id": message.user_id,
                    "sender_username": message.author.username
                }
                title = f"{message.author.username}"
                body = message.content[:100] + ("..." if len(message.content) > 100 else "")

                if fcm_rows and self.firebase_initialized:
                    for fcm in fcm_rows:
                        try:
                            self._send_fcm_to_token(fcm.token, title, body, payload_data)
                        except Exception as e:
                            logger.error(f"Failed to send FCM to user {user.id} token {fcm.token}: {e}")
                            # Check if this is a permanent failure and clean up the token
                            self._cleanup_failed_fcm_token(db, fcm, str(e))

                subscription = db.query(PushSubscription).filter(PushSubscription.user_id == user.id).first()
                if subscription:
                    await self._send_notification_to_user(
                        db, user.id, title, body, message.author.profile_picture, payload_data
                    )
        except Exception as e:
            logger.error(f"Failed to send public message notifications: {e}")

    async def send_dm_notification(self, db: Session, dm_envelope: DMEnvelope, sender: User):
        """Send push notification for a new DM"""
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
            if fcm_rows and self.firebase_initialized:
                for fcm in fcm_rows:
                    try:
                        self._send_fcm_to_token(fcm.token, title, body, payload_data)
                    except Exception as e:
                        logger.error(f"Failed to send FCM to user {dm_envelope.recipient_id} token {fcm.token}: {e}")
                        # Check if this is a permanent failure and clean up the token
                        self._cleanup_failed_fcm_token(db, fcm, str(e))

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
            
        except WebPushException as e:
            logger.error(f"WebPush error for user {user_id}: {e}")
            # If the subscription is invalid, remove it
            if hasattr(e, 'response') and e.response and e.response.status_code in [410, 404]:
                db.query(PushSubscription).filter(PushSubscription.user_id == user_id).delete()
                db.commit()
        except Exception as e:
            logger.error(f"Failed to send push notification to user {user_id}: {e}")

    def _send_fcm_to_token(self, token: str, title: str, body: str, data: dict):
        """Send an FCM data-only push to a single device token using Firebase Admin SDK.
        Notification display is handled by the app, not FCM."""
        if not self.firebase_initialized:
            raise RuntimeError("Firebase Admin SDK not initialized (FIREBASE_CERT required)")

        try:
            # Send only data payload - let the app handle notification display
            # This prevents FCM from auto-showing notifications
            msg = firebase_messaging.Message(
                token=token,
                data={
                    "title": title,
                    "body": body,
                    **{k: str(v) for k, v in (data or {}).items()}
                },
                android=firebase_messaging.AndroidConfig(priority="high"),
                apns=firebase_messaging.APNSConfig(headers={"apns-priority": "10"})
            )
            resp = firebase_messaging.send(msg)
            return resp
        except Exception as e:
            logger.error(f"Firebase Admin send failed for token {token}: {e}")
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
                logger.info(f"Removing permanently failed FCM token for user {fcm_token_entry.user_id}: {fcm_token_entry.token}")
                db.query(FcmToken).filter(FcmToken.id == fcm_token_entry.id).delete()
                db.commit()
            else:
                logger.debug(f"Temporary FCM failure for token {fcm_token_entry.token}, keeping token: {error_message}")
        except Exception as e:
            logger.error(f"Failed to cleanup FCM token {fcm_token_entry.token}: {e}")
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
