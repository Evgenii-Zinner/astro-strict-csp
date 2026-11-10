import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import { computeContentHash } from './crypto.js';
import {
  DEFAULT_STRICT_CSP_DIRECTIVES,
  formatCspDirectives,
  injectCspMetaTag,
  writeHeadersFile,
} from './csp.js';
import {
  createEventExtractionState,
  extractInlineEventsFromHtml,
  generateEventDispatcherScript,
} from './events.js';
import {
  createStyleExtractionState,
  extractInlineScriptsFromHtml,
  extractInlineStylesFromHtml,
} from './extractor.js';
import { injectSriIntoHtml } from './sri.js';
import type {
  CspOptions,
  ExtractEventsOptions,
  ExtractScriptsOptions,
  ExtractStylesOptions,
  SriOptions,
  SsrCspOptions,
  StrictCspOptions,
} from './types.js';

export * from './crypto.js';
export * from './csp.js';
export * from './events.js';
export * from './extractor.js';
export * from './html-utils.js';
export * from './middleware.js';
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
 * Resolves a module configuration option supporting boolean flags or configuration objects.
 *
 * @param option - Boolean flag or typed option object.
 * @param defaultEnabled - Whether the option defaults to enabled when omitted or true.
 * @returns Typed option object if enabled, or `false` if disabled.
 */
function resolveOption<T extends object>(
  option: boolean | T | undefined,
  defaultEnabled = true,
): T | false {
  if (option === false) return false;
  if (typeof option === 'object' && option !== null) {
    if ('enabled' in option && (option as { enabled?: boolean }).enabled === false) {
      return false;
    }
    return option;
  }
  return defaultEnabled ? ({} as T) : false;
}

/**
 * Astro Integration for enforcing a Strict Content Security Policy (zero `'unsafe-inline'`),
 * extracting and bundling inline CSS and JavaScript, and calculating Subresource Integrity (SRI) hashes.
 *
 * ### Dual Operational Modes:
 * 1. **SSR Mode (`output: "server"`)**:
 *    Automatically registers runtime middleware (`astro-strict-csp/middleware`) via `addMiddleware()`.
 *    Generates dynamic per-request cryptographic nonces (`Astro.locals.nonce`) and sets strict
 *    HTTP `Content-Security-Policy` response headers on HTML routes.
 *
 * 2. **SSG Mode (`output: "static"`)**:
 *    Executes a high-performance in-memory transformation during `astro:build:done`:
 *    - Extracts `style="..."` attributes and `<style>` blocks into deduplicated CSS (`inline-styles.css`).
 *    - Extracts inline scripts into external files (`inline-[hash].js`).
 *    - Injects Subresource Integrity (`integrity="sha384-..."`) into local assets.
 *    - Generates CSP meta tags and updates `dist/_headers`.
 *
 * @param options - Configuration options for style extraction, script extraction, SRI, and CSP enforcement.
 * @returns An `AstroIntegration` object satisfying the Astro Integration API.
 *
 * @sideeffects
 * - **Disk Reads (SSG)**: Reads all `.html` files in `dist/` once, plus referenced local asset files (`.js`, `.css`) for SRI hashing.
 * - **Disk Writes (SSG)**:
 *   - Emits `dist/_astro/inline-styles.css` if styles were extracted.
 *   - Emits `dist/_astro/inline-[hash].js` for each extracted script.
 *   - Overwrites modified `.html` files in `dist/`.
 *   - Creates or updates `dist/_headers` if `csp.generateHeadersFile` is enabled.
 * - **Astro Middleware (SSR)**: Registers `astro-strict-csp/middleware` into the runtime middleware chain.
 * - **Astro Logger**: Emits informational logs and warnings via `logger.info()` and `logger.warn()`.
 */
export default function strictCsp(options: StrictCspOptions = {}): AstroIntegration {
  const assetsDir = options.assetsDir || '_astro';

  // Normalize options cleanly
  const stylesOpt = resolveOption<ExtractStylesOptions>(options.extractStyles, true);
  const scriptsOpt = resolveOption<ExtractScriptsOptions>(options.extractScripts, true);
  const eventsOpt = resolveOption<ExtractEventsOptions>(options.extractEvents, true);
  const sriOpt = resolveOption<SriOptions>(options.sri, true);
  const cspOpt = resolveOption<CspOptions>(options.csp, false);
  const ssrOpt = resolveOption<SsrCspOptions>(options.ssr, true);

  return {
    name: 'astro-strict-csp',
    hooks: {
      'astro:config:setup': ({ config, updateConfig, addMiddleware, logger }) => {
        if (config.build?.inlineStylesheets === 'always') {
          logger.warn(
            '[astro-strict-csp] `build.inlineStylesheets` is set to "always". To maximize strict CSP compliance and browser caching, "never" is strongly recommended.',
          );
        }

        // If Astro is in SSR mode ("server") and SSR CSP is enabled, inject virtual config & middleware
        if (config.output === 'server' && ssrOpt !== false) {
          logger.info(
            '[astro-strict-csp] Detected SSR output mode. Injecting CSP nonce middleware.',
          );

          // Virtual module delivering user options to the middleware bundle
          const virtualId = 'virtual:astro-strict-csp/config';
          const resolvedVirtualId = `\0${virtualId}`;

          updateConfig({
            vite: {
              plugins: [
                {
                  name: 'astro-strict-csp-virtual-config',
                  resolveId(id: string) {
                    if (id === virtualId) {
                      return resolvedVirtualId;
                    }
                  },
                  load(id: string) {
                    if (id === resolvedVirtualId) {
                      return `export const ssrOptions = ${JSON.stringify(ssrOpt)};`;
                    }
                  },
                },
              ],
            },
          });

          addMiddleware({
            entrypoint: 'astro-strict-csp/middleware',
            order: 'pre',
          });
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
                const hasLinkTag = new RegExp(`<link\\b[^>]*href=["']${escapedHref}["']`, 'i').test(
                  page.html,
                );

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
        // 2.5. EXTRACT INLINE EVENT HANDLERS (onclick, onsubmit, etc.)
        // ============================================================
        if (eventsOpt !== false && eventsOpt.enabled !== false) {
          const filePrefix = eventsOpt.filePrefix || 'events-';
          const dataAttributePrefix = eventsOpt.dataAttributePrefix || 'data-csp-on-';
          const injectOnlyWhenUsed = eventsOpt.injectOnlyWhenUsed !== false;

          const state = createEventExtractionState();
          const pagesWithExtractedEvents = new Set<string>();

          for (const [filePath, page] of pageMap.entries()) {
            const result = extractInlineEventsFromHtml(page.html, state, {
              ...eventsOpt,
              dataAttributePrefix,
            });

            if (result.hasExtractedEvents) {
              pagesWithExtractedEvents.add(filePath);
            }

            if (result.modified) {
              page.html = result.html;
              page.modified = true;
            }
          }

          if (state.idToCode.size > 0) {
            if (!fs.existsSync(astroDir)) {
              fs.mkdirSync(astroDir, { recursive: true });
            }

            const dispatcherCode = generateEventDispatcherScript(state, dataAttributePrefix);
            const contentHash = computeContentHash(dispatcherCode, 8);
            const dispatcherFileName = `${filePrefix}${contentHash}.js`;
            const dispatcherPath = path.join(astroDir, dispatcherFileName);
            fs.writeFileSync(dispatcherPath, dispatcherCode, 'utf-8');

            const dispatcherSrc = `/${assetsDir}/${dispatcherFileName}`;

            for (const [filePath, page] of pageMap.entries()) {
              const needsDispatcher = !injectOnlyWhenUsed || pagesWithExtractedEvents.has(filePath);

              if (needsDispatcher) {
                const escapedSrc = dispatcherSrc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const hasScriptTag = new RegExp(
                  `<script\\b[^>]*src=["']${escapedSrc}["']`,
                  'i',
                ).test(page.html);

                if (!hasScriptTag) {
                  if (page.html.includes('</head>')) {
                    page.html = page.html.replace(
                      '</head>',
                      () => `  <script src="${dispatcherSrc}" defer></script>\n</head>`,
                    );
                    page.modified = true;
                  } else if (page.html.includes('</body>')) {
                    page.html = page.html.replace(
                      '</body>',
                      () => `  <script src="${dispatcherSrc}" defer></script>\n</body>`,
                    );
                    page.modified = true;
                  }
                }
              }
            }

            logger.info(
              `Extracted ${state.idToCode.size} unique event handler(s) (${state.extractedEventCount} instances across ${state.activeEvents.size} event types) into ${assetsDir}/${dispatcherFileName}.`,
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
