# AGENTS.md — Development Guidelines for AI Assistants

This repository contains `astro-strict-csp`, a zero-runtime-dependency Astro integration for strict Content Security Policy (CSP), inline style and script extraction, bundling, and Subresource Integrity (SRI) hashing.

---

## 1. Core Architecture Principles

1. **Zero Runtime Dependencies**:
   - The package MUST maintain **zero production runtime dependencies** (`"dependencies": {}` in `package.json`).
   - Only rely on native Node.js / Bun standard library modules (`node:crypto`, `node:fs`, `node:path`, `node:url`).
   - Do NOT introduce external DOM or HTML parsers (like `cheerio`, `jsdom`, or `node-html-parser`).

2. **Strict TypeScript & Clean Code**:
   - Strict mode is enabled (`"strict": true` in `tsconfig.json`).
   - **Zero `any` policy**: Do not use `as any`, `: any`, `<any>`, or untyped casts.
   - Do not use non-null assertions (`!`). Use standard conditionals or optional chaining instead.
   - Do not use `@ts-ignore` or `@ts-expect-error`.

3. **Single-Pass Disk I/O**:
   - In `astro:build:done`, load all HTML files into memory once (`pageMap`).
   - Perform style extraction, script extraction, SRI hashing, and CSP injection in-memory.
   - Write back to disk only once per modified file at the end of the hook.

4. **HTML & Regex Parsing Safety**:
   - Always use `maskHtmlRegions()` before regex operations so comments, CDATA, `<textarea>`, and string literals inside `<script>` tags are never erroneously modified.
   - When matching HTML tags, use quote-aware matching (e.g. `TAG_RE`) so `>` characters within attribute values (like `aria-label="Home > Products"`) do not prematurely close tag matches.
   - Use boundary guards `(?<![\w\-:])` before attribute matches (e.g. `style=`, `src=`) to avoid false positives on hyphenated attributes like `data-style=` or `data-src=`.
   - Always decode HTML entities via `decodeHtmlEntities()` before writing extracted styles to CSS.
   - Preserve valid self-closing syntax for `<link ... />` tags when appending SRI `integrity` attributes.

---

## 2. Development Workflow & Commands

Always use the following npm scripts:

- **Lint & Format**:
  - `npm run lint` — Runs Biome linter and formatting checks.
  - `npm run lint:fix` — Automatically applies safe Biome fixes.
  - `npm run format` — Formats all source, test, and config files.
- **Testing**:
  - `npm run test` — Runs the complete Vitest test suite.
  - `npm run test:coverage` — Runs tests with V8 coverage (must maintain >95% coverage).
- **Build**:
  - `npm run build` — Compiles TypeScript into ESM, CJS, and DTS bundles in `dist/`.
- **Pre-publish Validation**:
  - `npm run prepublishOnly` — Runs linting, rebuilding, and the full test suite in sequence.

---

## 3. Reference Documentation

Consult these files before modifying integration behavior:

- **[`DOCS.md`](./DOCS.md)** — Exhaustive architectural breakdown, module interfaces, edge cases, and all filesystem/HTML side effects.
- **[`README.md`](./README.md)** — Public documentation, usage guide, and configuration options.
- **[`src/types.ts`](./src/types.ts)** — Canonical TypeScript types and option definitions.
