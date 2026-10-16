# WhatsApp AI Group Assistant

Полноценный AI-ассистент для групп WhatsApp на основе **Baileys**, **Google AI (Gemma/Gemini)** и **Tavily Search**.

Стек: Node.js, Express, PostgreSQL (Render), Socket.IO, Google AI SDK.

---

## 🚀 Быстрый старт (локально)

```bash
# 1. Клонируй репозиторий
git clone <your-repo-url>
cd whatsapp-ai-assistant

# 2. Установи зависимости
npm install

# 3. Настрой .env
cp .env.example .env
# Отредактируй .env — вставь GOOGLE_API_KEY и TAVILY_API_KEY

# 4. Запусти
npm run dev
# Открой http://localhost:3000 (admin / admin123)
```

> **Важно:** Для локального запуска PostgreSQL не требуется — используется in-memory хранилище. Все данные сохраняются только в сессионной памяти пока сервер запущен.

---

## ☁️ Деплой на Render.com (с PostgreSQL)

### Шаг 1 — Создай репозиторий на GitHub

```bash
# Если ещё не сделал:
cd /путь/к/проекту
git init
git add -A
git commit -m "first commit"
git remote add origin https://github.com/твой-юзер/whatsapp-ai-assistant.git
git push -u origin main
```

### Шаг 2 — Зайди в Render.com

1. Открой [dashboard.render.com](https://dashboard.render.com)
2. Нажми **"New +"** → **"Blueprint"**
3. Подключи свой GitHub/GitLab репозиторий
4. Render **автоматически прочитает `render.yaml`** и создаст:
   - **Web Service** (`whatsapp-ai-assistant`) — сам бот
   - **PostgreSQL** (`whatsapp-ai-db`) — база данных

### Шаг 3 — Заполни секретные переменные

После создания сервиса, зайди в **Environment Variables** Web Service и добавь:

| Переменная | Значение |
|---|---|
| `GOOGLE_API_KEY` | `AIzaSyChPlC3WBSAXk58lFhnO80BqyaDQgwNq-Q` |
| `TAVILY_API_KEY` | `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` |
| `ADMIN_PASSWORD` | Придумай свой пароль (или оставь `admin123`) |

`DATABASE_URL` подставится автоматически из PostgreSQL.

### Шаг 4 — Подожди деплой

- Build и деплой занимают ~3-5 минут
- После деплоя открой `https://твой-сервис.onrender.com`
- Увидишь админ-панель

### Шаг 5 — Подключи WhatsApp

На вкладке **Dashboard** появится QR-код. Отсканируй его в WhatsApp:
**WhatsApp → Связанные устройства → Привязать устройство**

> На Render.com QR точно появится, т.к. сервера в США/Европе и WhatsApp Web не заблокирован.

---

## 📁 Структура проекта

```
├── src/
│   ├── index.js          # Точка входа (всё связывает)
│   ├── config.js         # Конфигурация из .env
│   ├── database.js       # PostgreSQL (через pg Pool) + fallback in-memory
│   ├── bot/
│   │   ├── whatsapp.js   # Baileys: QR, подключение, сообщения
│   │   └── handler.js    # Обработчик сообщений → AI Brain
│   ├── ai/
│   │   ├── provider.js   # Google AI (Gemma/Gemini SDK)
│   │   └── brain.js      # AI ядро → JSON решение
│   ├── memory/
│   │   ├── shortTerm.js  # Последние 500 сообщений
│   │   ├── longTerm.js   # Сжатие при 256k токенов
│   │   └── compressor.js # Суммаризация → 40k токенов
│   ├── scheduler/        # Планировщик (Asia/Bishkek)
│   ├── tavily/           # Tavily Search API
│   ├── api/              # REST API
│   └── web/              # Админ-панель (Express + Socket.IO)
├── render.yaml           # Render Blueprint (Web + PostgreSQL)
├── Dockerfile
└── package.json
```

---

## 🌐 Админ-панель

| Страница | Что делает |
|---|---|
| 📊 Dashboard | QR-код, статус бота, список групп, последние события |
| ⚙️ Настройки | System prompt, имя бота, уровень активности, API ключи, whitelist групп |
| 🧠 Память | Мониторинг токенов, прогресс-бар 256k, сжатая память |
| ⏰ Планировщик | Создание/отмена отложенных сообщений (Asia/Bishkek) |
| 📋 Логи | AI решения, сообщения, активность |

---

## 🧠 Возможности

- 🤖 **Подключение WhatsApp** через QR-код (Baileys)
- 👥 **Работа в группах** с whitelist
- 🧠 **AI-ответы** через Google AI (модель `gemma-4-31b-it`)
- 🔍 **Tavily API** для поиска информации и изображений
- ⏰ **Планировщик** задач (timezone: Asia/Bishkek)
- 📝 **Memory система** (short-term 500 msg + long-term с авто-компрессией)
- 📊 **Логирование** всех сообщений и AI-решений
- 🔒 **Система упоминаний** (@bot / nickname)
- 🎚️ **Уровень активности** (low / medium / high)

---

## ⚙️ Переменные окружения

| Переменная | Описание | По умолчанию |
|---|---|---|
| `PORT` | Порт сервера | `3000` |
| `DATABASE_URL` | PostgreSQL URL (Render) | — (in-memory fallback) |
| `GOOGLE_API_KEY` | API-ключ Google AI | — |
| `GOOGLE_MODEL` | Модель Google AI | `gemma-4-31b-it` |
| `TAVILY_API_KEY` | API-ключ Tavily | — |
| `BOT_NICKNAME` | Имя бота | `AI Assistant` |
| `BOT_ACTIVITY_LEVEL` | Уровень активности | `medium` |
| `BOT_TIMEZONE` | Часовой пояс | `Asia/Bishkek` |
| `ADMIN_USERNAME` | Логин админ-панели | `admin` |
| `ADMIN_PASSWORD` | Пароль админ-панели | `admin123` |

---

## 🐳 Docker

```bash
docker build -t whatsapp-ai-assistant .
docker run -p 3000:3000 \
  -e GOOGLE_API_KEY=ваш-ключ \
  -e TAVILY_API_KEY=ваш-ключ \
  whatsapp-ai-assistant
```


