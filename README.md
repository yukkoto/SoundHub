# SoundHub (Demo)

Минималистичный демо-проект SoundHub на **JavaScript (Node.js + Express + EJS)**.

## Что добавлено
- **Разворачиваемый плеер:** когда трек играет, клик по нижнему бару открывает **плеер на весь экран**.
- **Лайки и библиотека:** кнопка ❤ у треков добавляет их в **/library**.
- **Регистрация и вход:** можно **не логиниться** (гостевой режим) или создать аккаунт.
- **Логин / логаут:** вход по email/паролю, вход через OAuth, выход из аккаунта.
- **OAuth (опционально):** кнопки входа через **VK / Яндекс / Google** (нужны ключи).
- **Роли и демо-аккаунты:** admin / artist / user.
- **Исполнитель добавляет треки:** страница **/artist/upload** (статус `pending`).
- **Админ модератор:** в **/admin** можно **одобрить/отклонить** трек и **удалять подборки**.
- **Внешний поиск в `/search`:** при вводе запроса SoundHub подтягивает треки из бесплатного API. По умолчанию используется **Deezer**, а `MusicAPI` можно подключить отдельно как self-hosted источник.

## Запуск
1) Установи зависимости:
```bash
npm install
```

2) Создай `.env` на основе `.env.example`.

3) Основной запуск одной командой:
```bash
npm start
```

Эта команда:
- поднимает PostgreSQL в Docker,
- ждёт готовность базы,
- применяет схему и сиды,
- запускает приложение на `http://localhost:3000`.

## Альтернативный запуск двумя командами
Если хочешь отдельно управлять базой и приложением:

```bash
npm run db:up
npm run app:only
```

Если Docker не установлен, но PostgreSQL уже запущен локально, используй:

```bash
npm run start:local
```

Дополнительные команды:

```bash
npm run db:migrate
npm run db:seed
npm run db:down
```

## PostgreSQL
PostgreSQL поднимается в Docker и пробрасывается на:

- `localhost:5432`

По умолчанию используются значения из `.env.example`:

- database: `soundhub`
- user: `soundhub`
- password: `soundhub`

Это позволяет подключаться к базе через DBeaver, TablePlus, psql и другие локальные клиенты.

> Если `npm install` падает с ошибкой вроде **`Exit handler never called!`**, это обычно проблема вашей версии npm/Node.
> Часто помогает обновить npm (`npm i -g npm@latest`) или перейти на стабильную LTS-версию Node.js (например 20/22) через nvm.

## Демо-аккаунты
Можно войти на странице **/login**.

- **Админ**: `admin@soundhub.local` / `admin123`
- **Исполнитель**: `artist@soundhub.local` / `artist123`
- **Пользователь**: `user@soundhub.local` / `user123`

Админка `/admin` доступна только аккаунту **admin**.

## OAuth (VK / Yandex / Google)
OAuth сделан как опциональная штука: если ключей нет, кнопки на `/login` и `/register` будут серыми.

Создай файл `.env` в корне проекта и укажи:

```bash
BASE_URL=http://localhost:3000
SESSION_SECRET=any_long_random_secret

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

VK_CLIENT_ID=
VK_CLIENT_SECRET=

YANDEX_CLIENT_ID=
YANDEX_CLIENT_SECRET=
```

Callback URL'ы (их нужно прописать в настройках приложений провайдеров):
- Google: `BASE_URL/auth/google/callback`
- VK: `BASE_URL/auth/vk/callback`
- Яндекс: `BASE_URL/auth/yandex/callback`

## Страницы
- `/` — главная
- `/playlist/p1` — плейлист
- `/playlists` — список подборок
- `/author/a1` — страница автора
- `/track/t1` — страница трека (кнопка «Играть» включает нижний плеер)
- `/library` — библиотека лайкнутых треков
- `/profile` — профиль / гостевой режим
- `/login` — вход (local + OAuth)
- `/register` — регистрация (email/пароль + OAuth)
- `/admin` — админка (только роль admin)
- `/artist/upload` — добавить трек (только роль artist)
- `/search` — обзор/поиск

## Данные
Источник данных теперь PostgreSQL. SQL-схема лежит в `db/schema.sql`, демо-сиды в `db/seed.sql`.

Аудио-заглушка: `public/audio/sample.wav` (короткий тон, чтобы плеер работал без интернета).

## MusicAPI
Поиск на странице `/search` по умолчанию использует **Deezer** как бесплатный внешний источник. Если хочешь именно `MusicAPI`, его лучше поднимать отдельно и указывать через `.env`.

Поддерживаются переменные окружения:

```bash
MUSICAPI_BASE_URL=
MUSICAPI_BASE_URLS=
MUSICAPI_TIMEOUT_MS=8000
MUSICAPI_RESULT_LIMIT=1
DEEZER_TIMEOUT_MS=5000
DEEZER_RESULT_LIMIT=6
```

- `MUSICAPI_BASE_URL` — один базовый URL self-hosted `MusicAPI`, например `https://example.com/music/api`
- `MUSICAPI_BASE_URLS` — список mirror URL через запятую; если указан, будет использоваться как fallback-цепочка
- `MUSICAPI_TIMEOUT_MS` — таймаут одного запроса к внешнему API
- `MUSICAPI_RESULT_LIMIT` — сколько совпадений импортировать из `MusicAPI` на один поиск
- `DEEZER_TIMEOUT_MS` — таймаут запроса к Deezer
- `DEEZER_RESULT_LIMIT` — сколько совпадений импортировать из Deezer на один поиск

Если `MusicAPI` не настроен или недоступен, поиск всё равно продолжит работать через Deezer. Если внешний провайдер временно недоступен, локальный каталог SoundHub не ломается.
