# Кодовая подпись установщиков (SmartScreen)

Скачанный из браузера неподписанный установщик Windows встречает пользователя предупреждением SmartScreen («Неизвестный издатель»). Лечится это только подписью кода и накоплением репутации файла. RBuilder подписывается через **Azure Artifact Signing** (бывший Trusted Signing) — управляемый Microsoft сервис: без аппаратных токенов, сертификат продлевается сам, CA принадлежит Microsoft, поэтому репутация SmartScreen набирается быстрее.

Важно понимать: подпись не убирает SmartScreen мгновенно. Репутация набирается по мере скачиваний, подписанных **одним и тем же сертификатом** (он один на аккаунт Artifact Signing и меняется автоматически — репутация при ротации сохраняется). Каждый релиз, подписанный тем же профилем, наследует репутацию предыдущих.

## Стоимость и ограничения

| Что | Значение |
|---|---|
| Тариф Basic | ~$9.99/мес (до 5 000 подписей), Premium ~$99.99/мес |
| Нужна | платная Azure-подписка |
| Individual (частное лицо) | только США или Канада; identity берётся из биллинг-аккаунта Azure (тип Individual, имя и адрес должны совпадать с удостоверением личности) |
| Organization | США, Канада, ЕС, Великобритания, Австралия, НЗ, Япония, Южная Корея, Сингапур, Швейцария, Норвегия, Израиль |
| Проверка личности | 1–3 раб. дня (individual), 3–5 (organization); до одобрения подписать нельзя |
| Профиль | только **Public Trust** — Private Trust SmartScreen не убирает |

Если вы не в поддерживаемой стране, Artifact Signing не подойдёт — альтернативы: OV/EV-сертификат у стороннего CA (Sectigo, Certum, DigiCert; с июня 2023 ключи только в облаке провайдера — eSigner, Keycustodian и т.п.), либо подпись вообще без неё (текущее состояние).

## Настройка Azure (один раз)

```powershell
az login
az provider register --namespace Microsoft.CodeSigning   # дождаться Registered
az group create --name rbuilder-signing --location eastus
az artifact-signing create -n rbuilder-signing -l eastus -g rbuilder-signing --sku Basic
```

1. **Endpoint**: на Overview аккаунта возьмите URI региона — для `eastus` это `https://eus.codesigning.azure.net`.
2. **Identity Validation**: аккаунт → «Identity validation» → добавить individual или organization, пройти проверку (фото удостоверения / учредительные документы).
3. **Certificate Profile**: аккаунт → «Certificate profiles» → добавить, тип **Public Trust**, Code Signing, привязать одобренную identity. Имя профиля запишите.
4. **Роль сервисному принципалу** (по умолчанию подписывать нельзя):

```powershell
az ad sp create-for-rbac \
  --name rbuilder-github-signing \
  --role "Artifact Signing Certificate Profile Signer" \
  --scopes /subscriptions/<SUBSCRIPTION_ID>/resourceGroups/rbuilder-signing/providers/Microsoft.CodeSigning/codeSigningAccounts/rbuilder-signing \
  --json-auth
```

Из JSON вывода и аккаунта нужны семь значений — они идут в GitHub Secrets (Settings → Secrets and variables → Actions):

| Секрет | Откуда |
|---|---|
| `AZURE_TENANT_ID` | `tenantId` из вывода `create-for-rbac` |
| `AZURE_CLIENT_ID` | `clientId` из того же вывода |
| `AZURE_CLIENT_SECRET` | `clientSecret` (показывается один раз!) |
| `AZURE_SUBSCRIPTION_ID` | `subscriptionId` |
| `AZURE_SIGNING_ENDPOINT` | `https://eus.codesigning.azure.net` (регион аккаунта) |
| `AZURE_SIGNING_ACCOUNT` | имя аккаунта (`rbuilder-signing`) |
| `AZURE_SIGNING_PROFILE` | имя профиля сертификата |

Оговорка: у сервисного принципала должна быть роль **Artifact Signing Certificate Profile Signer** (в старых порталах — «Trusted Signing Certificate Profile Signer») именно на аккаунт подписи.

## Как это работает в CI

Workflow [desktop-release.yml](.github/workflows/desktop-release.yml):

1. `Check signing configuration` — проверяет наличие всех семи секретов. Нет хотя бы одного → шаги подписи пропускаются, сборка идёт как раньше (unsigned). Ничего не падает — это позволяет работать форкам и репо без Azure.
2. `Azure login` + `Sign the executables and installers` — официальный `azure/artifact-signing-action@v2` подписывает:
   - `RBuilder_*.msi` (установщик MSI),
   - `RBuilder_*_x64-setup.exe` (NSIS),
   - `rbuilder.exe` (основной exe — его подпись видна в свойствах файла и учитывается SmartScreen при запуске портативной версии),
   - `rbuilder-server.exe` (sidecar — его часто помечают антивирусы; подпись снижает ложные срабатывания).
3. `Verify signatures` — `Get-AuthenticodeSignature` проверяет, что все четыре файла подписаны (`Status: Valid`); битая подпись валит сборку, unsigned-релиз не выкладывается.
4. Подписанные файлы уходят в артефакты и на GitHub Release как обычно.

Проверить подпись локально после скачивания: `(Get-AuthenticodeSignature .\RBuilder_0.1.7-beta_x64-setup.exe).Status` → `Valid`.

## Ускорение набора репутации

- Подписывайте **каждый** релиз одним профилем — репутация копится на файлы и сертификат.
- Попросите Microsoft вручную проверить файл: отправьте подписанный установщик в разбор SmartScreen — не гарантируется, но часто снимает предупреждение для конкретного файла.
- Первые недели предупреждение может появляться — это нормально; скажите пользователю «Подробнее → Выполнить в любом случае».

## Если подпись сломалась

- `403 Forbidden` — неверный endpoint (не тот регион), имя аккаунта/профиля, или у принципала нет роли Signer.
- `SignerSign() exit 32` — endpoint не совпадает с регионом аккаунта.
- `Invalid metadata` — проверьте имя профиля: регистр важен.
- Учесть: сертификаты Artifact Signing живут 3 дня, поэтому таймстамп обязателен — action уже ставит `http://timestamp.acs.microsoft.com` (RFC 3161, SHA-256).
