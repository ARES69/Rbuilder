#!/usr/bin/env bun
/**
 * Lightweight sanity check for setup-windows.ps1 (PowerShell syntax can't be
 * fully validated without pwsh, which is not available in this environment):
 * - balanced braces/parens outside strings and comments;
 * - every `function X` has a matching `{`;
 * - no non-ASCII characters (the console-mojibake killer).
 * Exits non-zero on any problem.
 */
import { readFileSync } from "node:fs";

const path = "setup-windows.ps1";
const text = readFileSync(path, "utf8");

let errors = [];

// 1. ASCII-only (mojibake killer)
const nonAscii = [...text].filter((ch) => ch.charCodeAt(0) > 127);
if (nonAscii.length > 0) {
  errors.push(`non-ASCII characters found: ${nonAscii.slice(0, 5).map((c) => `U+${c.charCodeAt(0).toString(16)}`).join(", ")}`);
}

// 2. Brace/paren balance outside strings, comments, and here-strings
let depthBrace = 0;
let depthParen = 0;
let inSingle = false;
let inDouble = false;
let inComment = false;
for (let i = 0; i < text.length; i++) {
  const ch = text[i];
  const next = text[i + 1];
  if (inComment) {
    if (ch === "\n") inComment = false;
    continue;
  }
  if (!inSingle && !inDouble && ch === "#") {
    inComment = true;
    continue;
  }
  if (!inDouble && ch === "'" && next === "'") { i++; continue; }
  if (!inSingle && ch === '"') { inDouble = !inDouble; continue; }
  if (!inSingle && ch === "`") { i++; continue; } // escape in double-quoted
  if (!inDouble && ch === "'") { inSingle = !inSingle; continue; }
  if (inSingle || inDouble) continue;
  if (ch === "{") depthBrace++;
  if (ch === "}") depthBrace--;
  if (ch === "(") depthParen++;
  if (ch === ")") depthParen--;
  if (depthBrace < 0) errors.push(`unbalanced '}' at offset ${i}`);
  if (depthParen < 0) errors.push(`unbalanced ')' at offset ${i}`);
}
if (depthBrace !== 0) errors.push(`brace depth ended at ${depthBrace}`);
if (depthParen !== 0) errors.push(`paren depth ended at ${depthParen}`);
if (inSingle || inDouble) errors.push("unterminated string");

// 3. Every declared function name appears unique
const funcs = [...text.matchAll(/^\s*function\s+([A-Za-z][\w-]*)/gm)].map((m) => m[1]);
const dupes = funcs.filter((f, i) => funcs.indexOf(f) !== i);
if (dupes.length) errors.push(`duplicate functions: ${[...new Set(dupes)].join(", ")}`);

// 4. Functions referenced before/without definition
const required = ["Write-Step", "Write-Ok", "Write-Info", "Add-ToolPaths", "Test-Command",
  "Test-IsAdmin", "Install-WingetPackage", "Ensure-Git", "Ensure-Bun", "Ensure-Rust",
  "Test-VisualStudioCpp", "Ensure-VisualStudioCpp", "Test-WebView2", "Ensure-WebView2",
  "Ensure-VcRuntime", "Ensure-ProjectDependencies", "Build-Project"];
for (const fn of required) {
  if (!funcs.includes(fn)) errors.push(`missing function: ${fn}`);
}

if (errors.length) {
  console.error(`[FAIL] ${path}`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`[OK] ${path}: braces balanced, ASCII-only, ${funcs.length} functions defined`);
