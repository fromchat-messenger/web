# FromChat Web Client — веб-приложение для обмена сообщениями

[Read in other languages: English](./README.en.md)

_Написано ИИ. Могут быть ошибки._

## 📝 Описание

Веб-клиент FromChat — React/TypeScript приложение (браузер и Electron) для работы с сервером FromChat.

## Развернуть в 1 клик

```bash
docker run -d --restart always -p 8301:80 fromchat/web:latest
```

## ✨ Возможности

- Защищённые личные сообщения (легальная схема шифрования)
- Голосовые/видеозвонки и демонстрация экрана
- Реакции на сообщения
- Публичные чаты и профили
- Управление устройствами
- WebSocket для реал-тайма
- Тёмный режим
- Сборка Electron (опционально)

## 🏗️ Технологический стек

| Компонент | Примечание |
|---|---|
| React 19 | UI |
| TypeScript | строгая типизация |
| Vite 7 | dev-сервер и сборка |
| MDUI | Material Design |
| Zustand + use-immer | состояние |
| Motion | анимации |
| TweetNaCl.js | криптография |
| Electron | десктоп (опционально) |

## 🔧 Разработка

### Требования

- Node.js 20+ (для Docker-образа используется Node 24)
- npm
- Backend API на `http://localhost:8300` (проксируется через `/api`)

### Быстрый старт

```bash
git clone https://github.com/fromchat-messenger/web.git
cd web
npm install
cp .env.example .env   # при необходимости; install может скопировать сам
npm run frontend:dev
```

Откройте `http://localhost:8301`.

### Команды

```bash
npm run frontend:dev              # Vite на :8301
npm run frontend:typecheck        # TypeScript
npm run frontend:build            # typecheck + production build → build/normal
npm run frontend:preview          # preview собранного фронта
npm run frontend:electron:dev     # Electron + Vite
npm run frontend:electron:build   # сборка Electron
```

### Структура проекта

```
web/
├── src/
│   ├── index.html
│   ├── main/                 # React-приложение (@/)
│   │   ├── pages/            # auth, chat, profile, …
│   │   ├── core/             # API, websocket, calls, …
│   │   ├── state/            # Zustand stores
│   │   ├── utils/
│   │   └── css/              # SCSS (Material Design)
│   ├── electron/             # main/preload Electron
│   └── protocol/             # общий протокол (@fromchat/protocol)
├── plugins/                  # Vite-плагины
├── vite.config.ts
├── compose.yml               # production-образ веба (:8301→80)
├── Dockerfile
├── .env.example
└── package.json
```

## 🐳 Docker

```bash
docker compose up --build
```

Контейнер слушает порт **8301** (внутри nginx/static-server на 80).

## 🤝 Внесение вклада

1. Создайте ветку под изменение
2. Отправьте PR с описанием
3. Проверьте типы: `npm run frontend:typecheck`

## 📄 Лицензия

GNU Affero General Public License v3.0 — см. [LICENSE](./LICENSE).

## 🔗 Связанные репозитории

- [Backend API](https://github.com/fromchat-messenger/backend)
- [Android Client](https://github.com/fromchat-messenger/android)
- [Website](https://github.com/fromchat-messenger/site)
- [Deployment](https://github.com/fromchat-messenger/deployment)