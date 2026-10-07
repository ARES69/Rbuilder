# RBuilder for Windows

RBuilder поставляется как нативное Windows-приложение на Tauri 2: окно + встроенный локальный сервер (sidecar). Сервер обслуживает API агента, терминал и прокси к LLM-провайдеру; фронтенд вшит в само окно.

## Что в комплекте

| Файл | Что это |
|---|---|
| `RBuilder_0.2.0_x64_en-US.msi` | Установщик для всех пользователей (Program Files) |
| `RBuilder_0.2.0_x64-setup.exe` | Установщик NSIS на одного пользователя, без прав администратора |
| `rbuilder.exe` | Портативный запуск без установки (нужен `rbuilder-server.exe` рядом) |

Оба установщика и портативный exe лежат в `src-tauri/target/release/bundle/` и `src-tauri/target/release/`.

## Сборка из исходников

Требуется: Node.js 20+, pnpm 9+, Rust (toolchain `x86_64-pc-windows-msvc`), интернет для первого `tauri build` (скачиваются crates.io, WiX и NSIS).

```powershell
pnpm install
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-desktop.ps1
```

Скрипт делает всё по шагам: фронтенд → серверный бандл → standalone-сервер через Bun → Tauri с MSI и NSIS. Ручной вариант:

```powershell
pnpm install
pnpm exec vite build
pnpm exec vite build --config vite.config.server.ts
pnpm exec bun build dist-server\index.js --compile --outfile .freebuff-build\rbuilder-server.exe
pnpm exec tauri build
```

## Установка

- **MSI** — двойной клик, «Далее». Ставится в Program Files, ярлык в «Пуск», доступен всем пользователям.
- **NSIS** — двойной клик. Ставится только текущему пользователю, без UAC.
- **Портативно** — скопируйте `rbuilder.exe` и `rbuilder-server.exe` в одну папку и запустите `rbuilder.exe`.

## Куда пишутся данные

| Путь | Назначение |
|---|---|
| `%LOCALAPPDATA%\RBUILDER\workspace` | Сгенерированные проекты (можно переназначить через `RBUILDER_WORKSPACE_ROOT`) |
| `%LOCALAPPDATA%\RBUILDER\workspace\.rbuilder-server.log` | Журнал локального сервера — первое место для диагностики |

Каждый запуск слушает **случайный свободный порт** на `127.0.0.1`, поэтому конфликты портов исключены; адрес передаётся фронтенду автоматически.

## Настройка LLM-провайдера

Откройте Settings в приложении. Ollama и LM Studio работают без ключей (нужен только адрес локального сервера провайдера); для OpenAI/Anthropic впишите ключ в Settings — он хранится локально в файле настроек рабочей области и никуда не отправляется, кроме выбранного провайдера.

## Релизы через GitHub Actions

Пуш тега `v*` (например, `v0.2.0`) запускает workflow [desktop-release](.github/workflows/desktop-release.yml): он typecheck'ает, гоняет тесты, собирает MSI и NSIS на `windows-latest`, подписывает установщики и exe через Azure Artifact Signing (если настроены секреты — см. [docs/CODE-SIGNING.md](docs/CODE-SIGNING.md); без них сборка проходит как раньше, просто без подписи) и прикрепляет оба установщика к GitHub Release с автогенерированными release notes. Запустить сборку без тега можно вручную: вкладка Actions → desktop-release → Run workflow (артефакты появятся в самом запуске).

```powershell
git tag -a v0.2.0 -m "RBuilder 0.1.10"
git push origin v0.2.0
```

## Устранение неполадок

**Окно не открывается.** Загляните в `%LOCALAPPDATA%\RBUILDER\workspace\.rbuilder-server.log`. Ошибки вида `cannot start ... rbuilder-server` означают, что sidecar не найден рядом с `rbuilder.exe` — переустановите приложение или проверьте, что оба exe в одной папке.

**«The local server did not become healthy in time».** Сервер запустился, но не ответил за 30 секунд. Проверьте журнал: возможно, порт занят другим процессом (маловероятно — порт случайный) или провайдер настроен неверно. Удалите файл лога и повторите запуск.

**Агент не отвечает.** Провайдер не настроен — откройте Settings и выберите Ollama/LM Studio (без ключа) или введите ключ для облачного провайдера. Статус провайдера виден там же.

**Терминал/preview не работает.** Убедитесь, что антивирус не блокирует `rbuilder-server.exe` (он исполняет команды в рабочей области и слушает `127.0.0.1`). При необходимости добавьте исключение для папки `%LOCALAPPDATA%\RBUILDER`.

## Как это работает внутри

```
rbuilder.exe (Tauri, WebView2)
 ├─ выбирает свободный порт 127.0.0.1
 ├─ запускает rbuilder-server.exe (sidecar, Bun-compile)
 ├─ ждёт GET /api/health → 200 (до 30 с)
 └─ открывает окно, вставляя window.__RBUILDER_API_BASE__
      └─ фронтенд шлёт все /api/* запросы на sidecar
```

Сервер — тот же код, что и `pnpm start` в репозитории; в десктопе он компилируется в один exe, чтобы не требовать Node.js на машине пользователя.

## Процесс изменений

Ветка `main` защищена: прямые пуши отклоняются (в том числе для администратора), force-push и удаление запрещены. Изменения проходят через pull request — workflow `desktop-release` гоняет typecheck, тесты и сборку фронта; зелёный чек `build-windows` обязателен для мерджа. Релизы не меняются: тег `vX.Y.Z` собирает MSI и NSIS и прикладывает их к GitHub Release.

```powershell
git checkout -b my-change
# … изменения …
git commit -m "my change"
git push -u origin my-change
# открой PR в GitHub, дождись зелёного build-windows, жми Merge
```
