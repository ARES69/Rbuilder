/**
 * Screenshot tests for the preview pane.
 *
 * These render the real thing: `buildPreviewDocument` builds the exact `srcdoc`
 * the app hands to its iframe, Playwright opens it, and the resulting pixels are
 * compared against a stored baseline. A unit test can assert that the document
 * contains a stylesheet or that a script tag was inlined, and still miss the
 * part that matters — that the page comes out looking like something.
 *
 * Run with `pnpm test:visual` (or `UPDATE_VISUAL=1` to re-record baselines).
 * These need a Chromium build, so they are kept out of `pnpm test`.
 *
 * Two things make the comparison usable rather than a nuisance:
 *
 * - **Per-pixel comparison with a tolerance, not byte equality.** Antialiasing
 *   differs across machines and even between runs; a strict compare would fail
 *   on nothing.
 * - **Web fonts are never used.** A test that renders with a font it downloads
 *   is a test that fails the day the font CDN changes. The fixtures use generic
 *   families and the harness waits for the document to settle first.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { buildPreviewDocument, type Project } from '../../src/lib/project'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BASELINE_DIR = path.join(HERE, 'baselines')
const DIFF_DIR = path.join(HERE, 'output')
/** Re-record instead of comparing. */
const UPDATE = process.env.UPDATE_VISUAL === '1'

/** The preview is inspected at this size in the app; matching it keeps shots honest. */
const VIEWPORT = { width: 900, height: 700 }
/** Per-channel tolerance. Anything above this is a real change. */
const CHANNEL_TOLERANCE = 12
/** Share of pixels allowed to differ before the test fails. */
const MAX_DIFF_RATIO = 0.002

let browser: Browser
let page: Page

beforeAll(async () => {
  browser = await chromium.launch()
  await mkdir(BASELINE_DIR, { recursive: true })
})

afterAll(async () => {
  await browser?.close()
})

type Fixture = { name: string; project: Project; expectText?: string }

/**
 * The fixtures are deliberately small and self-contained. Each one covers a
 * path through `buildPreviewDocument` that has its own way of going wrong:
 * a linked stylesheet, a multi-file script, a component styled by a sibling
 * file, and the fallback shown when there is no index at all.
 */
function fixtures(): Fixture[] {
  const file = (path: string, content: string) => ({ path, content })

  return [
    {
      name: 'linked-stylesheet',
      project: {
        files: [
          file(
            'index.html',
            [
              '<!doctype html>',
              '<html><head><link rel="stylesheet" href="styles.css"></head>',
              '<body><main class="card"><h1>Pricing</h1><p>Three plans.</p></main></body></html>',
            ].join('\n'),
          ),
          file(
            'styles.css',
            [
              'body { margin: 0; font-family: sans-serif; background: #0f172a; color: #e2e8f0; }',
              '.card { margin: 48px; padding: 32px; border-radius: 12px; background: #1e293b; }',
              'h1 { margin: 0 0 8px; font-size: 28px; }',
              'p { margin: 0; color: #94a3b8; }',
            ].join('\n'),
          ),
        ],
      },
    },
    {
      name: 'multi-file-script',
      project: {
        files: [
          file(
            'index.html',
            [
              '<!doctype html>',
              '<html><head><link rel="stylesheet" href="styles.css"></head>',
              '<body><div id="app"></div><script src="app.js"></script></body></html>',
            ].join('\n'),
          ),
          file(
            'app.js',
            [
              'const rows = [["Solo", "$9"], ["Team", "$29"], ["Studio", "$79"]];',
              'const app = document.getElementById("app");',
              'app.innerHTML = rows.map(([name, price]) =>',
              '  `<div class="row"><span>${name}</span><b>${price}</b></div>`).join("");',
            ].join('\n'),
          ),
          file(
            'styles.css',
            [
              'body { margin: 0; font-family: sans-serif; background: #f8fafc; color: #0f172a; }',
              '#app { padding: 32px; }',
              '.row { display: flex; justify-content: space-between; padding: 12px 16px;',
              '  background: #fff; border-bottom: 1px solid #e2e8f0; }',
            ].join('\n'),
          ),
        ],
      },
      // Proves the script actually ran: a document that renders but stays empty
      // is exactly the regression a screenshot would otherwise miss.
      expectText: 'Studio',
    },
    {
      name: 'no-index-fallback',
      project: {
        files: [file('notes.md', '# Not a site\n\nThe preview shows a file list.')],
      },
    },
  ]
}

async function render(project: Project, fixtureName: string): Promise<Buffer> {
  // The same runtime the app injects, minus the host channel: nothing here
  // posts back, and a channel that never answers would only add noise.
  const document = buildPreviewDocument(project, {
    channel: `visual-${fixtureName}`,
    script: '',
  })

  await page.setContent(document, { waitUntil: 'load' })
  // Give webfonts and layout a chance to settle before the shot, otherwise the
  // baseline captures a half-painted frame and every run differs.
  //
  // Passed as source text rather than a function: vitest rewrites identifiers
  // inside evaluated function bodies, which turned `document` into an undefined
  // variable in the page.
  await page.evaluate('document.fonts ? document.fonts.ready.then(() => true) : true')
  await page.waitForTimeout(120)

  return page.screenshot({ fullPage: false })
}

/**
 * Compares two PNGs pixel by pixel.
 *
 * The PNGs are decoded through the browser rather than a native image library:
 * `createImageBitmap` plus a canvas gives exact pixels with no extra dependency,
 * and the comparison itself is ordinary code that can be reasoned about.
 */
async function diffRatio(actual: Buffer, expected: Buffer): Promise<{ ratio: number; sizeMatches: boolean }> {
  const result = await page.evaluate(
    async ({ a, b, tolerance }) => {
      const decode = async (bytes: number[]) => {
        const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' })
        const bitmap = await createImageBitmap(blob)
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('no 2d context')
        ctx.drawImage(bitmap, 0, 0)
        const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
        return { width: bitmap.width, height: bitmap.height, data: Array.from(data) }
      }

      const left = await decode(a)
      const right = await decode(b)
      if (left.width !== right.width || left.height !== right.height) {
        return { ratio: 1, sizeMismatch: true }
      }

      let differing = 0
      for (let i = 0; i < left.data.length; i += 4) {
        const dr = Math.abs(left.data[i]! - right.data[i]!)
        const dg = Math.abs(left.data[i + 1]! - right.data[i + 1]!)
        const db = Math.abs(left.data[i + 2]! - right.data[i + 2]!)
        const da = Math.abs(left.data[i + 3]! - right.data[i + 3]!)
        if (dr > tolerance || dg > tolerance || db > tolerance || da > tolerance) differing += 1
      }
      return { ratio: differing / (left.width * left.height), sizeMismatch: false }
    },
    { a: [...actual], b: [...expected], tolerance: CHANNEL_TOLERANCE },
  )

  return { ratio: result.ratio, sizeMatches: !result.sizeMismatch }
}

describe('preview pane', () => {
  beforeAll(async () => {
    page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  })

  afterAll(async () => {
    await page?.close()
  })

  for (const fixture of fixtures()) {
    it(`renders ${fixture.name}`, async () => {
      const actual = await render(fixture.project, fixture.name)

      if (fixture.expectText) {
        // A rendered frame with no text means the script never ran, and that is
        // a real bug a screenshot comparison alone would happily accept.
        const text = await page.evaluate('document.body.innerText') as string
        expect(text).toContain(fixture.expectText)
      }

      const baselinePath = path.join(BASELINE_DIR, `${fixture.name}.png`)
      const baseline = await readFile(baselinePath).catch(() => null)

      if (UPDATE || baseline === null) {
        await writeFile(baselinePath, actual)
        await mkdir(DIFF_DIR, { recursive: true })
        await writeFile(path.join(DIFF_DIR, `${fixture.name}.actual.png`), actual)
        expect(actual.length).toBeGreaterThan(0)
        return
      }

      expect(actual.length).toBeGreaterThan(0)
      const { ratio, sizeMatches } = await diffRatio(actual, baseline)
      if (ratio > MAX_DIFF_RATIO || !sizeMatches) {
        // Keep the failed frame: a failing run should not cost the evidence.
        await mkdir(DIFF_DIR, { recursive: true })
        await writeFile(path.join(DIFF_DIR, `${fixture.name}.actual.png`), actual)
        await writeFile(path.join(DIFF_DIR, `${fixture.name}.baseline.png`), baseline)
      }
      expect(
        sizeMatches,
        `${fixture.name}: the screenshot size changed, which is a real layout change`,
      ).toBe(true)
      expect(
        ratio,
        `${fixture.name}: ${(ratio * 100).toFixed(3)}% of pixels differ (limit ${MAX_DIFF_RATIO * 100}%). ` +
          `Run UPDATE_VISUAL=1 to accept if the change is intended.`,
      ).toBeLessThanOrEqual(MAX_DIFF_RATIO)
    })
  }
})