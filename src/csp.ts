import fs from 'node:fs';
import path from 'node:path';
import { maskHtmlRegions } from './html-utils.js';
import type { CspDirectives } from './types.js';

/**
 * Standard strict Content Security Policy directives matching Mozilla Observatory
 * and Google CSP Evaluator A+ recommendations (zero 'unsafe-inline', zero 'unsafe-eval').
 */
export const DEFAULT_STRICT_CSP_DIRECTIVES: CspDirectives = {
  'default-src': ["'none'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  'img-src': ["'self'", 'data:'],
  'font-src': ["'self'"],
  'connect-src': ["'self'"],
  'frame-ancestors': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'none'"],
  'upgrade-insecure-requests': true,
};

/**
 * Formats a `CspDirectives` configuration object into a standard CSP header value string.
 *
 * Directives with boolean `false`, `null`, or `undefined` values are omitted.
 * Directives with boolean `true` (such as `upgrade-insecure-requests`) are formatted without values.
 *
 * @param directives - Key-value map of CSP directive names to values (arrays, strings, or booleans).
 * @param isMetaTag - When `true`, automatically strips directives disallowed in HTML `<meta>` tags
 *                    by the W3C CSP specification (`frame-ancestors`, `report-uri`, `sandbox`)
 *                    to prevent browser console warnings.
 * @returns Serialized CSP policy string (e.g. `default-src 'none'; script-src 'self'; style-src 'self'`).
 *
 * @sideeffects None (pure formatting function).
 */
export function formatCspDirectives(directives: CspDirectives, isMetaTag = false): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(directives)) {
    if (value === false || value === undefined || value === null) {
      continue;
    }

    // Directives not permitted in <meta http-equiv="Content-Security-Policy">
    if (isMetaTag && (key === 'frame-ancestors' || key === 'report-uri' || key === 'sandbox')) {
      continue;
    }

    if (value === true) {
      parts.push(key);
    } else if (Array.isArray(value)) {
      if (value.length > 0) {
        parts.push(`${key} ${value.join(' ')}`);
      }
    } else if (typeof value === 'string' && value.trim()) {
      parts.push(`${key} ${value.trim()}`);
    }
  }

  return parts.join('; ');
}

/**
 * Injects or updates a `<meta http-equiv="Content-Security-Policy">` tag inside the `<head>` of an HTML document.
 *
 * If a CSP `<meta>` tag already exists, its `content="..."` attribute is replaced.
 * Otherwise, the tag is inserted immediately before `</head>`.
 *
 * @param html - Input HTML content of a single page.
 * @param cspPolicy - Serialized CSP policy string (should be generated with `isMetaTag: true`).
 * @returns Object with the updated `html` and `modified` boolean flag.
 *
 * @sideeffects None (in-memory string manipulation, does NOT write to disk).
 */
export function injectCspMetaTag(
  html: string,
  cspPolicy: string,
): { html: string; modified: boolean } {
  const metaTag = `<meta http-equiv="Content-Security-Policy" content="${cspPolicy}">`;

  // Mask comments to avoid modifying commented-out meta tags
  const { masked, unmask } = maskHtmlRegions(html, { maskScripts: false });
  let processedHtml = masked;

  // If an active CSP meta tag already exists, update its content attribute
  if (/<meta\b[^>]*?http-equiv=(["'])Content-Security-Policy\1[^>]*?>/i.test(processedHtml)) {
    processedHtml = processedHtml.replace(
      /<meta\b([^>]*?)http-equiv=(["'])Content-Security-Policy\2([^>]*?)>/i,
      (_match, before, quote, after) => {
        // Strip existing content attribute if present
        const clean = (before + after)
          .replace(/(?<![\w\-:])content=(["'])(.*?)\1/i, '')
          .replace(/\s+/g, ' ')
          .trim();
        return `<meta http-equiv=${quote}Content-Security-Policy${quote} content="${cspPolicy}"${clean ? ` ${clean}` : ''}>`;
      },
    );
    return { html: unmask(processedHtml), modified: true };
  }

  // Otherwise insert before </head>
  if (processedHtml.includes('</head>')) {
    processedHtml = processedHtml.replace('</head>', () => `  ${metaTag}\n</head>`);
    return {
      html: unmask(processedHtml),
      modified: true,
    };
  }

  return { html, modified: false };
}

/**
 * Appends or updates the `Content-Security-Policy` header in a static hosting `_headers` file
 * (compatible with Cloudflare Pages, Netlify, and other static edge hosts).
 *
 * If `_headers` already contains a `Content-Security-Policy:` line, it is replaced with the new policy.
 * Otherwise, it is added to the wildcard `/*` route header block.
 *
 * @param distDir - Absolute path to the build output directory (`dist/`).
 * @param cspPolicy - Serialized CSP policy string (can include HTTP-only directives like `frame-ancestors`).
 * @param targetFile - Custom header file path relative to `distDir`. Defaults to `'_headers'`.
 *
 * @sideeffects
 * - Disk I/O: Reads from and overwrites/creates the headers file (`dist/_headers`).
 */
export function writeHeadersFile(
  distDir: string,
  cspPolicy: string,
  targetFile?: string | boolean,
): void {
  const filename = typeof targetFile === 'string' ? targetFile : '_headers';
  const headersFilePath = path.join(distDir, filename);
  const headerLine = `  Content-Security-Policy: ${cspPolicy}`;

  let content = '';
  if (fs.existsSync(headersFilePath)) {
    content = fs.readFileSync(headersFilePath, 'utf-8');
  } else {
    content = '/*\n';
  }

  if (/^[ \t]*Content-Security-Policy:.*$/m.test(content)) {
    content = content.replace(/^[ \t]*Content-Security-Policy:.*$/m, () => headerLine);
  } else {
    if (content.includes('/*')) {
      content = content.replace('/*', () => `/*\n${headerLine}`);
    } else {
      content = `/*\n${headerLine}\n${content}`;
    }
  }

  fs.writeFileSync(headersFilePath, content, 'utf-8');
}
