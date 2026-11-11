# astro-strict-csp

[![CI](https://github.com/Evgenii-Zinner/astro-strict-csp/actions/workflows/ci.yml/badge.svg)](https://github.com/Evgenii-Zinner/astro-strict-csp/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/Evgenii-Zinner/astro-strict-csp/graph/badge.svg)](https://codecov.io/gh/Evgenii-Zinner/astro-strict-csp)
[![npm version](https://img.shields.io/npm/v/astro-strict-csp.svg?color=cb3837)](https://www.npmjs.com/package/astro-strict-csp)
[![dependencies](https://img.shields.io/badge/dependencies-0-success.svg)](https://www.npmjs.com/package/astro-strict-csp)
[![code style: biome](https://img.shields.io/badge/code_style-biome-60a5fa.svg?style=flat)](https://biomejs.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

> Zero-dependency Astro integration enforcing a strict Content Security Policy (zero `'unsafe-inline'`) for both SSR and SSG projects.

---

## Attack Vectors in Astro Projects

Without a strict Content Security Policy (CSP), applications are exposed to Cross-Site Scripting (XSS), session hijacking, and malicious script injection.

Standard Astro setups leave these vectors open because closing them by removing `'unsafe-inline'` immediately breaks typical builds:
- **Inline Styles:** Shiki syntax highlighting, UI components (React, Vue, Svelte), and layout wrappers inject inline `style="..."` attributes and `<style>` blocks.
- **Un-nonced Inline Scripts:** Hydration snippets and client scripts run inline without cryptographic nonces or hashes.
- **Missing SRI Hashes:** Static assets loaded without Subresource Integrity can be tampered with on CDNs or edge proxies.
- **SSR Nonce Handling:** Server-rendered routes need unique, dynamic cryptographic nonces generated per-request and attached to HTTP response headers.

`astro-strict-csp` covers these attack vectors automatically for both static (SSG) and server-rendered (SSR) applications.

---

## How It Works

The integration detects your Astro `output` mode and applies the appropriate defenses:

- **SSR (`output: "server"`)**: Injects runtime middleware that generates a unique cryptographic nonce per request (`Astro.locals.nonce`) and attaches strict `Content-Security-Policy` HTTP response headers to HTML responses.
- **SSG (`output: "static"`)**: Runs post-build to extract inline styles and scripts into external files, hashes all local assets with Subresource Integrity (`integrity="sha384-..."`), and writes strict CSP headers or meta tags.

---

## Requirements & Rules

1. **Do NOT use inline event handlers (`onclick`, `onsubmit`, etc.)**  
   CSP nonces only apply to `<script>` tags, never to inline HTML event attributes. Any `onclick="..."` will be blocked by strict CSP. Always use `addEventListener` inside a nonced `<script>` instead:
   ```html
   <!-- BAD: Blocked by strict CSP -->
   <button onclick="window.print()">Print</button>

   <!-- GOOD: Allowed via nonced script -->
   <button id="print-btn">Print</button>
   <script nonce={Astro.locals.nonce}>
     document.getElementById('print-btn')?.addEventListener('click', () => window.print());
   </script>
   ```

2. **Add `nonce` to your inline `<script>` tags in SSR**  
   In layouts and components, read the nonce from `Astro.locals.nonce`:
   ```astro
   ---
   const nonce = Astro.locals.nonce;
   ---
   <script nonce={nonce}>
     console.log("Safe script execution");
   </script>
   ```

3. **Set `build.inlineStylesheets: "never"`**  
   Configure Astro to emit external CSS files rather than inlining stylesheets into `<style>` tags.

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

---

## Configuration Examples

### 1. Default (Zero-Config)
Automatically handles SSR nonces and headers if `output: "server"`, or static asset extraction if `output: "static"`:

```typescript
// astro.config.mjs
import { defineConfig } from "astro/config";
import strictCsp from "astro-strict-csp";

export default defineConfig({
  build: {
    inlineStylesheets: "never",
  },
  integrations: [strictCsp()],
});
```

### 2. SSR with Excluded Routes (Admin, CMS, APIs)
Exclude specific paths (string prefixes or regexes) from CSP enforcement:

```typescript
// astro.config.mjs
import { defineConfig } from "astro/config";
import strictCsp from "astro-strict-csp";

export default defineConfig({
  output: "server",
  build: {
    inlineStylesheets: "never",
  },
  integrations: [
    strictCsp({
      ssr: {
        // Paths to bypass (e.g. CMS dashboards, admin panels, REST APIs)
        exclude: ["/_emdash", "/admin", /^\/api\/.*/],
        // Set true to log violations without blocking execution
        reportOnly: false,
        // Append 'strict-dynamic' to script-src
        strictDynamic: false,
      },
    }),
  ],
});
```

### 3. Custom CSP Directives
Define custom directive rules for your application:

```typescript
// astro.config.mjs
import { defineConfig } from "astro/config";
import strictCsp from "astro-strict-csp";

export default defineConfig({
  output: "server",
  integrations: [
    strictCsp({
      ssr: {
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'", "https://trusted-cdn.com"],
          "style-src": ["'self'", "https://fonts.googleapis.com"],
          "font-src": ["'self'", "https://fonts.gstatic.com"],
          "img-src": ["'self'", "data:", "https:"],
          "connect-src": ["'self'"],
          "frame-ancestors": ["'none'"],
          "base-uri": ["'self'"],
          "form-action": ["'self'"],
          "upgrade-insecure-requests": true,
        },
      },
    }),
  ],
});
```

### 4. Static (SSG) Full Options
Customize build-time extraction and SRI hashing:

```typescript
// astro.config.mjs
import { defineConfig } from "astro/config";
import strictCsp from "astro-strict-csp";

export default defineConfig({
  output: "static",
  build: {
    inlineStylesheets: "never",
  },
  integrations: [
    strictCsp({
      extractStyles: {
        enabled: true,
        outputFileName: "inline-styles.css",
        classPrefix: "is-",
      },
      extractScripts: {
        enabled: true,
        asModule: true,
      },
      extractEvents: {
        enabled: true, // Extracts inline on* handlers into external runtime dispatcher
      },
      sri: {
        enabled: true,
        algorithm: "sha384", // "sha256" | "sha384" | "sha512"
      },
      csp: {
        enabled: true,
        generateHeadersFile: true, // Emits dist/_headers (Cloudflare/Netlify)
        generateMetaTag: true,
      },
    }),
  ],
});
```

---

## Technical Reference

For internal pipeline architecture, AST-free HTML parsing algorithms, and edge-case defenses (`CDATA`, `textarea`, unclosed comments), see **[DOCS.md](./DOCS.md)**.

---

## License

MIT © [Evgenii Zinner](https://github.com/Evgenii-Zinner)
