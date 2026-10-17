# astro-strict-csp

[![CI](https://github.com/Evgenii-Zinner/astro-strict-csp/actions/workflows/ci.yml/badge.svg)](https://github.com/Evgenii-Zinner/astro-strict-csp/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/Evgenii-Zinner/astro-strict-csp/graph/badge.svg)](https://codecov.io/gh/Evgenii-Zinner/astro-strict-csp)
[![npm version](https://img.shields.io/npm/v/astro-strict-csp.svg?color=cb3837)](https://www.npmjs.com/package/astro-strict-csp)
[![dependencies](https://img.shields.io/badge/dependencies-0-success.svg)](https://www.npmjs.com/package/astro-strict-csp)
[![code style: biome](https://img.shields.io/badge/code_style-biome-60a5fa.svg?style=flat)](https://biomejs.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

> **Zero-Dependency Astro Integration for Strict Content Security Policy (Zero `unsafe-inline`), Inline Style & Script Bundling, and Subresource Integrity (SRI).**
>
> 📖 **[Read Full Architecture & Developer Reference (DOCS.md)](./DOCS.md)** — Detailed module breakdown, edge-case protections, and exact filesystem/HTML side effects.

---

## 1. Executive Summary & Value Proposition

Achieving a true **A+ security score** (e.g. on Mozilla Observatory, Google CSP Evaluator, SOC 2, HIPAA, or PCI-DSS audits) requires enforcing a strict Content Security Policy without `'unsafe-inline'`:
```http
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self';
```

In standard Astro builds, strict policies break because:
1. **Inline Styles (`style="..."` & `<style>`):** Shiki code blocks, UI framework components (React, Vue, Svelte, Preact), `<Image />` layout wrappers, third-party widgets, and SVGs inject inline styles. Without extraction, these require `'unsafe-inline'`.
2. **Inline Scripts (`<script>`):** Client hydration scripts, analytics snippets, and theme toggles force `'unsafe-inline'` on `script-src` unless extracted or manually hashed.
3. **Missing Subresource Integrity (SRI):** Astro has no built-in SRI hashing. If assets hosted on a CDN or cloud storage are tampered with, browsers cannot verify their cryptographic integrity.

`astro-strict-csp` solves all of these issues in a single, **modular, zero-runtime-dependency** integration.

---

## 2. Core Modules & Features

### 🎨 Modular Inline Style Extractor
- Scans `dist/**/*.html` during `astro:build:done`.
- Extracts `style="..."` attributes across all elements: standard HTML, custom web components (e.g., `<astro-island>`, `<my-widget>`), and SVG elements (`<svg>`, `<path>`).
- Replaces inline styles with deterministic CSS utility classes (default: `.is-[hash]` using MD5 6-char hash).
- Extracts `<style>...</style>` inline stylesheets.
- Deduplicates style rules across your entire site and writes them to `dist/_astro/inline-styles.css` (configurable name).
- Injects `<link rel="stylesheet" href="/_astro/inline-styles.css">` into `<head>` only on pages that contain extracted styles.

### 📜 Modular Inline Script Extractor
- Scans for inline `<script>` tags without a `src` attribute.
- Skips non-executable structured data blocks (e.g. `type="application/ld+json"`, `type="application/json"`).
- Hashes script contents and emits external bundles: `dist/_astro/inline-[hash].js`.
- Replaces inline tags with `<script src="/_astro/inline-[hash].js" type="module"></script>` (preserving attributes like `async`, `defer`, `id`, `nonce`).

### 🛡️ Subresource Integrity (SRI) Hasher
- Computes cryptographic hashes (`sha384`, `sha256`, or `sha512`) for all local `<script src="...">` tags and `<link rel="stylesheet">` tags.
- Injects `integrity="sha384-..."` and `crossorigin="anonymous"` into output HTML tags.

### 🔒 Strict CSP Enforcer
- Generates strict CSP directives without `'unsafe-inline'` or `'unsafe-eval'`.
- Injects `<meta http-equiv="Content-Security-Policy">` into `<head>` (stripping directives unsupported in meta tags like `frame-ancestors`).
- Optionally creates or updates `dist/_headers` for Cloudflare Pages, Netlify, and other static edge hosts.

### ⚡ Zero Dependencies & Zero Overhead
- **0 runtime dependencies:** Pure Node.js / Bun native APIs (`node:crypto`, `node:fs`, `node:path`, `node:url`).
- **Post-build execution:** 0 runtime penalty, emitting 100% standard static HTML, CSS, and JS.

---

## 3. Installation & Usage

```bash
# npm
npm install -D astro-strict-csp

# pnpm
pnpm add -D astro-strict-csp

# bun
bun add -d astro-strict-csp
```

### Basic Configuration (`astro.config.mjs`)

```typescript
import { defineConfig } from "astro/config";
import strictCsp from "astro-strict-csp";

export default defineConfig({
  site: "https://example.com",
  build: {
    // Recommended so Astro emits external CSS instead of inlining small stylesheets
    inlineStylesheets: "never",
  },
  integrations: [
    strictCsp(),
  ],
});
```

### Full Configuration Options

```typescript
import { defineConfig } from "astro/config";
import strictCsp from "astro-strict-csp";

export default defineConfig({
  site: "https://example.com",
  build: {
    inlineStylesheets: "never",
  },
  integrations: [
    strictCsp({
      // 1. Style extraction (Shiki, UI components, SVG, custom elements)
      extractStyles: {
        enabled: true,
        outputFileName: "inline-styles.css", // Emitted into dist/_astro/inline-styles.css
        classPrefix: "is-",                  // Utility class prefix (.is-4a2f1b)
        extractAttributes: true,             // Extract style="..." attributes
        extractStyleTags: true,               // Extract <style>...</style> blocks
        injectOnlyWhenUsed: true,            // Only inject <link> on pages using extracted styles
      },

      // 2. Script extraction (Hydration snippets, analytics, theme toggles)
      extractScripts: {
        enabled: true,
        filePrefix: "inline-",               // Emitted into dist/_astro/inline-[hash].js
        ignoreTypes: [
          "application/ld+json",
          "application/json",
          "text/template",
        ],
        asModule: true,                      // Add type="module" to extracted scripts
      },

      // 3. Subresource Integrity (SRI)
      sri: {
        enabled: true,
        algorithm: "sha384",                 // "sha256" | "sha384" | "sha512"
        includeScripts: true,
        includeStylesheets: true,
        crossorigin: "anonymous",            // "anonymous" | "use-credentials" | false
      },

      // 4. Content Security Policy (Optional)
      csp: {
        enabled: true,                       // false by default
        generateMetaTag: true,               // Injects <meta> CSP in <head>
        generateHeadersFile: true,           // Updates/creates dist/_headers
        directives: {
          "default-src": ["'none'"],
          "script-src": ["'self'"],
          "style-src": ["'self'"],
          "img-src": ["'self'", "data:"],
          "font-src": ["'self'"],
          "connect-src": ["'self'"],
          "frame-ancestors": ["'none'"],
          "base-uri": ["'self'"],
          "form-action": ["'none'"],
          "upgrade-insecure-requests": true,
        },
      },
    }),
  ],
});
```

---

## 4. Architecture & Build Lifecycle

```
Astro Build Pipeline
       │
       ▼
 [astro:build:done]
       │
       ├─► 1. Scan all dist/**/*.html files
       │
       ├─► 2. Inline Style Extractor
       │      ├─ Find all style="..." attributes (HTML, SVG, custom web components)
       │      ├─ Hash style strings (MD5 6-char, e.g. is-a1b2c3)
       │      ├─ Replace with class="is-[hash]"
       │      ├─ Extract inline <style> blocks
       │      ├─ Write deduplicated dist/_astro/inline-styles.css
       │      └─ Inject <link rel="stylesheet"> on pages with extracted styles
       │
       ├─► 3. Inline Script Extractor
       │      ├─ Find <script> tags without src (skipping JSON-LD)
       │      ├─ Hash content & write dist/_astro/inline-[hash].js
       │      └─ Replace with <script src="/_astro/inline-[hash].js" type="module">
       │
       ├─► 4. SRI Injector
       │      ├─ Find local <script src="..."> and <link rel="stylesheet" href="...">
       │      ├─ Calculate sha384(assetBuffer)
       │      └─ Inject integrity="sha384-..." and crossorigin="anonymous"
       │
       ├─► 5. CSP Enforcer
       │      ├─ Format strict CSP without 'unsafe-inline'
       │      ├─ Inject <meta http-equiv="Content-Security-Policy">
       │      └─ Write dist/_headers (Cloudflare/Netlify)
       │
       ▼
 Emitted Production Artifacts (Ready for strict A+ CSP without 'unsafe-inline')
```

---

## 5. Programmatic API Exports

In addition to the Astro integration default export, `astro-strict-csp` exports its modular utilities for custom post-processing pipelines or SSR middleware:

```typescript
import {
  extractInlineStylesFromHtml,
  extractInlineScriptsFromHtml,
  injectSriIntoHtml,
  formatCspDirectives,
  injectCspMetaTag,
  writeHeadersFile,
  computeSriHash,
  computeCssClass,
  DEFAULT_STRICT_CSP_DIRECTIVES,
} from "astro-strict-csp";
```

---

## 6. Development & Quality

- **Lint & Format**: `npm run lint` / `npm run lint:fix` / `npm run format` (powered by [Biome](https://biomejs.dev))
- **Test Suite**: `npm run test` / `npm run test:coverage` (35 passing tests, >97% coverage via [Vitest](https://vitest.dev))
- **Build**: `npm run build` (ESM, CJS, and DTS bundles via [tsup](https://tsup.egoist.dev))
- **Pre-publish Validation**: `npm run prepublishOnly` (runs Biome check, rebuilds bundles, and runs test suite)

---

## 7. Contributing & Feedback

Want to report a bug, suggest an improvement, or propose a new use case?

> [!IMPORTANT]
> **Please open an Issue rather than a Pull Request for now.**
> As a solo maintainer, I am not currently able to review and maintain external PRs full-time. However, I actively review and close well-documented **[Issues](https://github.com/Evgenii-Zinner/astro-strict-csp/issues)** that include clear explanations, real-world use cases, and minimal reproductions.

- Read my **[Contribution Guide](./.github/CONTRIBUTING.md)** for issue reporting guidelines.
- Review the **[Code of Conduct](./.github/CODE_OF_CONDUCT.md)** before participating.

---

## 8. License

MIT © [Evgenii Zinner](https://github.com/Evgenii-Zinner)


