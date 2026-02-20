# SoundHub Demo

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

## Запуск
1) Установи зависимости:
```bash
npm install
```

2) Запусти сервер:
```bash
npm start
```

Открой: http://localhost:3000

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
Демо-данные лежат в `data/*.json`.  
Аудио-заглушка: `public/audio/sample.wav` (короткий тон, чтобы плеер работал без интернета).
