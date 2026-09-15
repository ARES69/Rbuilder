/**
 * Catalog of Russian service connectors for RBuilder.
 *
 * Shared by:
 *  - `src/convex/integrations.ts`  (credential validation + connection tests)
 *  - `src/components/integrations-panel.tsx` (per-service connect forms)
 *
 * Each service declares the credential fields the user must provide and an
 * API pattern that the backend `test` action uses to verify connectivity.
 */

export type FieldType = "text" | "url" | "password" | "select";

export interface ServiceField {
  id: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  options?: string[]; // for "select"
  required: boolean;
  /** Short help line shown under the input. */
  help?: string;
}

export interface RuService {
  id: string; // connector id, e.g. "bitrix24"
  name: string;
  category: "CRM" | "ERP" | "Payments" | "Delivery" | "Data" | "Messaging" | "Docs" | "Storage";
  desc: string;
  fields: ServiceField[];
  /** API pattern used by the connection test in convex/integrations.ts. */
  pattern:
    | "bitrix-rest"
    | "bitrix-oauth"
    | "o3-com"
    | "amocrm-oauth"
    | "yookassa-shop"
    | "tinkoff-terminal"
    | "cdek-oauth"
    | "boxberry-token"
    | "dadata-api"
    | "tg-bot"
    | "vk-service"
    | "smsaero-bearer"
    | "diadoc-auth"
    | "yadisk-oauth";
  docsUrl: string;
  /** Which agent capability this unlocks (shown as a hint chip). */
  unlocks: string;
}

const URL_FIELD = (id: string, label: string, placeholder: string, help?: string): ServiceField => ({
  id,
  label,
  type: "url",
  placeholder,
  required: true,
  help,
});

const SECRET_FIELD = (id: string, label: string, placeholder: string, help?: string): ServiceField => ({
  id,
  label,
  type: "password",
  placeholder,
  required: true,
  help,
});

export const RU_SERVICES: RuService[] = [
  {
    id: "bitrix24",
    name: "Битрикс24",
    category: "CRM",
    desc: "Лиды, сделки, контакты, задачи через входящий webhook или OAuth-приложение",
    pattern: "bitrix-rest",
    docsUrl: "https://dev.1c-bitrix.ru/api_rest/",
    unlocks: "Чтение/создание сделок и лидов из чата",
    fields: [
      URL_FIELD(
        "portalUrl",
        "Адрес портала",
        "https://yourcompany.bitrix24.ru",
        "Ваш портал Битрикс24 (облачный или коробка)",
      ),
      SECRET_FIELD(
        "webhookKey",
        "Ключ входящего webhook",
        "xxxxxxxxxxxxxxxx/xxxxxxxxxxxxxxx/",
        "Раздел «Разработчикам» → «Другое» → «Входящий webhook»",
      ),
    ],
  },
  {
    id: "bitrix24-oauth",
    name: "Битрикс24 (OAuth-приложение)",
    category: "CRM",
    desc: "Полноправное OAuth-приложение для работы с несколькими порталами",
    pattern: "bitrix-oauth",
    docsUrl: "https://dev.1c-bitrix.ru/api_d7/bitrix/rest/OAuth+2.0/",
    unlocks: "Мультипортальная синхронизация CRM",
    fields: [
      SECRET_FIELD("clientId", "Client ID", "Код приложения"),
      SECRET_FIELD("clientSecret", "Client secret", "Ключ приложения"),
    ],
  },
  {
    id: "o3",
    name: "1С:ОФД / 1С:Битрикс (OData)",
    category: "ERP",
    desc: "1С через HTTP-сервисы и OData-интерфейс: номенклатура, документы, продажи",
    pattern: "o3-com",
    docsUrl: "https://its.1c.ru/db/v8std#browse:13:-1:7:21",
    unlocks: "Товары, документы и продажи из 1С в приложении",
    fields: [
      URL_FIELD(
        "baseUrl",
        "Адрес публикации 1С",
        "https://your-server.ru/base/odata/standard.odata",
        "Публикация информационной базы с включённым OData или HTTP-сервисом",
      ),
      SECRET_FIELD("username", "Пользователь", "Имя пользователя 1С"),
      SECRET_FIELD("password", "Пароль", "Пароль пользователя 1С"),
    ],
  },
  {
    id: "amocrm",
    name: "amoCRM",
    category: "CRM",
    desc: "Сделки, контакты и воронки через долгосрочный токен",
    pattern: "amocrm-oauth",
    docsUrl: "https://www.amocrm.ru/developers/content/crm_platform/api-reference",
    unlocks: "Создание сделок и контактов из чата",
    fields: [
      URL_FIELD("subdomain", "Поддомен аккаунта", "https://yourcompany.amocrm.ru", "Адрес вашей amoCRM"),
      SECRET_FIELD(
        "accessToken",
        "Долгосрочный токен",
        "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImp0aSI6...",
        "Настройки → Интеграции → Ключи и доступы",
      ),
    ],
  },
  {
    id: "yookassa",
    name: "ЮKassa",
    category: "Payments",
    desc: "Платежи и чеки: подтверждение платежей, статусы, возвраты",
    pattern: "yookassa-shop",
    docsUrl: "https://yookassa.ru/developers",
    unlocks: "Приём платежей и статусы оплат",
    fields: [
      SECRET_FIELD("shopId", "shopId", "Идентификатор магазина", "Личный кабинет ЮKassa → Настройки"),
      SECRET_FIELD("secretKey", "Секретный ключ", "test_*** или живой ключ"),
    ],
  },
  {
    id: "tinkoff",
    name: "Т-Банк (Тинькофф) Эквайринг",
    category: "Payments",
    desc: "Платёжная инициализация, статусы и возвраты через терминальный API",
    pattern: "tinkoff-terminal",
    docsUrl: "https://www.tinkoff.ru/kassa/develop/api/",
    unlocks: "Оплаты и возвраты через Т-Банк",
    fields: [
      SECRET_FIELD("terminalKey", "Terminal Key", "Терминал из личного кабинета"),
      SECRET_FIELD("password", "Пароль терминала", "Секретное слово / пароль терминала"),
    ],
  },
  {
    id: "cdek",
    name: "СДЭК",
    category: "Delivery",
    desc: "Расчёт доставки, заказы, ПВЗ через интеграционный API v2",
    pattern: "cdek-oauth",
    docsUrl: "https://cdekdeveloper.ru",
    unlocks: "Расчёт и оформление доставки СДЭК",
    fields: [
      URL_FIELD("apiUrl", "API-адрес", "https://api.cdek.ru/v2", "Тест: https://api.edu.cdek.ru/v2"),
      SECRET_FIELD("account", "Account (ИМ)", "Логин интеграции"),
      SECRET_FIELD("securePassword", "Secure password", "Пароль интеграции"),
    ],
  },
  {
    id: "boxberry",
    name: "Boxberry",
    category: "Delivery",
    desc: "ПВЗ, тарифы и создание заказов через API",
    pattern: "boxberry-token",
    docsUrl: "https://boxberry.ru/my/api",
    unlocks: "Пункты выдачи и тарифы Boxberry",
    fields: [
      URL_FIELD("apiUrl", "API-адрес", "https://api.boxberry.ru/json.php"),
      SECRET_FIELD("token", "API-токен", "Токен из личного кабинета"),
    ],
  },
  {
    id: "dadata",
    name: "DaData",
    category: "Data",
    desc: "Стандартизация адресов, ИНН/компании, банков, ФИО",
    pattern: "dadata-api",
    docsUrl: "https://dadata.ru/api/",
    unlocks: "Автодополнение адресов и проверка ИНН",
    fields: [
      SECRET_FIELD("apiKey", "API-ключ", "Ключ из личного кабинета DaData"),
      SECRET_FIELD("secretKey", "Секретный ключ", "Секретный ключ DaData"),
    ],
  },
  {
    id: "telegram",
    name: "Telegram Bot",
    category: "Messaging",
    desc: "Уведомления и команды через Bot API",
    pattern: "tg-bot",
    docsUrl: "https://core.telegram.org/bots/api",
    unlocks: "Уведомления о заказах в Telegram",
    fields: [
      SECRET_FIELD("botToken", "Bot token", "123456:ABC-DEF...", "От @BotFather"),
      SECRET_FIELD("chatId", "Chat ID", "ID чата или канала для уведомлений", "Можно получить у @userinfobot"),
    ],
  },
  {
    id: "vk",
    name: "VK API",
    category: "Messaging",
    desc: "Сообщения сообщества и Callback API",
    pattern: "vk-service",
    docsUrl: "https://dev.vk.com/method",
    unlocks: "Ответы в сообщениях сообщества VK",
    fields: [
      SECRET_FIELD(
        "serviceToken",
        "Сервисный токен доступа",
        "Сервисный токен сообщества или приложения",
      ),
    ],
  },
  {
    id: "smsaero",
    name: "SMS Aero",
    category: "Messaging",
    desc: "SMS-уведомления клиентам",
    pattern: "smsaero-bearer",
    docsUrl: "https://smsaero.ru/documentation/api",
    unlocks: "SMS-рассылки и статусы доставки",
    fields: [
      SECRET_FIELD("email", "E-mail аккаунта", "Логин в SMS Aero"),
      SECRET_FIELD("apiKey", "API-ключ", "Ключ из настроек SMS Aero"),
    ],
  },
  {
    id: "yadisk",
    name: "Яндекс Диск",
    category: "Storage",
    desc: "Файлы и папки через REST API: загрузка, скачивание, публикация ссылок",
    pattern: "yadisk-oauth",
    docsUrl: "https://yandex.ru/dev/disk-api/doc/ru/",
    unlocks: "Сохранение файлов и документов приложения на Яндекс Диск",
    fields: [
      SECRET_FIELD(
        "accessToken",
        "OAuth-токен",
        "y0_AgAAAAA...",
        "Создайте приложение на oauth.yandex.ru с доступом к Яндекс Диску (cloud_api:disk)",
      ),
      {
        id: "folder",
        label: "Рабочая папка",
        type: "text",
        placeholder: "/RBuilder",
        required: false,
        help: "Папка на Диске для файлов приложения (необязательно, по умолчанию корень)",
      },
    ],
  },
  {
    id: "diadoc",
    name: "Диадок (Контур)",
    category: "Docs",
    desc: "Электронные документы и юридически значимый ЭДО",
    pattern: "diadoc-auth",
    docsUrl: "https://developer.kontur.ru/docs/diadoc/http/default.html",
    unlocks: "Отправка и получение документов ЭДО",
    fields: [
      URL_FIELD("baseUrl", "API-адрес", "https://diadoc-api.kontur.ru"),
      SECRET_FIELD("login", "Логин", "Логин Диадок"),
      SECRET_FIELD("password", "Пароль", "Пароль Диадок"),
    ],
  },
];

export const SERVICE_CATEGORIES = [
  "CRM",
  "ERP",
  "Payments",
  "Delivery",
  "Data",
  "Messaging",
  "Docs",
  "Storage",
] as const;

export function findService(id: string): RuService | undefined {
  return RU_SERVICES.find((service) => service.id === id);
}
