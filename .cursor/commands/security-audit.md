# Security Audit Command

Perform a comprehensive security audit of the FromChat application codebase.

## Project Context

**FromChat** is a 100% open source secure messaging application with:

- React/TypeScript frontend
- Python FastAPI backend
- End-to-end encryption for DMs and calls
- Caddy reverse proxy with security headers
- WebSocket support for real-time features
- Electron support for desktop app

## Important Design Decisions (NOT Vulnerabilities)

When auditing, remember these are **intentional design choices**:

1. **Public messages endpoint** - Open forum accessible without authentication (by design)
  - The public chat is meant to be an open forum
  - Private DMs are properly E2E encrypted and require authentication
2. **Public user list** - All users visible in DMs tab (by design)
  - Users can see all registered accounts
  - This is intentional for a community-based chat app
3. **XSS protection** - Multi-layer defense already implemented:
  - React auto-escaping
  - DOMPurify for sanitization
  - Caddy CSP headers
  - Do NOT flag localStorage key storage as critical (already well-protected)
4. **File upload security** - Docker isolation in place:
  - Server runs in Docker without executable flags
  - Files cannot execute on server
  - PIL re-encodes images
  - Do NOT flag Content-Type validation as critical
5. **CSRF protection** - Not needed:
  - No cookies used
  - JWT tokens in Authorization headers only
  - CSRF attacks don't apply to this auth model
6. **Beta domain CSP** - 'unsafe-inline' is required:
  - Beta domain (beta.fromchat.ru) points to development machine
  - Vite dev server requires 'unsafe-inline' to function
  - Production domain has strict CSP
7. **Security logging** - Already implemented:
  - All events are logged including security-related activity
  - Do NOT flag as missing
8. **100% Open Source** - This is a security strength:
  - Full transparency
  - Community review capability
  - No hidden backdoors

## Android App

**EXCLUDE from all audits** - Android app is not production-ready and out of scope.

## Infrastructure (Caddy)

The application runs behind Caddy reverse proxy with comprehensive security controls:

### Key Infrastructure Protections

- ✅ **HTTPS enforcement** - Automatic SSL/TLS with Caddy
- ✅ **HSTS** - Strict-Transport-Security with preload
- ✅ **CSP** - Content Security Policy (strict on production, 'unsafe-inline' for scripts on beta for Vite)
- ✅ **Rate limiting** - 500 events/min (production), 1000 events/min (beta)
- ✅ **X-Frame-Options: DENY** - Prevents clickjacking
- ✅ **X-Content-Type-Options: nosniff** - Prevents MIME sniffing
- ✅ **X-XSS-Protection: 1; mode=block** - XSS protection
- ✅ **Permissions-Policy** - Restricts geolocation, allows camera/mic for calls

**Important:** These protections are already in place at the infrastructure level. Don't flag missing security headers or rate limiting in the application code.

## Audit Process

1. **Read the Caddyfile first** to understand infrastructure protections
2. **Check backend code** for authentication, authorization, input validation
3. **Review frontend code** for XSS protections, crypto implementation
4. **Verify E2E encryption** implementation (NaCl for DMs, AES-GCM for calls)
5. **Test CORS configuration** in backend/app.py
6. **Review password policies** in backend/validation.py
7. **Check file upload handling** in backend/routes/messaging.py and profile.py

## Rating Guidelines

- **Infrastructure (Caddy):** Should be 9/10 or higher (excellent security headers)
- **Cryptography:** Should be 8-9/10 (uses industry-standard libraries)
- **Frontend Security:** Should be 7-8/10 (multi-layer XSS protection)
- **Backend API:** Focus on CORS, password policies, rate limiting

## Output Format

Provide a **clean, concise report** with:

1. **Executive Summary** - Overall rating and production readiness
2. **Security Status** - Critical issues (if any) and recommendations
3. **Security Strengths** - What's done well
4. **Component Ratings** - Table format for quick reference
5. **Design Decisions** - Clarify what's intentional vs vulnerable
6. **Threat Analysis** - Current realistic threats only
7. **Recommendations** - Prioritized with time estimates
8. **Conclusion** - Clear production readiness statement

**Keep it under 500 lines** - focus on actionable findings, not verbose explanations.

## Common False Positives to Avoid

❌ **DO NOT FLAG THESE AS ISSUES:**

- Public messages endpoint (intentional)
- Username enumeration (users list is public by design)
- Keys in localStorage (XSS is well-protected)
- Content-Type validation (Docker isolation prevents execution)
- CSRF protection (not applicable - no cookies)
- Beta CSP 'unsafe-inline' (required for Vite)
- Security logging (already implemented)
- Android app security (out of scope)

## Key Security Features to Verify

✅ **MUST CHECK:**

- CORS configuration in backend/app.py
- Password validation in backend/validation.py
- JWT token generation and validation
- E2E encryption implementation (NaCl, AES-GCM)
- File upload sanitization
- Authorization checks on sensitive endpoints
- Rate limiting configuration
- Security headers in Caddyfile

## Example Good Finding Format

```markdown
### Password Policy (HIGH PRIORITY - Non-blocking)
**Current:** 5 character minimum
**Recommended:** 12+ characters with complexity requirements
**Risk:** Brute force attacks (mitigated by rate limiting)
**Estimated Fix:** 4-6 hours
**Code Location:** backend/validation.py:11-16
```

## Notes from Developer

- Application is production-ready after CORS fix
- Focus on practical, actionable improvements
- Don't overthink things that are already well-protected
- Open source is a feature, not a concern
- Community can audit the code themselves

