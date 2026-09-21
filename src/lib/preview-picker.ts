/**
 * Preview element picker bridge.
 *
 * The preview document runs in a sandboxed iframe on an opaque origin, so the
 * parent cannot read its DOM — that is exactly what keeps model-generated code
 * away from the Tauri IPC. Selection therefore works the other way round: a
 * small collector is injected into the previewed HTML, and the picked element
 * travels back as a postMessage payload that the parent validates before use.
 *
 * Everything here is pure. `injectPreviewPicker` and `parsePreviewPickMessage`
 * are unit tested, and the injected script is built from `COMPUTED_STYLE_KEYS`
 * so both sides always collect the same properties.
 */
import { COMPUTED_STYLE_KEYS, type PreviewElementContext } from "./element-context";

/** iframe → parent: the user picked an element. */
export const PREVIEW_PICK = "rbuilder:preview-pick";
/** iframe → parent: the collector is installed and listening. */
export const PREVIEW_PICK_READY = "rbuilder:preview-ready";
/** iframe → parent: the user pressed Escape inside the preview. */
export const PREVIEW_PICK_CANCEL = "rbuilder:preview-cancel";
/** parent → iframe: arm or disarm the collector. */
export const PREVIEW_PICK_ARM = "rbuilder:preview-arm";

const MAX_SELECTOR = 300;
const MAX_TAG = 32;
const MAX_CLASSES = 12;
const MAX_TEXT = 160;
const MAX_HTML = 500;
const MAX_ATTRIBUTES = 12;
const MAX_ATTRIBUTE_NAME = 64;
const MAX_ATTRIBUTE_VALUE = 120;
const MAX_RULES = 12;
const MAX_RULE_LENGTH = 220;
const MAX_STYLE_VALUE = 90;

function clip(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function asString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = clip(value, max);
  return text.length > 0 ? text : undefined;
}

function asStringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => clip(item, maxLength))
    .filter((item) => item.length > 0)
    .slice(0, maxItems);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

/**
 * Rebuild a trustworthy context from whatever the sandboxed frame posted.
 * Every field is re-checked and re-clipped: the source document is untrusted
 * input, and an oversized or malformed payload must not reach the prompt.
 */
export function parsePreviewPick(payload: unknown): PreviewElementContext | null {
  const raw = asRecord(payload);
  const selector = asString(raw.selector, MAX_SELECTOR);
  const tag = asString(raw.tag, MAX_TAG);
  if (!selector || !tag) return null;

  const computed: Record<string, string> = {};
  const rawComputed = asRecord(raw.computed);
  for (const key of COMPUTED_STYLE_KEYS) {
    const value = asString(rawComputed[key], MAX_STYLE_VALUE);
    if (value) computed[key] = value;
  }

  const attributes: Record<string, string> = {};
  const rawAttributes = asRecord(raw.attributes);
  for (const name of Object.keys(rawAttributes).slice(0, MAX_ATTRIBUTES)) {
    const value = asString(rawAttributes[name], MAX_ATTRIBUTE_VALUE);
    if (value && name.length <= MAX_ATTRIBUTE_NAME) attributes[name] = value;
  }

  return {
    selector,
    tag,
    id: asString(raw.id, MAX_ATTRIBUTE_VALUE),
    classes: asStringArray(raw.classes, MAX_CLASSES, MAX_ATTRIBUTE_VALUE),
    text: asString(raw.text, MAX_TEXT) ?? "",
    html: asString(raw.html, MAX_HTML),
    attributes,
    computed,
    cssRules: asStringArray(raw.cssRules, MAX_RULES, MAX_RULE_LENGTH),
    parent: asString(raw.parent, MAX_RULE_LENGTH),
    siblings: asStringArray(raw.siblings, 5, MAX_RULE_LENGTH),
  };
}

export type PreviewPickMessage =
  | { kind: "pick"; context: PreviewElementContext }
  | { kind: "ready" }
  | { kind: "cancel" };

/** Validate one incoming message against the nonce injected into the preview. */
export function parsePreviewPickMessage(
  event: { data?: unknown },
  nonce: string,
): PreviewPickMessage | null {
  const data = asRecord((event as { data?: unknown })?.data);
  if (typeof data.nonce !== "string" || data.nonce !== nonce) return null;
  if (data.type === PREVIEW_PICK_READY) return { kind: "ready" };
  if (data.type === PREVIEW_PICK_CANCEL) return { kind: "cancel" };
  if (data.type === PREVIEW_PICK) {
    const context = parsePreviewPick(data.payload);
    return context ? { kind: "pick", context } : null;
  }
  return null;
}

/** The message the parent sends to arm or disarm a preview frame. */
export function armMessage(nonce: string, armed: boolean): Record<string, unknown> {
  return { type: PREVIEW_PICK_ARM, nonce, armed };
}

/**
 * Self-contained collector that runs inside the preview document. It is a
 * plain string on purpose: the frame has an opaque origin, so it cannot import
 * anything, and the code must not depend on bundler output.
 */
export function previewPickerScript(nonce: string): string {
  const keys = JSON.stringify(COMPUTED_STYLE_KEYS);
  const limits = JSON.stringify({
    selector: MAX_SELECTOR,
    text: MAX_TEXT,
    html: MAX_HTML,
    style: MAX_STYLE_VALUE,
    attributes: MAX_ATTRIBUTES,
    attributeValue: MAX_ATTRIBUTE_VALUE,
    rules: MAX_RULES,
    rule: MAX_RULE_LENGTH,
  });
  const channels = JSON.stringify({
    pick: PREVIEW_PICK,
    ready: PREVIEW_PICK_READY,
    cancel: PREVIEW_PICK_CANCEL,
    arm: PREVIEW_PICK_ARM,
  });

  return `(function () {
  var NONCE = ${JSON.stringify(nonce)};
  var KEYS = ${keys};
  var LIMITS = ${limits};
  var CHANNELS = ${channels};
  if (window.__rbuilderPicker === NONCE) return;
  window.__rbuilderPicker = NONCE;

  var armed = false;
  var hovered = null;

  function send(type, payload) {
    try {
      window.parent.postMessage({ type: type, nonce: NONCE, payload: payload }, "*");
    } catch (error) {
      /* the parent may be gone; nothing to do */
    }
  }

  function clip(value, max) {
    var text = String(value == null ? "" : value).replace(/\\s+/g, " ").trim();
    return text.length > max ? text.slice(0, max) + "…" : text;
  }

  function cssEscape(value) {
    var text = String(value);
    if (window.CSS && window.CSS.escape) return window.CSS.escape(text);
    return text.replace(/[^a-zA-Z0-9_-]/g, function (character) {
      return "\\\\" + character;
    });
  }

  function label(element) {
    var classes = "";
    if (element.classList && element.classList.length > 0) {
      classes = "." + Array.prototype.slice.call(element.classList, 0, 2).join(".");
    }
    var text = clip(element.innerText || element.textContent || "", 40);
    return element.tagName.toLowerCase() + classes + (text ? " «" + text + "»" : "");
  }

  function selectorFor(element) {
    if (element.id) return "#" + cssEscape(element.id);
    var parts = [];
    var current = element;
    while (current && current.tagName && current.tagName.toLowerCase() !== "html") {
      var part = current.tagName.toLowerCase();
      if (current.classList && current.classList.length > 0) {
        part += "." + Array.prototype.slice.call(current.classList, 0, 2).map(cssEscape).join(".");
      }
      var parent = current.parentElement;
      if (parent) {
        var siblings = Array.prototype.filter.call(parent.children, function (child) {
          return child.tagName === current.tagName;
        });
        if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")";
      }
      parts.unshift(part);
      current = parent;
    }
    return clip(parts.join(" > "), LIMITS.selector);
  }

  function collectRules(element, rules, bucket) {
    for (var index = 0; index < rules.length && bucket.length < LIMITS.rules; index++) {
      var rule = rules[index];
      if (typeof rule.selectorText === "string") {
        try {
          if (rule.selectorText && element.matches(rule.selectorText)) {
            bucket.push(clip(rule.cssText, LIMITS.rule));
          }
        } catch (error) {
          /* an invalid selector in generated CSS must not break the picker */
        }
        continue;
      }
      if (rule.conditionText && rule.cssRules) {
        var active = false;
        try {
          active = window.matchMedia(rule.conditionText).matches;
        } catch (error) {
          active = false;
        }
        if (active) collectRules(element, rule.cssRules, bucket);
      }
    }
  }

  function collect(element) {
    var computed = {};
    try {
      var styles = window.getComputedStyle(element);
      for (var index = 0; index < KEYS.length; index++) {
        var key = KEYS[index];
        var value = String(styles.getPropertyValue(key) || "").trim();
        if (!value || value === "none" || value === "normal" || value === "auto") continue;
        if (value === "0px" && key !== "gap") continue;
        computed[key] = clip(value, LIMITS.style);
      }
    } catch (error) {
      /* computed styles are a bonus, never a requirement */
    }

    var attributes = {};
    var names = Array.prototype.slice.call(element.attributes || [], 0, LIMITS.attributes);
    for (var attrIndex = 0; attrIndex < names.length; attrIndex++) {
      var attribute = names[attrIndex];
      if (attribute.name === "style" && attribute.value.length > 200) continue;
      attributes[attribute.name] = clip(attribute.value, LIMITS.attributeValue);
    }

    var cssRules = [];
    try {
      var sheets = document.styleSheets;
      for (var sheet = 0; sheet < sheets.length && cssRules.length < LIMITS.rules; sheet++) {
        var rules = null;
        try {
          rules = sheets[sheet].cssRules;
        } catch (error) {
          rules = null;
        }
        if (rules) collectRules(element, rules, cssRules);
      }
    } catch (error) {
      /* cross-origin stylesheets throw; the picker just skips them */
    }

    var parent = element.parentElement;
    var siblings = parent
      ? Array.prototype.slice
          .call(parent.children)
          .filter(function (child) {
            return child !== element;
          })
          .slice(0, 5)
          .map(label)
      : [];

    return {
      selector: selectorFor(element),
      tag: element.tagName.toLowerCase(),
      id: element.id || undefined,
      classes: Array.prototype.slice.call(element.classList || [], 0, LIMITS.attributes),
      text: clip(element.innerText || element.textContent || "", LIMITS.text),
      html: clip(element.outerHTML || "", LIMITS.html),
      attributes: attributes,
      computed: computed,
      cssRules: cssRules,
      parent: parent ? label(parent) : undefined,
      siblings: siblings,
    };
  }

  function ensureStyle() {
    if (document.getElementById("rbuilder-picker-style")) return;
    var style = document.createElement("style");
    style.id = "rbuilder-picker-style";
    style.textContent =
      "[data-rbuilder-hover]{outline:2px solid #3b82f6 !important;outline-offset:2px !important;cursor:crosshair !important;}";
    (document.head || document.documentElement).appendChild(style);
  }

  function clearHover() {
    if (!hovered) return;
    hovered.removeAttribute("data-rbuilder-hover");
    hovered = null;
  }

  function setArmed(next) {
    armed = next === true;
    if (armed) ensureStyle();
    else clearHover();
    try {
      document.documentElement.style.cursor = armed ? "crosshair" : "";
    } catch (error) {
      /* the preview may not have a document element yet */
    }
  }

  function onMove(event) {
    if (!armed) return;
    var target = event.target;
    if (!target || target === document.body || target === document.documentElement) {
      clearHover();
      return;
    }
    if (hovered !== target) {
      clearHover();
      hovered = target;
      target.setAttribute("data-rbuilder-hover", "true");
    }
  }

  function onClick(event) {
    if (!armed) return;
    var target = event.target;
    if (!target || target === document.body || target === document.documentElement) return;
    event.preventDefault();
    event.stopPropagation();
    setArmed(false);
    send(CHANNELS.pick, collect(target));
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.nonce !== NONCE) return;
    if (data.type === CHANNELS.arm) setArmed(data.armed);
  });

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener(
    "keydown",
    function (event) {
      if (event.key === "Escape" && armed) {
        setArmed(false);
        send(CHANNELS.cancel, null);
      }
    },
    true,
  );

  send(CHANNELS.ready, null);
})();`;
}

/**
 * Add the collector to a previewed document. The script tag carries the nonce,
 * so injecting twice (or into an already tagged document) is a no-op and the
 * parent can tell its own script from anything the generated app prints.
 */
export function injectPreviewPicker(html: string, nonce: string): string {
  const marker = `data-rbuilder-picker="${nonce}"`;
  if (html.includes(marker)) return html;
  const tag = `<script ${marker}>${previewPickerScript(nonce)}</script>`;
  const bodyEnd = html.search(/<\/body\s*>/i);
  if (bodyEnd !== -1) return `${html.slice(0, bodyEnd)}${tag}${html.slice(bodyEnd)}`;
  const htmlEnd = html.search(/<\/html\s*>/i);
  if (htmlEnd !== -1) return `${html.slice(0, htmlEnd)}${tag}${html.slice(htmlEnd)}`;
  return `${html}${tag}`;
}

/** A per-preview secret, so only our own frames can send pick messages. */
export function createPreviewNonce(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `rb-${Date.now().toString(36)}-${random}`;
}
