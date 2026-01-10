from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey, inspect, null, text, UniqueConstraint
from sqlalchemy.orm import relationship
from datetime import datetime
from pydantic import BaseModel

Base = declarative_base()


# Модели базы данных
class User(Base):
    __tablename__ = "user"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    display_name = Column(String(64), nullable=False)
    password_hash = Column(String(200), nullable=False)
    profile_picture = Column(String(255), nullable=True)
    bio = Column(Text, nullable=True)
    online = Column(Boolean, default=False)
    last_seen = Column(DateTime, default=datetime.now)
    created_at = Column(DateTime, default=datetime.now)
    verified = Column(Boolean, default=False)
    suspended = Column(Boolean, default=False)
    suspension_reason = Column(Text, nullable=True)
    deleted = Column(Boolean, default=False)
    messages = relationship("Message", back_populates="author", lazy="select")


class Message(Base):
    __tablename__ = "message"

    id = Column(Integer, primary_key=True, index=True)
    content = Column(Text, nullable=False)
    timestamp = Column(DateTime, default=datetime.now)
    user_id = Column(Integer, ForeignKey("user.id"), nullable=False)
    is_read = Column(Boolean, default=False)
    reply_to_id = Column(Integer, ForeignKey("message.id"), nullable=True)
    is_edited = Column(Boolean, default=False)

    author = relationship("User", back_populates="messages")
    reply_to = relationship("Message", remote_side=[id])
    files = relationship("MessageFile", back_populates="message", cascade="all, delete-orphan", lazy="select")
    reactions = relationship("Reaction", cascade="all, delete-orphan", lazy="select")


class MessageFile(Base):
    __tablename__ = "message_file"

    id = Column(Integer, primary_key=True, index=True)
    message_id = Column(Integer, ForeignKey("message.id"), nullable=False, index=True)
    path = Column(Text, nullable=False)
    name = Column(Text, nullable=False)

    message = relationship("Message", back_populates="files")


class CryptoPublicKey(Base):
    __tablename__ = "crypto_public_key"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("user.id"), nullable=False, unique=True)
    public_key_b64 = Column(Text, nullable=False)


class CryptoBackup(Base):
    __tablename__ = "crypto_backup"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("user.id"), nullable=False, unique=True)
    blob_json = Column(Text, nullable=False)


class DMEnvelope(Base):
    __tablename__ = "dm_envelope"

    id = Column(Integer, primary_key=True, index=True)
    sender_id = Column(Integer, ForeignKey("user.id"), nullable=False)
    recipient_id = Column(Integer, ForeignKey("user.id"), nullable=False)
    iv_b64 = Column(Text, nullable=False)
    ciphertext_b64 = Column(Text, nullable=False)
    sender_wrapped_mek_b64 = Column(Text, nullable=False)
    recipient_wrapped_mek_b64 = Column(Text, nullable=False)
    compliance_wrapped_mek_b64 = Column(Text, nullable=True)
    reply_to_id = Column(Integer, nullable=True)
    timestamp = Column(DateTime, default=datetime.now)
    is_edited = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.now)
    files = relationship("DMFile", back_populates="message", cascade="all, delete-orphan", lazy="select")
    reactions = relationship("DMReaction", cascade="all, delete-orphan", lazy="select")


class DMFile(Base):
    __tablename__ = "dm_file"

    id = Column(Integer, primary_key=True, index=True)
    message_id = Column(Integer, ForeignKey("dm_envelope.id"), nullable=False, index=True)
    sender_id = Column(Integer, ForeignKey("user.id"), nullable=False)
    recipient_id = Column(Integer, ForeignKey("user.id"), nullable=False)
    name = Column(Text, nullable=False)
    path = Column(Text, nullable=False)
    nonce_b64 = Column(Text, nullable=True)        # Nonce for this file's decryption

    message = relationship("DMEnvelope", back_populates="files")


class PushSubscription(Base):
    __tablename__ = "push_subscription"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("user.id"), nullable=False)
    endpoint = Column(Text, nullable=False)
    p256dh_key = Column(Text, nullable=False)
    auth_key = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


class FcmToken(Base):
    __tablename__ = "fcm_token"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("user.id"), nullable=False, index=True)
    token = Column(Text, nullable=False, unique=True)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


class Reaction(Base):
    __tablename__ = "reaction"

    id = Column(Integer, primary_key=True, index=True)
    message_id = Column(Integer, ForeignKey("message.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("user.id"), nullable=False)
    emoji = Column(String(10), nullable=False)  # Store emoji as string
    timestamp = Column(DateTime, default=datetime.now)
    
    # Relationships
    user = relationship("User")
    
    # Ensure unique combination of message, user, and emoji
    __table_args__ = (UniqueConstraint('message_id', 'user_id', 'emoji', name='unique_reaction'),)


class DMReaction(Base):
    __tablename__ = "dm_reaction"

    id = Column(Integer, primary_key=True, index=True)
    dm_envelope_id = Column(Integer, ForeignKey("dm_envelope.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("user.id"), nullable=False)
    emoji = Column(String(10), nullable=False)  # Store emoji as string
    timestamp = Column(DateTime, default=datetime.now)
    
    # Relationships
    user = relationship("User")
    dm_envelope = relationship("DMEnvelope", overlaps="reactions")
    
    # Ensure unique combination of dm_envelope, user, and emoji
    __table_args__ = (UniqueConstraint('dm_envelope_id', 'user_id', 'emoji', name='unique_dm_reaction'),)


# Tracks authenticated device sessions per user
class DeviceSession(Base):
    __tablename__ = "device_session"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("user.id"), nullable=False, index=True)

    # Raw User-Agent for reference/debugging
    raw_user_agent = Column(Text, nullable=True)

    # Parsed fields
    device_name = Column(String(128), nullable=True)
    device_type = Column(String(32), nullable=True)  # desktop/mobile/tablet/bot/unknown
    os_name = Column(String(64), nullable=True)
    os_version = Column(String(64), nullable=True)
    browser_name = Column(String(64), nullable=True)
    browser_version = Column(String(64), nullable=True)
    brand = Column(String(64), nullable=True)
    model = Column(String(64), nullable=True)

    # Session identity embedded into JWTs
    session_id = Column(String(64), unique=True, nullable=False, index=True)

    # Lifecycle
    created_at = Column(DateTime, default=datetime.now)
    last_seen = Column(DateTime, default=datetime.now)
    revoked = Column(Boolean, default=False)

    # Relationship back to user (optional lazy to avoid heavy loads)
    user = relationship("User", lazy="select")

# Pydantic модели
class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str
    display_name: str
    password: str
    confirm_password: str


class ChangePasswordRequest(BaseModel):
    currentPasswordDerived: str
    newPasswordDerived: str
    logoutAllExceptCurrent: bool = False


class SendMessageRequest(BaseModel):
    content: str
    reply_to_id: int | None = None


class EditMessageRequest(BaseModel):
    content: str


class DeleteMessageRequest(BaseModel):
    message_id: int


class MessageEditHistoryResponse(BaseModel):
    """Response model for message edit history (compliance access only)."""
    id: int
    message_id: int
    previous_content: str
    edited_at: datetime
    edited_by_username: str
    edited_by_user_id: int

    class Config:
        from_attributes = True


class DMEditHistoryResponse(BaseModel):
    """Response model for DM edit history (compliance access only)."""
    id: int
    dm_envelope_id: int
    previous_ciphertext_b64: str
    previous_iv_b64: str
    previous_sender_wrapped_mek_b64: str
    previous_recipient_wrapped_mek_b64: str
    previous_compliance_wrapped_mek_b64: str
    edited_at: str
    edited_by_username: str
    edited_by_user_id: int

    class Config:
        from_attributes = True


class UpdateBioRequest(BaseModel):
    bio: str


class PushSubscriptionRequest(BaseModel):
    endpoint: str
    keys: dict


class UserProfileResponse(BaseModel):
    id: int
    username: str
    display_name: str
    profile_picture: str | None
    bio: str | None
    online: bool
    last_seen: datetime | None
    created_at: datetime | None
    verified: bool
    suspended: bool
    suspension_reason: str | None
    deleted: bool

    class Config:
        from_attributes = True


class MessageResponse(BaseModel):
    id: int
    content: str
    timestamp: datetime
    is_author: bool
    is_read: bool
    username: str
    profile_picture: str | None

    class Config:
        from_attributes = True


class ReactionRequest(BaseModel):
    message_id: int
    emoji: str


class ReactionResponse(BaseModel):
    id: int
    message_id: int
    user_id: int
    emoji: str
    timestamp: datetime
    username: str

    class Config:
        from_attributes = True


class DMReactionRequest(BaseModel):
    dm_envelope_id: int
    emoji: str


class DMReactionResponse(BaseModel):
    id: int
    dm_envelope_id: int
    user_id: int
    emoji: str
    timestamp: datetime
    username: str

    class Config:
        from_attributes = True


class UpdateLog(Base):
    """Stores update sequence numbers and updates for gap detection"""
    __tablename__ = "update_log"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("user.id"), nullable=False, index=True)
    sequence = Column(Integer, nullable=False, index=True)
    updates = Column(Text, nullable=False)  # JSON array of updates
    timestamp = Column(DateTime, default=datetime.now, index=True)

    __table_args__ = (
        UniqueConstraint("user_id", "sequence", name="uq_user_sequence"),
    )


class MessageEditHistory(Base):
    """Stores complete edit history for public messages in compliance storage only.

    This table maintains the full history of all edits made to public messages.
    Regular users never see this data - they only see the latest version with
    an edit indicator. Compliance officers can access the full history.
    """
    __tablename__ = "message_edit_history"

    id = Column(Integer, primary_key=True, index=True)
    message_id = Column(Integer, ForeignKey("message.id"), nullable=False, index=True)
    previous_content = Column(Text, nullable=False)  # Content before this edit
    edited_at = Column(DateTime, default=datetime.now, nullable=False, index=True)
    edited_by_user_id = Column(Integer, ForeignKey("user.id"), nullable=False, index=True)

    # Relationships
    message = relationship("Message")


class DMEditHistory(Base):
    """Stores complete edit history for DM messages in compliance storage only.

    This table maintains the full history of all edits made to DM messages.
    Regular users never see this data - they only see the latest version with
    an edit indicator. Compliance officers can access the full history.
    """
    __tablename__ = "dm_edit_history"

    id = Column(Integer, primary_key=True, index=True)
    message_id = Column(Integer, ForeignKey("dm_envelope.id"), nullable=False, index=True)
    dm_envelope_id = Column(Integer, ForeignKey("dm_envelope.id"), nullable=False)  # Match existing DB schema
    previous_ciphertext_b64 = Column(Text, nullable=False)  # Encrypted content before this edit
    previous_iv_b64 = Column(Text, nullable=False)  # IV for previous content
    previous_sender_wrapped_mek_b64 = Column(Text, nullable=False)  # MEK wrapped for sender before edit
    previous_recipient_wrapped_mek_b64 = Column(Text, nullable=False)  # MEK wrapped for recipient before edit
    previous_compliance_wrapped_mek_b64 = Column(Text, nullable=False)  # MEK wrapped for compliance before edit
    edited_at = Column(DateTime, default=datetime.now, nullable=False, index=True)
    edited_by = Column(Integer, ForeignKey("user.id"), nullable=False)  # Match existing DB schema
    edited_by_user_id = Column(Integer, ForeignKey("user.id"), nullable=False)  # Match existing DB schema

    # Relationships
    dm_envelope = relationship("DMEnvelope", foreign_keys=[message_id])


# Tables are now created through Alembic migrations
# Base.metadata.create_all(bind=engine)