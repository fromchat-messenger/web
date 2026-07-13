# FromChat Web Client — веб-приложение для обмена сообщениями

[Read in other languages: English](./README.en.md)

<div align="center">
  <img src="https://raw.githubusercontent.com/fromchat-messenger/android/main/app/android/src/main/ic_launcher-playstore.png" width="120" alt="FromChat Logo" />
  
  **Веб-клиент для FromChat мессенджера**
  
  [🌐 Веб-клиент](https://github.com/fromchat-messenger/web) • [🖥️ Backend](https://github.com/fromchat-messenger/backend) • [📱 Android](https://github.com/fromchat-messenger/android) • [🌍 Website](https://github.com/fromchat-messenger/site)
</div>

---

## 📝 Описание

Веб-клиент FromChat — это React приложение для обмена сообщениями через браузер. Это современный интерфейс для доступа к серверу FromChat.

---

## 📊 Сравнение клиентов

| Возможность | Android | Веб | iOS |
|---|---|---|---|
| **Обмен сообщениями и профили** | ✅ | ✅ | ✅ |
| **Голосовые/видеозвонки** | ✅ | ❌ | ❌ |
| **Совместное использование экрана** | ✅ | ❌ | ❌ |
| **Реакции на сообщения** | ❌ | ✅ | ❌ |
| **Расширенная поддержка вложений** | ✅ | ❌ | ❌ |

**Примечание:** Лендинг-страницы и юридические документы находятся в отдельном репозитории [fromchat-messenger/site](https://github.com/fromchat-messenger/site).

---

## ✨ Возможности

- **Защищённые сообщения** — легальное шифрование сообщений
- **Реакции на сообщения** — уникальная функция веб-клиента
- **Управление профилем** — обновление данных пользователя
- **Управление устройствами** — контроль активных сеансов
- **Публичные чаты** — присоединяйтесь к сообществам
- **WebSocket** — реал-тайм обновления
- **Тёмный режим** — удобно для глаз
- **Открытый исходный код** — полная прозрачность

---

## 🏗️ Технологический стек

| Компонент | Версия |
|---|---|
| React | 19 |
| TypeScript | последняя |
| Vite | последняя |
| MDUI | Material Design |
| Zustand | управление состоянием |
| Framer Motion | анимации |
| TweetNaCl.js | криптография |

---

## 🔒 Безопасность

- **Шифрование сообщений** — легальное серверное шифрование
- **WebSocket SSL/TLS** — безопасное соединение
- **Управление токенами** — безопасное хранение JWT
- **CORS** — защита от межсайтовых запросов
- **Открытый исходный код** — полная прозрачность

---

## 🔧 Разработка

### Требования

- Node.js 20+
- npm
- Backend API работает на `http://localhost:8300`

### Быстрый старт

**1. Клонировать репозиторий:**

```bash
git clone https://github.com/fromchat-messenger/web.git
cd web
```

**2. Установить зависимости:**

```bash
npm install
```

**3. Настроить .env:**

```bash
cp .env.example .env
```

Отредактируйте `.env`:

```env
# Backend API
VITE_API_URL=http://localhost:8300
VITE_WS_URL=ws://localhost:8300

# App settings
VITE_APP_NAME=FromChat
VITE_APP_VERSION=1.0.0
```

**4. Запустить dev-сервер:**

```bash
npm run dev
```

Веб-клиент будет доступен на `http://localhost:8304`

**5. Открыть в браузере:**

Перейдите на `http://localhost:8304` и войдите с учётными данными.

### Команды

```bash
# Dev сервер (с горячей перезагрузкой)
npm run dev

# Type checking (TypeScript)
npm run typecheck

# Build для production
npm run build

# Preview production build
npm run preview

# Lint (проверка стиля кода)
npm run lint
```

### Структура проекта

```
web/
├── src/
│   ├── pages/              # Страницы приложения
│   │   ├── auth/           # Аутентификация (вход, регистрация)
│   │   ├── chat/           # Интерфейс чата
│   │   └── profile/        # Профиль пользователя
│   ├── core/               #核心业务逻辑
│   │   ├── api/            # API клиент
│   │   ├── calls/          # Интеграция WebRTC/LiveKit
│   │   ├── websocket.ts    # WebSocket менеджер
│   │   └── types.d.ts      # TypeScript определения
│   ├── state/              # Zustand stores
│   ├── utils/              # Вспомогательные функции
│   └── css/                # SCSS модули (Material Design)
├── vite.config.ts          # Конфигурация Vite
├── .env.example            # Пример переменных окружения
└── package.json            # Зависимости
```

### API Configuration

Backend API можно подключить через `.env`:

```env
# Development
VITE_API_URL=http://localhost:8300
VITE_WS_URL=ws://localhost:8300

# Production
VITE_API_URL=https://api.fromchat.ru
VITE_WS_URL=wss://api.fromchat.ru
```

API поддерживает оба варианта URL:
- `/api/endpoint`
- `/endpoint` (без префикса)

Оба варианта работают одинаково.

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

### Production с Caddy

Веб-клиент автоматически маршрутизируется на `web.fromchat.ru` при использовании Caddy.

---

## 🤝 Внесение вклада

Приветствуются внесение вклада! Пожалуйста:

1. Создайте ветку для вашей функции
2. Отправьте пулл-реквест с описанием
3. Убедитесь, что TypeScript проверка проходит: `npm run typecheck`

---

## 📄 Лицензия

Этот проект лицензирован в соответствии с лицензией GNU Affero General Public License v3.0. Подробности см. в файле [LICENSE](./LICENSE).

---

## 🔗 Связанные репозитории

- [Backend API](https://github.com/fromchat-messenger/backend) — Python FastAPI сервер
- [Android Client](https://github.com/fromchat-messenger/android) — Android приложение
- [Website](https://github.com/fromchat-messenger/site) — Лендинг и юридические страницы

---

## ❓ Часто задаваемые вопросы

**Q: Как я могу использовать веб-клиент?**
A: Откройте `http://localhost:8304` в браузере и войдите с учётными данными FromChat.

**Q: Какой браузер поддерживается?**
A: Chrome, Firefox, Safari, Edge (последние версии).

**Q: Поддерживаются ли видеозвонки?**
A: Нет, видеозвонки доступны только в Android клиенте. Используйте Android для звонков.

**Q: Как сообщить об ошибке?**
A: Откройте issue на GitHub с описанием проблемы, шагами воспроизведения и скриншотами.

---

**[⬆ вернуться к началу](#fromchat-web-client--веб-приложение-для-обмена-сообщениями)**
