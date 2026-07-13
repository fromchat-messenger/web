# FromChat Web Client — Messaging Web App

[Читать на других языках: Русский](./README.md)

<div align="center">
  <img src="https://raw.githubusercontent.com/fromchat-messenger/android/main/app/android/src/main/ic_launcher-playstore.png" width="120" alt="FromChat Logo" />
  
  **Web client for FromChat messenger**
  
  [🌐 Web Client](https://github.com/fromchat-messenger/web) • [🖥️ Backend](https://github.com/fromchat-messenger/backend) • [📱 Android](https://github.com/fromchat-messenger/android) • [🌍 Website](https://github.com/fromchat-messenger/site)
</div>

---

## 📝 Description

FromChat Web Client is a React application for messaging via browser. It's a modern interface for accessing the FromChat server.

---

## 📊 Client Comparison

| Feature | Android | Web | iOS |
|---|---|---|---|
| **Messaging & Profiles** | ✅ | ✅ | ✅ |
| **Voice/Video Calls** | ✅ | ❌ | ❌ |
| **Screen Sharing** | ✅ | ❌ | ❌ |
| **Message Reactions** | ❌ | ✅ | ❌ |
| **Rich Attachment Support** | ✅ | ❌ | ❌ |

**Note:** Landing pages and legal documents are in a separate repository [fromchat-messenger/site](https://github.com/fromchat-messenger/site).

---

## ✨ Features

- **Protected Messages** — legal message encryption
- **Message Reactions** — unique to the web client
- **Profile Management** — update user data
- **Device Management** — control active sessions
- **Public Chats** — join communities
- **WebSocket** — real-time updates
- **Dark Mode** — easy on the eyes
- **Open Source** — full transparency

---

## 🏗️ Tech Stack

| Component | Version |
|---|---|
| React | 19 |
| TypeScript | latest |
| Vite | latest |
| MDUI | Material Design |
| Zustand | state management |
| Framer Motion | animations |
| TweetNaCl.js | cryptography |

---

## 🔒 Security

- **Message Encryption** — legal server-side encryption
- **WebSocket SSL/TLS** — secure connection
- **Token Management** — secure JWT storage
- **CORS** — cross-site request protection
- **Open Source** — full transparency

---

## 🔧 Development

### Requirements

- Node.js 20+
- npm
- Backend API running on `http://localhost:8300`

### Quick Start

**1. Clone repository:**

```bash
git clone https://github.com/fromchat-messenger/web.git
cd web
```

**2. Install dependencies:**

```bash
npm install
```

**3. Configure .env:**

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Backend API
VITE_API_URL=http://localhost:8300
VITE_WS_URL=ws://localhost:8300

# App settings
VITE_APP_NAME=FromChat
VITE_APP_VERSION=1.0.0
```

**4. Start dev server:**

```bash
npm run dev
```

Web client will be available at `http://localhost:8304`

**5. Open in browser:**

Go to `http://localhost:8304` and log in.

### Commands

```bash
# Dev server (with hot reload)
npm run dev

# Type checking (TypeScript)
npm run typecheck

# Build for production
npm run build

# Preview production build
npm run preview

# Lint (code style check)
npm run lint
```

### Project Structure

```
web/
├── src/
│   ├── pages/              # Application pages
│   │   ├── auth/           # Authentication (login, register)
│   │   ├── chat/           # Chat interface
│   │   └── profile/        # User profile
│   ├── core/               # Core business logic
│   │   ├── api/            # API client
│   │   ├── calls/          # WebRTC/LiveKit integration
│   │   ├── websocket.ts    # WebSocket manager
│   │   └── types.d.ts      # TypeScript definitions
│   ├── state/              # Zustand stores
│   ├── utils/              # Utility functions
│   └── css/                # SCSS modules (Material Design)
├── vite.config.ts          # Vite configuration
├── .env.example            # Example environment variables
└── package.json            # Dependencies
```

### API Configuration

Connect to the backend API via `.env`:

```env
# Development
VITE_API_URL=http://localhost:8300
VITE_WS_URL=ws://localhost:8300

# Production
VITE_API_URL=https://api.fromchat.ru
VITE_WS_URL=wss://api.fromchat.ru
```

The API supports both URL variants:
- `/api/endpoint`
- `/endpoint` (without prefix)

Both work identically.

---

## 🐳 Docker

### Build image

```bash
docker build -t fromchat-web:latest .
```

### Run container

```bash
docker run -p 8304:8304 \
  -e VITE_API_URL=http://localhost:8300 \
  -e VITE_WS_URL=ws://localhost:8300 \
  fromchat-web:latest
```

### Production with Caddy

Web client is automatically routed to `web.fromchat.ru` when using Caddy.

---

## 🤝 Contributing

Contributions are welcome! Please:

1. Create a branch for your feature
2. Submit a pull request with description
3. Ensure TypeScript checks pass: `npm run typecheck`

---

## 📄 License

This project is licensed under the GNU Affero General Public License v3.0. See [LICENSE](./LICENSE) for details.

---

## 🔗 Related Repositories

- [Backend API](https://github.com/fromchat-messenger/backend) — Python FastAPI server
- [Android Client](https://github.com/fromchat-messenger/android) — Android application
- [Website](https://github.com/fromchat-messenger/site) — Landing & legal pages

---

## ❓ FAQ

**Q: How do I use the web client?**
A: Open `http://localhost:8304` in your browser and log in with FromChat credentials.

**Q: Which browsers are supported?**
A: Chrome, Firefox, Safari, Edge (latest versions).

**Q: Are video calls supported?**
A: No, video calls are only available in the Android client. Use Android for calls.

**Q: How do I report a bug?**
A: Open an issue on GitHub with a description, reproduction steps, and screenshots.

---

**[⬆ back to top](#fromchat-web-client--messaging-web-app)**
