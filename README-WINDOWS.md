# RBuilder на Windows — установка, сборка, удаление

## Что вы получаете

**RBuilder Desktop** — нативное Windows-приложение (Tauri 2 + WebView2).

После сборки появляются готовые инсталляторы в
`src-tauri\target\release\bundle\`:

- `msi\RBuilder_0.1.0_x64_en-US.msi` — классический установщик Windows;
- `nsis\RBuilder_0.1.0_x64-setup.exe` — установщик с ярлыками и деинсталлятором.

Их можно передавать на другие компьютеры — там **не нужны** Rust, Bun и
Visual Studio: только сам файл и WebView2 (есть на любом актуальном Windows 10/11).

---

> Пользователям Mac: те же шаги описаны в **README-MAC.md**
> (`install-rbuilder-mac.command` → `build-rbuilder-mac.command`).

## Способ 1 — простой (рекомендуется): собрать на своём компьютере

Подходит любому Windows 10/11 x64. Нужен интернет и 10–40 минут на первый
запуск (Visual Studio Build Tools — самый долгий шаг, ставится один раз).

1. Скачайте папку проекта (Git clone или ZIP → распакуйте).
2. Двойный клик по **`install-rbuilder-windows.bat`**.
   Скрипт сам поставит всё, чего не хватает: Git, Bun, Rust/MSVC,
   Visual Studio C++ Build Tools, WebView2, зависимости проекта.
3. Когда всё готово — двойный клик по **`build-windows.bat`**:
   проверки → веб-сборка → инсталляторы.
4. Запустите установщик из `src-tauri\target\release\bundle\nsis\`.

Что делать при проблемах — см. «Если что-то пошло не так» ниже.

## Способ 2 — без сборки: режим разработчика

Если инсталлятор не нужен и достаточно окна приложения с этого компьютера:

1. `install-rbuilder-windows.bat` — один раз (ставит окружение).
2. Запуск: `bun tauri dev` (окно приложения) или `bun run dev` (только веб
   в браузере).

## Способ 3 — если ничего не устанавливать на ПК

RBuilder — это веб-приложение: фронт (Vite) + бэкенд (Convex). Его можно
вообще не собирать в десктоп:

1. Развернуть на бесплатном хостинге Vite-сборки (Cloudflare Pages / Netlify /
   Vercel) и указать `VITE_CONVEX_URL` на ваш Convex deployment.
2. Открыть ссылку в браузере — тот же интерфейс без установки.
3. Windows-версия имеет смысл, когда нужен локальный workspace агента
   (файлы на диске, Git) и приватный режим (LM Studio/Ollama на своём железе).

---

## Удаление

- Приложение: `remove-rbuilder-windows.bat` (остановит процессы, запустит
  деинсталлятор, уберёт ярлыки и настройки RBuilder).
- Инструменты, если ставились скриптом: `winget uninstall Git.Git`,
  `winget uninstall Rustlang.Rustup`, `winget uninstall Microsoft.VisualStudio.2022.BuildTools`.
  Bun: удалить `%USERPROFILE%\.bun`.

---

## Если что-то пошло не так

| Симптом | Что делать |
|---|---|
| `winget was not found` | Microsoft Store → «Установщик приложений» → Обновить. Или поставить вручную: https://aka.ms/getwinget |
| Кракозябры/иероглифы в чёрном окне | Норма для старых bat-скриптов; наши скрипты переключают кодировку сами. Если всё равно кракозябры — запустите `setup-windows.ps1` из PowerShell напрямую |
| «Administrator permission is required» | Visual Studio Build Tools и VCRedist требуют прав админа. Подтвердите UAC-запрос — скрипт продолжится сам |
| «no compatible toolchain / linker.exe not found» | Не доустановились C++ Build Tools. Повторный запуск `install-rbuilder-windows.bat` доустановит workload |
| Сборка падает на `bun install` | Проверьте доступ к npm-реестру (корпоративный прокси?). `bun install` вручную, затем `build-windows.bat` |
| Окно открывается пустым | Нет `VITE_CONVEX_URL` в `.env` — впишите адрес Convex deployment и пересоберите |

Каждый шаг скрипта пишет, что делает; при ошибке — человекочитаемое сообщение
и код выхода ≠ 0, так что скрипт можно перезапускать: он доустанавливает
только то, чего не хватает.
