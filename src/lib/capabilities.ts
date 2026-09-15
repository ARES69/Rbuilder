import type { ComponentType } from "react";
import { Bot, FileText, Globe, Rocket, Smartphone, Workflow } from "lucide-react";

export type CapabilityId = "web" | "mobile" | "site" | "bot" | "automation" | "deploy";

export interface SidebarCapability {
  id: CapabilityId;
  label: string;
  icon: ComponentType<{ className?: string }>;
  hint: string;
  /** Prompt prefix seeded into the composer when picked. */
  starter: string;
}

export const CAPABILITIES: SidebarCapability[] = [
  {
    id: "web",
    label: "Веб-приложения",
    icon: Globe,
    hint: "Дашборды, кабинеты, internal tools",
    starter: "Создай веб-приложение: ",
  },
  {
    id: "mobile",
    label: "Мобильные приложения",
    icon: Smartphone,
    hint: "Прототипы в рамке телефона",
    starter: "Создай прототип мобильного приложения: ",
  },
  {
    id: "site",
    label: "Сайты",
    icon: FileText,
    hint: "Лендинги, каталоги, визитки",
    starter: "Создай сайт: ",
  },
  {
    id: "bot",
    label: "Боты и API",
    icon: Bot,
    hint: "Чат-боты, виджеты, интеграции",
    starter: "Создай чат-бота: ",
  },
  {
    id: "automation",
    label: "Автоматизация",
    icon: Workflow,
    hint: "Дашборды, отчёты, пайплайны",
    starter: "Создай автоматизацию с дашбордом: ",
  },
  {
    id: "deploy",
    label: "Деплой",
    icon: Rocket,
    hint: "Готовый к публикации результат",
    starter: "Создай и подготовь к публикации: ",
  },
];
