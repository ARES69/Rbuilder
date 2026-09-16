export type SnippetCategory = "ui" | "data" | "auth" | "russia" | "automation";

export interface Snippet {
  id: string;
  name: string;
  category: SnippetCategory;
  description: string;
  prompt: string;
  files: string[];
}

export const SNIPPETS: Snippet[] = [
  {
    id: "dashboard-table",
    name: "Dashboard с таблицей",
    category: "ui",
    description: "Адаптивная таблица с фильтрами, сортировкой и пустыми состояниями.",
    prompt: "Добавь dashboard с таблицей записей: поиск, фильтр по статусу, сортировка, пагинация, loading/empty/error states и адаптивный мобильный вид.",
    files: ["src/components/DataTable.tsx", "src/components/Filters.tsx"],
  },
  {
    id: "auth-flow",
    name: "Авторизация и роли",
    category: "auth",
    description: "Вход, выход, защищённые маршруты и роли пользователя.",
    prompt: "Добавь полноценную авторизацию: вход, выход, защищённые маршруты, состояния загрузки и ошибок, роли admin/manager/viewer и проверку доступа на сервере.",
    files: ["src/components/RequireAuth.tsx", "src/lib/permissions.ts"],
  },
  {
    id: "file-upload",
    name: "Загрузка файлов",
    category: "data",
    description: "Drag-and-drop, прогресс, типы файлов и обработка ошибок.",
    prompt: "Добавь загрузку файлов через drag-and-drop: прогресс, ограничение размера, проверку MIME-типа, отмену, повторную попытку и понятные ошибки.",
    files: ["src/components/FileUpload.tsx", "src/lib/file-validation.ts"],
  },
  {
    id: "russian-company",
    name: "Реквизиты компании РФ",
    category: "russia",
    description: "ИНН, КПП, ОГРН, юридический адрес и проверка формата.",
    prompt: "Добавь форму реквизитов российской компании: ИНН, КПП, ОГРН, название и юридический адрес, маски ввода, checksum-валидацию ИНН и ошибки на русском языке.",
    files: ["src/components/CompanyDetailsForm.tsx", "src/lib/inn-validation.ts"],
  },
  {
    id: "webhook-automation",
    name: "Webhook-автоматизация",
    category: "automation",
    description: "Приём события, логирование, повторная обработка и статус.",
    prompt: "Добавь webhook-сценарий: endpoint для входящего события, проверка подписи, запись payload, idempotency key, статус обработки, retry и журнал событий.",
    files: ["src/convex/http.ts", "src/convex/webhooks.ts"],
  },
  {
    id: "orders-crm",
    name: "CRM заказов",
    category: "data",
    description: "Заказы, статусы, история изменений и карточка клиента.",
    prompt: "Добавь CRM заказов: список и карточка заказа, статусы новый/в работе/оплачен/отменён, история изменений, клиент, сумма в рублях и фильтр по менеджеру.",
    files: ["src/pages/Orders.tsx", "src/convex/orders.ts"],
  },
];

export const SNIPPET_CATEGORIES: { id: SnippetCategory; label: string }[] = [
  { id: "ui", label: "UI" },
  { id: "data", label: "Данные" },
  { id: "auth", label: "Auth" },
  { id: "russia", label: "РФ" },
  { id: "automation", label: "Автоматизация" },
];
