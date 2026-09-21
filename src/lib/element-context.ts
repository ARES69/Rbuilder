/**
 * Element picker context.
 *
 * A click in the preview is worth far more than a CSS selector: the model also
 * needs to know which rules actually apply, what the element looks like right
 * now, what sits next to it and which attributes survive.
 *
 * The collection itself happens inside the sandboxed preview frame (the parent
 * cannot read that DOM by design — see `preview-picker.ts`); this module owns
 * the shape, the style keys both sides collect, and the prompt rendering. All
 * of it is pure and unit tested.
 */

export interface PreviewElementContext {
  selector: string;
  tag: string;
  id?: string;
  classes: string[];
  text: string;
  attributes: Record<string, string>;
  computed: Record<string, string>;
  /** Author CSS rules whose selector matches the element. */
  cssRules: string[];
  /** Clipped markup of the element itself, so the model sees its structure. */
  html?: string;
  parent?: string;
  /** Up to five siblings, for "what is it next to" context. */
  siblings: string[];
}

/** Style properties that carry visual intent for a generated app. */
export const COMPUTED_STYLE_KEYS = [
  "display",
  "position",
  "width",
  "height",
  "gap",
  "padding",
  "margin",
  "color",
  "background-color",
  "background-image",
  "border",
  "border-radius",
  "box-shadow",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-align",
  "opacity",
  "transition",
] as const;

const MAX_TEXT = 160;

function clip(text: string, max: number): string {
  const value = text.trim().replace(/\s+/g, " ");
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Short, human-readable handle for an element ("button.primary «Войти»"). */
export function describeElement(element: {
  tag: string;
  classes: string[];
  text: string;
}): string {
  const classes = element.classes.length > 0 ? `.${element.classes.slice(0, 2).join(".")}` : "";
  const text = element.text ? ` «${clip(element.text, 40)}»` : "";
  return `${element.tag}${classes}${text}`;
}

/** Render the collected context as one prompt block. */
export function formatElementContext(context: PreviewElementContext): string {
  const lines: string[] = ["ВЫБРАННЫЙ ЭЛЕМЕНТ В ПРЕВЬЮ"];
  lines.push(`Селектор: ${context.selector}`);
  const identity = [`тег ${context.tag}`];
  if (context.id) identity.push(`id ${context.id}`);
  if (context.classes.length > 0) identity.push(`классы ${context.classes.join(" ")}`);
  lines.push(`Элемент: ${identity.join(" · ")}`);
  if (context.text) lines.push(`Текст: «${context.text}»`);

  const attributeEntries = Object.entries(context.attributes);
  if (attributeEntries.length > 0) {
    lines.push(
      `Атрибуты: ${attributeEntries
        .map(([name, value]) => `${name}="${value}"`)
        .join(", ")}`,
    );
  }

  const styleEntries = Object.entries(context.computed);
  if (styleEntries.length > 0) {
    lines.push(
      `Текущие стили: ${styleEntries
        .map(([name, value]) => `${name}: ${value}`)
        .join("; ")}`,
    );
  }

  if (context.cssRules.length > 0) {
    lines.push("Применяются CSS-правила:");
    for (const rule of context.cssRules) lines.push(`- ${rule}`);
  }

  if (context.html) lines.push(`Разметка элемента: ${context.html}`);

  if (context.parent) lines.push(`Родитель: ${context.parent}`);
  if (context.siblings.length > 0) {
    lines.push(`Рядом на странице: ${context.siblings.join(" · ")}`);
  }

  lines.push(
    "Меняй именно этот элемент и связанные с ним стили. Остальную вёрстку, классы и текст не трогай.",
  );
  return lines.join("\n");
}

/** Composer text for a picked element — the short form shown above the input. */
export function pickedElementPrompt(context: PreviewElementContext): string {
  return `Измени выбранный элемент: ${context.selector}${
    context.text ? ` (${context.text})` : ""
  }`;
}
