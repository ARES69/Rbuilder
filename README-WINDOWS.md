# RBuilder на Windows — установка, сборка, удаление

## Что вы получаете

**RBuilder Desktop** — нативное Windows-приложение (Tauri 2 + WebView2).

После сборки появляются готовые инсталляторы в
`src-tauri\target\release\bundle\` — а если Tauri использовал папку с именем
тулчейна, то в `src-tauri\target\x86_64-pc-windows-msvc\release\bundle\`.
Скрипт сборки печатает точные пути в конце своей работы:

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
4. Запустите установщик — точный путь напечатан в конце вывода `build-windows.bat`
   (обычно `src-tauri\target\release\bundle\nsis\`).

Если у вас есть кодовый сертификат, задайте переменные `RB_SIGN_*` до сборки —
тогда инсталляторы соберутся сразу подписанными (раздел «Подпись установщиков
и SmartScreen» ниже).

Что делать при проблемах — см. «Если что-то пошло не так» ниже.

## Способ 2 — готовые инсталляторы из GitHub Releases (без сборки вообще)

Если в репозитории настроен GitHub Actions (файл
`.github/workflows/desktop-build.yml`), инсталляторы собираются автоматически:

1. Поставьте тег: `git tag v0.1.0 && git push origin v0.1.0`
   (или запустите workflow вручную: вкладка **Actions** → **Desktop installers** → **Run workflow**).
2. GitHub соберёт на своих серверах и MSI, и NSIS, и macOS `.dmg`.
3. Скачайте артефакты во вкладке **Actions** (любой запуск) или готовые файлы
   в разделе **Releases** (при пуше тега — релиз создаётся сам).

На вашем компьютере для этого не нужно ничего — ни Rust, ни Bun, ни Visual Studio.

> Ссылка на Convex-бэкенд берётся из секрета `VITE_CONVEX_URL` репозитория
> (Settings → Secrets and variables → Actions). Без секрета соберётся
> плейсхолдер — приложение запустится, но не подключится к бэкенду.

## Способ 3 — без сборки: режим разработчика

Если инсталлятор не нужен и достаточно окна приложения с этого компьютера:

1. `install-rbuilder-windows.bat` — один раз (ставит окружение).
2. Запуск: `bun tauri dev` (окно приложения) или `bun run dev` (только веб
   в браузере).

## Способ 4 — если ничего не устанавливать на ПК

RBuilder — это веб-приложение: фронт (Vite) + бэкенд (Convex). Его можно
вообще не собирать в десктоп:

1. Развернуть на бесплатном хостинге Vite-сборки (Cloudflare Pages / Netlify /
   Vercel) и указать `VITE_CONVEX_URL` на ваш Convex deployment.
2. Открыть ссылку в браузере — тот же интерфейс без установки.
3. Windows-версия имеет смысл, когда нужен локальный workspace агента
   (файлы на диске, Git) и приватный режим (LM Studio/Ollama на своём железе).

---

## Подпись установщиков и SmartScreen

### Что видит пользователь без подписи

Неподписанный установщик, скачанный из интернета, Windows встречает
предупреждением **«Windows защитила ваш компьютер»** (SmartScreen) и
«Неизвестный издатель» в UAC. Файл запустится, но только после
**«Подробнее» → «Выполнить в любом случае»**. Это не дефект сборки: у файла
нет цифровой подписи, а значит и репутации у Microsoft.

Подпись убирает «Неизвестный издатель» и со временем снимает само
предупреждение. Отдельно отметим: если `.msi` собран локально и не скачивался
через браузер, предупреждения может не быть вообще — SmartScreen смотрит на
метку «файл из интернета».

### Как это работает (честно)

- С 2024 года **EV-сертификат больше не даёт мгновенного доверия**: Microsoft
  убрала для них особый режим, поэтому OV и EV набирают репутацию одинаково.
  Свежий подписанный релиз всё равно может предупредить.
- Репутация привязана к сертификату: **подписывайте каждый релиз одним и тем
  же**, тогда она переносится с версии на версию.
- Файл можно дополнительно отправить на ручную проверку в Microsoft — иногда
  предупреждение снимают для конкретного файла.
- Самоподписанный сертификат предупреждение **не убирает**: его не знает ни
  один чужой компьютер. Он годится только для внутреннего тестирования.

### Где взять сертификат

Нужен именно **code signing** сертификат (не SSL) от удостоверяющего центра:
Sectigo, DigiCert, GlobalSign и другие. Порядок цен — примерно от 100–400
долларов в год. Есть и облачные варианты, где файл сертификата не лежит на
диске (Azure Trusted Signing).

### Способ A — сертификат в хранилище Windows (рекомендуется)

Это единственный путь, который подписывает **и `.exe` приложения внутри
установщиков, и сами MSI/NSIS** (Tauri подписывает исполняемый файл до
упаковки).

```powershell
# 1. Один раз импортируем .pfx в личное хранилище пользователя
$pwd = Read-Host -AsSecureString "Пароль .pfx"
Import-PfxCertificate -FilePath C:\certs\rbuilder.pfx `
  -CertStoreLocation Cert:\CurrentUser\My -Password $pwd

# 2. Отпечаток: certmgr.msc → Personal → Certificates → сертификат → Thumbprint
$env:RB_SIGN_THUMBPRINT = "A1B1A2B2A3B3A4B4A5B5A6B6A7B7A8B8A9B9A0B0"

# 3. Сборка
build-windows.bat
```

Скрипт сам передаст в Tauri `certificateThumbprint`, `digestAlgorithm` и
`timestampUrl` (через временный конфиг-override), а в конце отчёта покажет,
какие инсталляторы оказались подписаны — по факту, а не «на слово».

### Способ B — прямо из .pfx, без ручного импорта

```powershell
$env:RB_SIGN_PFX = "C:\certs\rbuilder.pfx"
$env:RB_SIGN_PFX_PASSWORD = "пароль"   # можно не задавать — скрипт спросит
build-windows.bat
```

Скрипт импортирует сертификат сам, соберёт подписанные инсталляторы и
**удалит** импортированный сертификат из хранилища после сборки.

### Способ C — подписать уже собранные инсталляторы

```
sign-rbuilder-windows.bat
```

Или с явными параметрами:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File sign-windows.ps1 -Pfx C:\certs\rbuilder.pfx
powershell -NoProfile -ExecutionPolicy Bypass -File sign-windows.ps1 -Thumbprint <sha1>
```

Скрипт находит MSI и NSIS в `src-tauri\target`, подписывает их с меткой
времени и проверяет результат. **Важно:** так подписываются только сами
установщики — `.exe` приложения внутри них собран раньше и остаётся
неподписанным. Чтобы покрыть и его, используйте способ A или B.

### Способ D — облачная подпись (файла сертификата на диске нет)

Azure Trusted Signing / Key Vault и любые другие инструменты подключаются
через `signCommand`:

```powershell
$env:RB_SIGN_SIGNCOMMAND = "artifact-signing-cli -e https://wus2.codesigning.azure.net -a MyAccount -c MyProfile -d RBuilder %1"
build-windows.bat
```

`%1` — место, куда Tauri подставит файл для подписи. Так же подключаются
`relic`, `jsign`, `azuresigntool` и подобные.

### Переменные окружения

| Переменная | Смысл |
|---|---|
| `RB_SIGN_THUMBPRINT` | SHA-1 отпечаток сертификата из `Cert:\CurrentUser\My` |
| `RB_SIGN_PFX`, `RB_SIGN_PFX_PASSWORD` | Путь к `.pfx` и его пароль |
| `RB_SIGN_SIGNCOMMAND` | Своя команда подписи с `%1` (облачные сервисы) |
| `RB_SIGN_TIMESTAMP_URL` | Сервер метки времени (по умолчанию DigiCert) |
| `RB_SIGN_DIGEST_ALGORITHM` | Алгоритм хэша (по умолчанию `sha256`) |

Без этих переменных всё работает как раньше — сборка просто остаётся
неподписанной.

### Как проверить подпись

```powershell
Get-AuthenticodeSignature .\RBuilder_0.1.0_x64-setup.exe | Format-List Status, SignerCertificate
signtool verify /pa /v .\RBuilder_0.1.0_x64-setup.exe
```

Либо правой кнопкой по файлу → Свойства → вкладка «Цифровые подписи».

### Подпись в GitHub Actions

Workflow подписывает Windows-сборку, если заданы секреты:

1. Получите base64 от своего `.pfx`: `certutil -encode certificate.pfx base64cert.txt`.
2. Settings → Secrets and variables → Actions:
   - `WINDOWS_CERTIFICATE` — содержимое `base64cert.txt`;
   - `WINDOWS_CERTIFICATE_PASSWORD` — пароль `.pfx`;
   - при необходимости переменная `WINDOWS_TIMESTAMP_URL`.

Без этих секретов шаги подписи просто пропускаются: сборка остаётся
неподписанной, ничего не ломается. Если сертификат задан, workflow после
сборки проверяет подпись каждого инсталлятора и печатает статус.

> Для macOS подпись и нотаризация устроены иначе — см. README-MAC.md.

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
| Ошибки `Cannot find module '@/convex/_generated/api'` и сотни ошибок типа `TS7006` | В скачанном архиве нет папки `src/convex/_generated` (генерируется автоматически). Запустите `install-rbuilder-windows.bat` — он её создаст; либо вручную: `bunx convex codegen --typecheck=disable` |
| Ошибки `E0255: the name __cmd__… is defined multiple times` при компиляции Rust | Команда объявлена как `pub fn` в корне `src-tauri/src/lib.rs`. Лечится разово: `perl -0pi -e 's/#\[tauri::command\]\s*pub fn/#[tauri::command] fn/g' src-tauri/src/lib.rs` |
| Окно открывается пустым | Нет `VITE_CONVEX_URL` в `.env` — впишите адрес Convex deployment и пересоберите |
| SmartScreen: «Windows защитила ваш компьютер» / «Неизвестный издатель» | Установщик не подписан. Это ожидаемо для сборки без сертификата: нажмите «Подробнее» → «Выполнить в любом случае», либо соберите с подписью (раздел «Подпись установщиков и SmartScreen») |
| `signtool.exe not found` | Нет Windows SDK. Он ставится вместе с Visual Studio C++ Build Tools; иначе — `winget install Microsoft.WindowsSDK` |
| Подпись есть, но статус `UnknownError`/`UntrustedRoot` | Цепочка сертификата не доверена на этой машине. Перевыпустите подпись с полной цепочкой или проверьте, что используется сертификат от публичного CA, а не самоподписанный |

Каждый шаг скрипта пишет, что делает; при ошибке — человекочитаемое сообщение
и код выхода ≠ 0, так что скрипт можно перезапускать: он доустанавливает
только то, чего не хватает.
