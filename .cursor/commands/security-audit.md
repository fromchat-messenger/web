# Security Audit Command

Perform a comprehensive security audit of the FromChat **Android application** only.

## Project Context

**FromChat Android** is a 100% open source secure messaging mobile application built with:

- Kotlin Multiplatform (KMP) shared code
- Jetpack Compose UI framework
- End-to-End Encryption (NaCl, AES-GCM)
- WebSocket support for real-time features
- LiveKit integration for calls
- Local database storage (SQLite)

## Scope: Android Only

**OUT OF SCOPE:**

- Web backend (Python FastAPI, Caddy infrastructure)
- React/TypeScript frontend

**IN SCOPE:**

- Android app code (`app/android`, `app/shared/src/androidMain`)
- Shared cross-platform code (`app/shared/src/commonMain`)
- Local encryption implementation (NaCl, AES-GCM)
- Secure storage (Android Keystore, encrypted SharedPreferences)
- WebSocket client security
- Permission usage and handling
- Call security (LiveKit integration)
- Memory safety and injection attacks
- Backend

## Important Design Decisions (NOT Vulnerabilities)

When auditing, remember these are **intentional design choices**:

1. **Local message caching** - Messages downloaded and stored locally (by design)
  - Messages are end-to-end encrypted at rest in local DB
  - Public DMs are not encrypted (messages are public)
  - Private DMs use NaCl encryption
  - Cache persists across app restarts for offline access
2. **Local key storage** - Encryption keys stored on device (by design)
  - Keys protected by Android Keystore (hardware-backed when available)
  - Encrypted with device-specific secrets
  - User data never leaves device in plaintext
  - Do NOT flag key storage as critical (Keystore is production-ready)

## Output Format

Provide a **clean, concise report** with:

1. **Executive Summary** - Overall rating and production readiness
2. **Security Status** - Critical issues (if any) and recommendations
3. **Security Strengths** - What's done well
4. **Component Ratings** - Table format for quick reference
5. **Architecture Review** - Data flow, encryption boundaries
6. **Threat Analysis** - Current realistic threats (e.g., rooted device, malicious APK)
7. **Recommendations** - Prioritized with time estimates
8. **Conclusion** - Clear production readiness statement

**Keep it under 500 lines** - focus on actionable findings, not verbose explanations.

## Common False Positives to Avoid

❌ **DO NOT FLAG THESE AS ISSUES:**

- Local message caching (intentional for offline access)
- Public message viewing without auth (intentional design)
- Debuggable APK (only relevant if signed/released)

