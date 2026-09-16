export interface ArchitectureProfile {
  id: string;
  name: string;
  description: string;
  frontend: string;
  backend: string;
  database: string;
  auth: string;
  bestFor: string;
  constraints: string[];
}

export const ARCHITECTURES: ArchitectureProfile[] = [
  {
    id: "rbuilder-convex",
    name: "RBuilder Fullstack",
    description: "React-приложение с Convex backend и реактивными данными.",
    frontend: "React + TypeScript + Tailwind CSS",
    backend: "Convex queries, mutations and actions",
    database: "Convex database",
    auth: "Convex Auth: email OTP + anonymous access",
    bestFor: "Большинство рабочих приложений и MVP",
    constraints: [
      "Не добавлять отдельный backend",
      "Серверные секреты читать только в Convex functions",
      "Доступ к данным проверять по владельцу проекта",
    ],
  },
  {
    id: "frontend-only",
    name: "Frontend only",
    description: "Самодостаточное приложение без серверной базы данных.",
    frontend: "React + TypeScript + Tailwind CSS",
    backend: "Нет backend; browser APIs only",
    database: "localStorage / IndexedDB",
    auth: "Гостевой режим",
    bestFor: "Прототипы, лендинги и offline-инструменты",
    constraints: [
      "Не требовать API-ключи на клиенте",
      "Сохранять состояние с безопасным fallback",
      "Не имитировать серверную безопасность",
    ],
  },
  {
    id: "pwa-offline",
    name: "Offline PWA",
    description: "Мобильное приложение, которое работает при нестабильной сети.",
    frontend: "React + TypeScript + responsive mobile-first UI",
    backend: "Опциональная синхронизация через Convex",
    database: "IndexedDB с локальной очередью изменений",
    auth: "Email OTP при появлении сети",
    bestFor: "Полевые сотрудники, склад, заметки и мобильные сценарии",
    constraints: [
      "Основные действия должны работать без сети",
      "Показывать состояние синхронизации",
      "Не терять неподтверждённые локальные изменения",
    ],
  },
  {
    id: "crm-russia",
    name: "Российская CRM",
    description: "CRM-профиль с ролями, аудитом и российскими интеграциями.",
    frontend: "React + TypeScript + Tailwind CSS",
    backend: "Convex actions + webhooks",
    database: "Convex database with role-based access",
    auth: "Email OTP + admin/manager roles",
    bestFor: "Продажи, заказы, клиенты и внутренние кабинеты",
    constraints: [
      "Цены хранить в копейках и показывать в ₽",
      "Добавлять audit log для важных операций",
      "Интеграции подключать через серверные actions",
    ],
  },
];

export const DEFAULT_ARCHITECTURE_ID = ARCHITECTURES[0].id;

export function getArchitecture(id: string | undefined | null): ArchitectureProfile {
  return ARCHITECTURES.find((profile) => profile.id === id) ?? ARCHITECTURES[0];
}

export function architectureContract(id: string | undefined | null): string {
  const profile = getArchitecture(id);
  return [
    `ARCHITECTURE: ${profile.name}`,
    `Frontend: ${profile.frontend}`,
    `Backend: ${profile.backend}`,
    `Database: ${profile.database}`,
    `Auth: ${profile.auth}`,
    `Constraints: ${profile.constraints.join("; ")}`,
  ].join("\n");
}
