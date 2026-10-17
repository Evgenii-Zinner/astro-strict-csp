import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import {
  DEFAULT_STRICT_CSP_DIRECTIVES,
  formatCspDirectives,
  injectCspMetaTag,
  writeHeadersFile,
} from './csp.js';
import {
  createStyleExtractionState,
  extractInlineScriptsFromHtml,
  extractInlineStylesFromHtml,
} from './extractor.js';
import { injectSriIntoHtml } from './sri.js';
import type {
  CspOptions,
  ExtractScriptsOptions,
  ExtractStylesOptions,
  SriOptions,
  StrictCspOptions,
} from './types.js';

export * from './crypto.js';
export * from './csp.js';
export * from './extractor.js';
export * from './html-utils.js';
export * from './sri.js';
export * from './types.js';
export { strictCsp, strictCsp as astroStrictCsp };

/**
 * Recursively find all HTML files in a directory.
 */
function getHtmlFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { recursive: true });

  for (const entry of entries) {
    if (typeof entry === 'string' && entry.endsWith('.html')) {
      results.push(path.join(dir, entry));
    }
  }

  return results;
}

/**
 * Astro Integration for enforcing a Strict Content Security Policy (zero `'unsafe-inline'`),
 * extracting and bundling inline CSS and JavaScript, and calculating Subresource Integrity (SRI) hashes.
 *
 * ### How It Works:
 * 1. **`astro:config:setup`**:
 *    Inspects user configuration and logs a recommendation warning if `build.inlineStylesheets`
 *    is set to `'always'`.
 *
 * 2. **`astro:build:done`**:
 *    Runs a high-performance in-memory post-build transformation pipeline across all HTML files
 *    in the output directory (`dist/`):
 *    - **Stage 1 (Inline Styles)**: Extracts all `style="..."` attributes and `<style>` blocks into
 *      a deduplicated stylesheet (`dist/_astro/inline-styles.css`), replacing inline styles with `.is-[hash]`
 *      utility classes. Injects `<link rel="stylesheet">` into affected pages.
 *    - **Stage 2 (Inline Scripts)**: Extracts all executable `<script>` blocks (skipping structured data
 *      like JSON-LD) into external bundles (`dist/_astro/inline-[hash].js`).
 *    - **Stage 3 (Subresource Integrity)**: Calculates cryptographic digests (`sha384`) for all local
 *      scripts and stylesheets using a shared build cache, injecting `integrity="..."` and `crossorigin="anonymous"`.
 *    - **Stage 4 (Content Security Policy)**: Formats strict directives without `'unsafe-inline'` and injects
 *      a `<meta http-equiv="Content-Security-Policy">` tag in `<head>` and/or updates `dist/_headers`.
 *    - **Stage 5 (Single-Pass Write)**: Overwrites modified HTML files on disk in a single pass.
 *
 * @param options - Configuration options for style extraction, script extraction, SRI, and CSP enforcement.
 * @returns An `AstroIntegration` object satisfying the Astro Integration API.
 *
 * @sideeffects
 * - **Disk Reads**: Reads all `.html` files in `dist/` once, plus referenced local asset files (`.js`, `.css`) for SRI hashing.
 * - **Disk Writes**:
 *   - Emits `dist/_astro/inline-styles.css` if styles were extracted.
 *   - Emits `dist/_astro/inline-[hash].js` for each extracted script.
 *   - Overwrites modified `.html` files in `dist/`.
 *   - Creates or updates `dist/_headers` if `csp.generateHeadersFile` is enabled.
 * - **Astro Logger**: Emits informational logs and warnings via `logger.info()` and `logger.warn()`.
 */
export default function strictCsp(options: StrictCspOptions = {}): AstroIntegration {
  const assetsDir = options.assetsDir || '_astro';

  // Normalize options
  const stylesOpt: ExtractStylesOptions | false =
    options.extractStyles === false
      ? false
      : typeof options.extractStyles === 'object'
        ? options.extractStyles
        : {};

  const scriptsOpt: ExtractScriptsOptions | false =
    options.extractScripts === false
      ? false
      : typeof options.extractScripts === 'object'
        ? options.extractScripts
        : {};

  const sriOpt: SriOptions | false =
    options.sri === false ? false : typeof options.sri === 'object' ? options.sri : {};

  const cspOpt: CspOptions | false =
    options.csp === true ? {} : typeof options.csp === 'object' ? options.csp : false;

  return {
    name: 'astro-strict-csp',
    hooks: {
      'astro:config:setup': ({ config, logger }) => {
        if (config.build?.inlineStylesheets === 'always') {
          logger.warn(
            '[astro-strict-csp] `build.inlineStylesheets` is set to "always". To maximize strict CSP compliance and browser caching, "never" is strongly recommended.',
          );
        }
      },

      'astro:build:done': async ({ dir, logger }) => {
        const outDir = fileURLToPath(dir);
        if (!fs.existsSync(outDir)) return;

        const htmlFiles = getHtmlFiles(outDir);
        if (htmlFiles.length === 0) return;

        const astroDir = path.join(outDir, assetsDir);

        // Load all HTML files into memory to minimize disk I/O to a single read/write pass
        const pageMap = new Map<string, { html: string; modified: boolean }>();
        for (const filePath of htmlFiles) {
          pageMap.set(filePath, {
            html: fs.readFileSync(filePath, 'utf-8'),
            modified: false,
          });
        }

        // ============================================================
        // 1. EXTRACT INLINE STYLES (style="..." attributes and <style>)
        // ============================================================
        let hasExtractedStylesGlobal = false;
        let stylesheetHref = '';

        if (stylesOpt !== false && stylesOpt.enabled !== false) {
          const classPrefix = stylesOpt.classPrefix || 'is-';
          const outputFileName = stylesOpt.outputFileName || 'inline-styles.css';
          const injectOnlyWhenUsed = stylesOpt.injectOnlyWhenUsed !== false;

          const state = createStyleExtractionState(classPrefix);
          const pagesWithExtractedStyles = new Set<string>();

          for (const [filePath, page] of pageMap.entries()) {
            const result = extractInlineStylesFromHtml(page.html, state, {
              ...stylesOpt,
              classPrefix,
              outputFileName,
            });

            if (result.hasExtractedStyles) {
              pagesWithExtractedStyles.add(filePath);
            }

            if (result.modified) {
              page.html = result.html;
              page.modified = true;
            }
          }

          hasExtractedStylesGlobal = state.classToRule.size > 0 || state.rawStyles.size > 0;
          if (hasExtractedStylesGlobal) {
            if (!fs.existsSync(astroDir)) {
              fs.mkdirSync(astroDir, { recursive: true });
            }

            // Combine deduplicated class rules and extracted raw styles
            const cssContent = [
              ...Array.from(state.classToRule.values()),
              ...Array.from(state.rawStyles.values()),
            ].join('\n\n');

            const cssPath = path.join(astroDir, outputFileName);
            fs.writeFileSync(cssPath, cssContent, 'utf-8');

            stylesheetHref = `/${assetsDir}/${outputFileName}`;

            for (const [filePath, page] of pageMap.entries()) {
              const needsStylesheet = !injectOnlyWhenUsed || pagesWithExtractedStyles.has(filePath);

              if (needsStylesheet) {
                const escapedHref = stylesheetHref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const hasLinkTag = new RegExp(
                  `<link\\b[^>]*href=["']${escapedHref}["']`,
                  'i',
                ).test(page.html);

                if (!hasLinkTag && page.html.includes('</head>')) {
                  page.html = page.html.replace(
                    '</head>',
                    () => `  <link rel="stylesheet" href="${stylesheetHref}">\n</head>`,
                  );
                  page.modified = true;
                }
              }
            }

            logger.info(
              `Extracted ${state.classToRule.size} unique style rules (${state.extractedTokenCount} inline declarations) into ${assetsDir}/${outputFileName}.`,
            );
          }
        }

        // ============================================================
        // 2. EXTRACT INLINE SCRIPTS (<script> tags without src)
        // ============================================================
        if (scriptsOpt !== false && scriptsOpt.enabled !== false) {
          const allExtractedScripts = new Map<string, string>(); // filename -> content
          let totalExtractedScriptsCount = 0;

          for (const [_filePath, page] of pageMap.entries()) {
            const result = extractInlineScriptsFromHtml(page.html, scriptsOpt, assetsDir);

            if (result.modified) {
              page.html = result.html;
              page.modified = true;
              for (const script of result.scripts) {
                if (!allExtractedScripts.has(script.filename)) {
                  allExtractedScripts.set(script.filename, script.content);
                }
                totalExtractedScriptsCount++;
              }
            }
          }

          if (allExtractedScripts.size > 0) {
            if (!fs.existsSync(astroDir)) {
              fs.mkdirSync(astroDir, { recursive: true });
            }

            for (const [filename, content] of allExtractedScripts.entries()) {
              const scriptPath = path.join(astroDir, filename);
              fs.writeFileSync(scriptPath, content, 'utf-8');
            }

            logger.info(
              `Extracted ${allExtractedScripts.size} unique inline script(s) (${totalExtractedScriptsCount} instances) into external files in ${assetsDir}/.`,
            );
          }
        }

        // ============================================================
        // 3. COMPUTE & INJECT SRI HASHES (sha384/sha256/sha512)
        // ============================================================
        if (sriOpt !== false && sriOpt.enabled !== false) {
          let totalSriPatched = 0;
          const hashCache = new Map<string, string>();

          for (const [filePath, page] of pageMap.entries()) {
            const result = injectSriIntoHtml(page.html, outDir, sriOpt, filePath, hashCache);
            if (result.modified) {
              page.html = result.html;
              page.modified = true;
              totalSriPatched += result.patchedCount;
            }
          }

          if (totalSriPatched > 0) {
            logger.info(
              `Injected SRI ${sriOpt.algorithm || 'sha384'} hashes into ${totalSriPatched} subresource tag(s).`,
            );
          }
        }

        // ============================================================
        // 4. GENERATE & INJECT CSP (Strict Policy without unsafe-inline)
        // ============================================================
        if (cspOpt !== false && cspOpt.enabled !== false) {
          const directives = cspOpt.directives || DEFAULT_STRICT_CSP_DIRECTIVES;
          const metaPolicy = formatCspDirectives(directives, true);
          const headerPolicy = formatCspDirectives(directives, false);

          const generateMeta = cspOpt.generateMetaTag !== false;
          const generateHeaders =
            cspOpt.generateHeadersFile !== undefined && cspOpt.generateHeadersFile !== false;

          if (generateMeta) {
            for (const [_filePath, page] of pageMap.entries()) {
              const result = injectCspMetaTag(page.html, metaPolicy);
              if (result.modified) {
                page.html = result.html;
                page.modified = true;
              }
            }
            logger.info(`Injected strict CSP <meta> tags into HTML head.`);
          }

          if (generateHeaders) {
            writeHeadersFile(outDir, headerPolicy, cspOpt.generateHeadersFile);
            logger.info(`Generated/updated Content-Security-Policy in _headers file.`);
          }
        }

        // ============================================================
        // 5. WRITE MODIFIED HTML FILES TO DISK (Single Write Pass)
        // ============================================================
        for (const [filePath, page] of pageMap.entries()) {
          if (page.modified) {
            fs.writeFileSync(filePath, page.html, 'utf-8');
          }
        }
      },
    },
  };
}
