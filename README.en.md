# FromChat Web Client — Messaging Web App

[Читать на других языках: Русский](./README.md)

<div align="center">
  <img src="https://raw.githubusercontent.com/fromchat-messenger/android/main/app/android/src/main/ic_launcher-playstore.png" width="120" alt="FromChat Logo" />

  **Web client for FromChat messenger**

  [🌐 Web Client](https://github.com/fromchat-messenger/web) • [🖥️ Backend](https://github.com/fromchat-messenger/backend) • [📱 Android](https://github.com/fromchat-messenger/android) • [🌍 Website](https://github.com/fromchat-messenger/site)
</div>

---

## 📝 Description

FromChat Web is a React/TypeScript client (browser and Electron) for the FromChat server.

**Note:** Landing pages and legal documents live in [fromchat-messenger/site](https://github.com/fromchat-messenger/site).

---

## 📊 Client Comparison

| Feature | Android | Web | iOS |
|---|---|---|---|
| **Messaging & profiles** | ✅ | ✅ | ❌ |
| **Voice/video calls** | ✅ | ✅ | ❌ |
| **Screen sharing** | ✅ | ✅ | ❌ |
| **Message reactions** | ❌ | ✅ | ❌ |
| **Rich attachment support** | ✅ | ❌ | ❌ |

⚠️ **iOS is temporarily not supported.**

---

## ✨ Features

- Protected DMs (legal encryption scheme)
- Voice/video calls and screen sharing
- Message reactions
- Public chats and profiles
- Device management
- WebSocket real-time updates
- Dark mode
- Optional Electron desktop build

---

## 🏗️ Tech Stack

| Component | Notes |
|---|---|
| React 19 | UI |
| TypeScript | strict typing |
| Vite 7 | dev server & build |
| MDUI | Material Design |
| Zustand + use-immer | state |
| Motion | animations |
| TweetNaCl.js | cryptography |
| Electron | desktop (optional) |

---

## 🔧 Development

### Requirements

- Node.js 20+ (Docker image uses Node 24)
- npm
- Backend API on `http://localhost:8300` (proxied as `/api`)

### Quick start

```bash
git clone https://github.com/fromchat-messenger/web.git
cd web
npm install
cp .env.example .env   # if needed; install may copy it for you
npm run frontend:dev
```

Open `http://localhost:8301`.

`.env`:

```env
# HTTP API host (Vite proxy target for /api)
VITE_API_BASE_URL=http://localhost:8300
```

In the browser the client uses same-origin `/api` (HTTP and WebSocket, e.g. `/api/chat/ws`).

### Commands

```bash
npm run frontend:dev              # Vite on :8301
npm run frontend:typecheck        # TypeScript
npm run frontend:build            # typecheck + production build → build/normal
npm run frontend:preview          # preview built frontend
npm run frontend:electron:dev     # Electron + Vite
npm run frontend:electron:build   # Electron package
```

### Project structure

```
web/
├── src/
│   ├── index.html
│   ├── main/                 # React app (@/)
│   │   ├── pages/            # auth, chat, profile, …
│   │   ├── core/             # API, websocket, calls, …
│   │   ├── state/            # Zustand stores
│   │   ├── utils/
│   │   └── css/              # SCSS (Material Design)
│   ├── electron/             # Electron main/preload
│   └── protocol/             # shared protocol (@fromchat/protocol)
├── plugins/                  # Vite plugins
├── vite.config.ts
├── compose.yml               # production web image (:8301→80)
├── Dockerfile
├── .env.example
└── package.json
```

---

## 🐳 Docker

```bash
docker build -t fromchat-web:latest .
# or via compose:
docker compose --env-file .env up --build
```

Container listens on port **8301** (static server on 80 inside).

Production edge (Caddy/HAProxy) is configured via the deployment repo / backend `compose.prod.yml`.

---

## 🤝 Contributing

1. Branch for your change
2. Open a PR with a description
3. Ensure `npm run frontend:typecheck` passes

---

## 📄 License

GNU Affero General Public License v3.0 — see [LICENSE](./LICENSE).

---

## 🔗 Related Repositories

- [Backend API](https://github.com/fromchat-messenger/backend)
- [Android Client](https://github.com/fromchat-messenger/android)
- [Website](https://github.com/fromchat-messenger/site)
- [Deployment](https://github.com/fromchat-messenger/deployment)

---

## ❓ FAQ

**Q: How do I run locally?**  
A: Start the backend on `:8300`, then `npm run frontend:dev` and open `http://localhost:8301`.

**Q: Which browsers?**  
A: Current Chrome, Firefox, Safari, Edge.

**Q: Do calls work on web?**  
A: Yes — voice/video and screen share (server needs LiveKit).

**Q: How do I report a bug?**  
A: GitHub Issues with reproduction steps.

---

**[⬆ back to top](#fromchat-web-client--messaging-web-app)**
