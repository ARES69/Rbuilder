/**
 * Element picker context.
 *
 * A click in the preview is worth far more than a CSS selector: the model also
 * needs to know which rules actually apply, what the element looks like right
 * now, what sits next to it and which attributes survive. This module collects
 * that picture from the rendered document and renders it as one prompt block.
 *
 * The collector is DOM-only; `formatElementContext` is pure and unit tested.
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

const MAX_RULES = 12;
const MAX_RULE_LENGTH = 220;
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

/**
 * Author rules that match the element, including matching `@media` blocks.
 * Cross-origin stylesheets throw on `cssRules`, so reading is wrapped up front.
 */
function collectMatchingRules(
  element: HTMLElement,
  rules: CSSRuleList,
  window: Window,
  bucket: string[],
): void {
  for (const rule of Array.from(rules)) {
    if (bucket.length >= MAX_RULES) return;
    const styled = rule as CSSStyleRule;
    if (typeof styled.selectorText === "string") {
      try {
        if (styled.selectorText && element.matches(styled.selectorText)) {
          bucket.push(clip(styled.cssText, MAX_RULE_LENGTH));
        }
      } catch {
        // An invalid selector in generated CSS must not break the picker.
      }
      continue;
    }
    // Descend into @media blocks that are active at the preview's width.
    const media = rule as CSSMediaRule;
    if (media.conditionText && media.cssRules) {
      let active = false;
      try {
        active = window.matchMedia(media.conditionText).matches;
      } catch {
        active = false;
      }
      if (active) collectMatchingRules(element, media.cssRules, window, bucket);
    }
  }
}

function matchingRules(element: HTMLElement, doc: Document, window: Window): string[] {
  const bucket: string[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      // Cross-origin stylesheets throw; the picker just skips them.
      continue;
    }
    if (rules) collectMatchingRules(element, rules, window, bucket);
    if (bucket.length >= MAX_RULES) break;
  }
  return bucket;
}

export function collectElementContext(
  element: HTMLElement,
  selector: string,
  doc: Document = element.ownerDocument,
): PreviewElementContext {
  const window = doc.defaultView ?? globalThis.window;
  const computed: Record<string, string> = {};
  try {
    const styles = window.getComputedStyle(element);
    for (const key of COMPUTED_STYLE_KEYS) {
      const value = styles.getPropertyValue(key).trim();
      // Skip values inherited by everything — they carry no signal.
      if (!value || value === "none" || value === "normal" || value === "auto") continue;
      if (value === "0px" && key !== "gap") continue;
      computed[key] = clip(value, 90);
    }
  } catch {
    // Computed styles are a bonus, never a requirement.
  }

  const attributes: Record<string, string> = {};
  for (const attribute of Array.from(element.attributes).slice(0, 12)) {
    if (attribute.name === "style" && attribute.value.length > 200) continue;
    attributes[attribute.name] = clip(attribute.value, 120);
  }

  const parent = element.parentElement;
  const siblings = parent
    ? Array.from(parent.children)
        .filter((child) => child !== element)
        .slice(0, 5)
        .map((child) =>
          describeElement({
            tag: child.tagName.toLowerCase(),
            classes: Array.from(child.classList),
            text: (child as HTMLElement).innerText ?? "",
          }),
        )
    : [];

  return {
    selector,
    tag: element.tagName.toLowerCase(),
    id: element.id || undefined,
    classes: Array.from(element.classList),
    text: clip(element.innerText || element.textContent || "", MAX_TEXT),
    attributes,
    computed,
    cssRules: matchingRules(element, doc, window),
    parent: parent
      ? describeElement({
          tag: parent.tagName.toLowerCase(),
          classes: Array.from(parent.classList),
          text: "",
        })
      : undefined,
    siblings,
  };
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
