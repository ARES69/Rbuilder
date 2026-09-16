export interface PromptPreset {
  id: string;
  name: string;
  description: string;
  prompt: string;
}

export const PROMPT_PRESETS: PromptPreset[] = [
  {
    id: "production",
    name: "Production-ready",
    description: "Проверки, ошибки, доступность и отсутствие заглушек.",
    prompt: "Сделай production-ready реализацию: без заглушек, с loading/empty/error states, валидацией, обработкой ошибок, доступностью клавиатурой и адаптивностью.",
  },
  {
    id: "mobile-first",
    name: "Mobile-first",
    description: "Сначала мобильный сценарий, затем desktop.",
    prompt: "Проектируй mobile-first: удобные touch targets, нижняя навигация на телефоне, отсутствие горизонтального overflow, затем адаптация для tablet и desktop.",
  },
  {
    id: "accessible",
    name: "Accessibility-first",
    description: "Семантика, клавиатура, focus states и контраст.",
    prompt: "Соблюдай accessibility-first: семантическая разметка, labels, aria только по необходимости, полный keyboard navigation, visible focus states, контраст WCAG AA и понятные ошибки.",
  },
  {
    id: "russian-business",
    name: "Российский бизнес",
    description: "Рубли, часовой пояс, локализация и сервисы РФ.",
    prompt: "Учитывай российский бизнес-контекст: русский интерфейс, цены в ₽, локальное форматирование дат и телефонов, часовой пояс Europe/Moscow, интеграции ЮKassa/СБП/Битрикс24/СДЭК при необходимости.",
  },
  {
    id: "minimalist",
    name: "Minimalism UI",
    description: "Пространство, иерархия, аккуратные границы и минимум шума.",
    prompt: "Используй Minimalism UI: near-monochrome palette, много воздуха, точное выравнивание, тонкие разделители, restrained motion и один очевидный primary action на экран.",
  },
];
