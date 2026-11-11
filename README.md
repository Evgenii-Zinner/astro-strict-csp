# astro-strict-csp

[![CI](https://github.com/Evgenii-Zinner/astro-strict-csp/actions/workflows/ci.yml/badge.svg)](https://github.com/Evgenii-Zinner/astro-strict-csp/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/Evgenii-Zinner/astro-strict-csp/graph/badge.svg)](https://codecov.io/gh/Evgenii-Zinner/astro-strict-csp)
[![npm version](https://img.shields.io/npm/v/astro-strict-csp.svg?color=cb3837)](https://www.npmjs.com/package/astro-strict-csp)
[![dependencies](https://img.shields.io/badge/dependencies-0-success.svg)](https://www.npmjs.com/package/astro-strict-csp)
[![code style: biome](https://img.shields.io/badge/code_style-biome-60a5fa.svg?style=flat)](https://biomejs.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

> **Zero-dependency Astro integration to achieve strict Content Security Policy (zero `'unsafe-inline'`) for both Static (SSG) and Server-Rendered (SSR) sites.**

---

## The Problem

Passing strict security audits (Mozilla Observatory A+, Google CSP Evaluator, SOC 2, HIPAA, PCI-DSS) requires blocking `'unsafe-inline'` scripts and styles:

```http
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self';
```

In standard Astro projects, this strict policy breaks immediately because:
1. **Inline Styles:** Shiki syntax highlighting, UI components (React/Vue/Svelte), and layout wrappers inject inline `style="..."` attributes and `<style>` blocks.
2. **Inline Scripts:** Hydration snippets, analytics, and theme toggles inject inline `<script>` tags without nonces or hashes.
3. **No SRI Hashes:** Local scripts and stylesheets lack Subresource Integrity (`integrity="sha384-..."`), leaving CDN deployments vulnerable to tampering.
4. **SSR Nonce Handling:** Dynamic SSR apps need per-request cryptographic nonces attached to HTTP response headers and exposed to component templates.

`astro-strict-csp` solves all of these out of the box with zero runtime dependencies.

---

## Installation

```bash
# npm
npm install -D astro-strict-csp

# pnpm
pnpm add -D astro-strict-csp

# bun
bun add -d astro-strict-csp
```

Add it to `astro.config.mjs`:

```typescript
import { defineConfig } from "astro/config";
import strictCsp from "astro-strict-csp";

export default defineConfig({
  integrations: [strictCsp()],
});
```

---

## How It Solves Your Setup

The integration automatically adapts to your Astro `output` mode:

### 1. Static Mode (`output: "static"`)
Runs as a post-build transform on `dist/`:
- **Extracts inline styles & `<style>` tags** into a single deduplicated stylesheet (`dist/_astro/inline-styles.css`) and replaces inline declarations with utility classes (`.is-[hash]`).
- **Extracts inline `<script>` tags** into external bundles (`dist/_astro/inline-[hash].js`).
- **Extracts inline event handlers** (`onclick`, `onsubmit`, etc.) into an external runtime dispatcher (`dist/_astro/events-[hash].js`).
- **Computes Subresource Integrity (SRI)** (`sha384`) for all local JS and CSS files and injects `integrity` and `crossorigin` attributes.
- **Sets strict CSP headers** in `dist/_headers` (for Cloudflare Pages, Netlify, etc.) and/or `<meta>` tags.

### 2. SSR Mode (`output: "server"`)
Automatically activates runtime middleware on Cloudflare Workers, Node, Deno, or Bun:
- **Generates cryptographic per-request nonces** and exposes them via `Astro.locals.nonce`.
- **Attaches strict `Content-Security-Policy` HTTP response headers** with `'nonce-{random}'` to all HTML pages.
- **Supports route exclusions** so admin panels or CMS dashboards (e.g. `/_emdash`, `/admin`, `/api`) can run unblocked.

---

## SSR Usage: Adding Nonces to Scripts

In SSR mode, inject the generated nonce into any inline `<script>` tag:

```astro
---
// src/layouts/Layout.astro
const nonce = Astro.locals.nonce;
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>My Secure Site</title>
  </head>
  <body>
    <slot />

    <!-- Protected by dynamic per-request nonce -->
    <script nonce={nonce}>
      console.log("Strict CSP compliant script execution");
    </script>
  </body>
</html>
```

> [!TIP]
> **Inline Event Handlers:** Content Security Policy nonces only apply to `<script>` tags, not inline event handlers like `<button onclick="...">`. To keep your policy strict without `'unsafe-inline'`, attach event listeners inside a nonced script:
> ```html
> <button id="print-btn">Print</button>
> <script nonce={nonce}>
>   document.getElementById('print-btn')?.addEventListener('click', () => window.print());
> </script>
> ```

---

## Configuration Reference

All features are enabled by default with secure defaults. You can customize any module:

```typescript
import { defineConfig } from "astro/config";
import strictCsp from "astro-strict-csp";

export default defineConfig({
  build: {
    // Recommended so Astro emits external CSS instead of inlining small stylesheets
    inlineStylesheets: "never",
  },
  integrations: [
    strictCsp({
      // SSR Settings (only active when output: "server")
      ssr: {
        exclude: ["/_emdash", "/admin", /^\/api\/.*/], // Skip CSP on specific routes
        reportOnly: false,                              // Use Content-Security-Policy-Report-Only
        strictDynamic: false,                           // Append 'strict-dynamic' to script-src
        injectScriptNonce: true,                        // Auto-add 'nonce-...' to script-src
        injectStyleNonce: false,                        // Auto-add 'nonce-...' to style-src
      },

      // Static Build: Style Extraction
      extractStyles: {
        enabled: true,
        outputFileName: "inline-styles.css",
        classPrefix: "is-",
      },

      // Static Build: Script Extraction
      extractScripts: {
        enabled: true,
        asModule: true,
      },

      // Static Build: Event Extraction
      extractEvents: {
        enabled: true,
      },

      // Static Build: Subresource Integrity (SRI)
      sri: {
        enabled: true,
        algorithm: "sha384", // "sha256" | "sha384" | "sha512"
      },

      // Static Build: CSP Headers & Meta Tag
      csp: {
        enabled: false,             // Set true to generate dist/_headers or <meta> tags in SSG
        generateHeadersFile: true,  // Writes dist/_headers for Cloudflare/Netlify
        generateMetaTag: true,
      },
    }),
  ],
});
```

---

## Architecture Reference

For detailed internal pipeline specifications, edge-case defenses (handling `CDATA`, `textarea`, unclosed comments), and AST-free HTML parsing algorithms, see **[DOCS.md](./DOCS.md)**.

---

## License

MIT © [Evgenii Zinner](https://github.com/Evgenii-Zinner)
