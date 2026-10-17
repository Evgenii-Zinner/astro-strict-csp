import fs from 'node:fs';
import path from 'node:path';
import { computeSriHash } from './crypto.js';
import { decodeHtmlEntities, maskHtmlRegions } from './html-utils.js';
import type { SriOptions } from './types.js';

export interface SriResult {
  /** Modified HTML string with integrity and crossorigin attributes injected */
  html: string;
  /** Whether any tags were modified in the HTML */
  modified: boolean;
  /** Number of script and stylesheet tags successfully patched with integrity attributes */
  patchedCount: number;
}

/**
 * Resolves an asset URL to an absolute disk path within the output directory.
 * Guards against directory traversal attacks.
 *
 * @param outDir - Root output directory (e.g. `dist/`).
 * @param assetUrl - Relative or root-relative URL from HTML attribute (e.g. `/_astro/main.css`).
 * @param htmlFilePath - Optional absolute path to the HTML file referencing this asset.
 * @returns Absolute filesystem path, or `null` if the asset resolves outside `outDir`.
 *
 * @sideeffects None (pure path resolution).
 */
function resolveAssetPath(outDir: string, assetUrl: string, htmlFilePath?: string): string | null {
  const cleanUrl = decodeHtmlEntities(assetUrl).split('?')[0].split('#')[0];
  let resolved: string;

  if (cleanUrl.startsWith('/')) {
    resolved = path.resolve(outDir, cleanUrl.slice(1));
  } else if (htmlFilePath) {
    resolved = path.resolve(path.dirname(htmlFilePath), cleanUrl);
  } else {
    resolved = path.resolve(outDir, cleanUrl);
  }

  const normalizedOutDir = path.resolve(outDir);
  // Ensure the resolved path does not traverse outside of outDir
  if (resolved !== normalizedOutDir && !resolved.startsWith(normalizedOutDir + path.sep)) {
    return null;
  }

  return resolved;
}

/**
 * Computes and injects Subresource Integrity (SRI) `integrity="..."` and `crossorigin="..."`
 * attributes for all local scripts and stylesheets referenced in the HTML document.
 *
 * Robustness & Behavior:
 * - Skips external URLs (`https://`, `http://`, `//`, `data:`).
 * - Skips tags that already have an `integrity` attribute.
 * - Correctly preserves self-closing `<link ... />` tags without generating stray slashes.
 * - Resolves relative assets (`../../_astro/asset.js`) relative to the HTML file location.
 * - Guards against directory traversal attacks outside the build `outDir`.
 * - Supports multi-token `rel` attributes (e.g. `rel="preload stylesheet"`).
 * - Masks comments so commented-out resources are never patched.
 *
 * @param html - Input HTML content of a single page.
 * @param outDir - Absolute path to the build output directory (`dist/`).
 * @param options - SRI configuration options (algorithm, crossorigin, tag filters).
 * @param htmlFilePath - Optional path of the current HTML file for relative asset resolution.
 * @param hashCache - Optional shared Map cache (`assetPath -> integrityString`) shared across all pages.
 * @returns `SriResult` with updated HTML and patch statistics.
 *
 * @sideeffects
 * - Disk Read: Reads local referenced asset files (`.js`, `.css`) from disk to compute SRI digests.
 * - In-Memory Cache: Populates the provided `hashCache` Map with computed digests.
 * - Does NOT write to disk.
 */
export function injectSriIntoHtml(
  html: string,
  outDir: string,
  options: SriOptions = {},
  htmlFilePath?: string,
  hashCache?: Map<string, string>,
): SriResult {
  const {
    algorithm = 'sha384',
    includeScripts = true,
    includeStylesheets = true,
    crossorigin = 'anonymous',
  } = options;

  let modified = false;
  let patchedCount = 0;

  const localHashCache = hashCache || new Map<string, string>();

  function getSriForFile(assetPath: string): string | null {
    const cached = localHashCache.get(assetPath);
    if (cached !== undefined) {
      return cached;
    }
    if (!fs.existsSync(assetPath)) {
      return null;
    }
    try {
      const buffer = fs.readFileSync(assetPath);
      const integrity = computeSriHash(buffer, algorithm);
      localHashCache.set(assetPath, integrity);
      return integrity;
    } catch {
      return null;
    }
  }

  // Mask HTML comments, CDATA, and textarea blocks to avoid altering commented-out or literal assets
  const { masked, unmask } = maskHtmlRegions(html, { maskScripts: false });
  let processedHtml = masked;

  // 1. Hash local <script src="...">
  if (includeScripts && /<script\b/i.test(processedHtml)) {
    processedHtml = processedHtml.replace(
      /<script\b([^>]*?)(?<![\w\-:])src=(["'])(.*?)\2([^>]*?)>/gi,
      (match, before, quote, src, after) => {
        if (/(?<![\w\-:])integrity=/i.test(match)) return match;
        if (
          src.startsWith('http://') ||
          src.startsWith('https://') ||
          src.startsWith('//') ||
          src.startsWith('data:')
        ) {
          return match;
        }

        const assetPath = resolveAssetPath(outDir, src, htmlFilePath);
        if (!assetPath) return match;

        const integrity = getSriForFile(assetPath);
        if (!integrity) return match;

        const crossOriginAttr =
          crossorigin && !/(?<![\w\-:])crossorigin=/i.test(match)
            ? ` crossorigin="${crossorigin}"`
            : '';

        modified = true;
        patchedCount++;
        return `<script${before}src=${quote}${src}${quote} integrity="${integrity}"${crossOriginAttr}${after}>`;
      },
    );
  }

  // 2. Hash local <link rel="stylesheet" href="..."> (also supports multi-token rel, e.g. "preload stylesheet")
  if (includeStylesheets && /<link\b/i.test(processedHtml)) {
    processedHtml = processedHtml.replace(/<link\b([^>]*?)>/gi, (match, attrs) => {
      if (/(?<![\w\-:])integrity=/i.test(match)) return match;

      // Check rel attribute tokens
      const relMatch = attrs.match(/(?<![\w\-:])rel=(?:"([^"]*)"|'([^']*)')/i);
      if (!relMatch) return match;
      const relTokens = (relMatch[1] ?? relMatch[2])
        .trim()
        .split(/\s+/)
        .map((r: string) => r.toLowerCase());
      if (!relTokens.includes('stylesheet')) return match;

      // Extract href attribute
      const hrefMatch = attrs.match(/(?<![\w\-:])href=(?:"([^"]*)"|'([^']*)')/i);
      if (!hrefMatch) return match;
      const href = hrefMatch[1] ?? hrefMatch[2];

      if (
        href.startsWith('http://') ||
        href.startsWith('https://') ||
        href.startsWith('//') ||
        href.startsWith('data:')
      ) {
        return match;
      }

      const assetPath = resolveAssetPath(outDir, href, htmlFilePath);
      if (!assetPath) return match;

      const integrity = getSriForFile(assetPath);
      if (!integrity) return match;

      const crossOriginAttr =
        crossorigin && !/(?<![\w\-:])crossorigin=/i.test(match)
          ? ` crossorigin="${crossorigin}"`
          : '';

      modified = true;
      patchedCount++;

      // Safely replace closing tag, preserving self-closing slash if present
      const isSelfClosing = match.endsWith('/>');
      const slashIndex = isSelfClosing ? match.lastIndexOf('/') : match.lastIndexOf('>');
      const prefix = match.slice(0, slashIndex).trimEnd();
      const closing = isSelfClosing ? ' />' : '>';
      return `${prefix} integrity="${integrity}"${crossOriginAttr}${closing}`;
    });
  }

  return {
    html: modified ? unmask(processedHtml) : html,
    modified,
    patchedCount,
  };
}
