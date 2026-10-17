import { computeContentHash, computeCssClass } from './crypto.js';
import { decodeHtmlEntities, isExecutableScriptType, maskHtmlRegions } from './html-utils.js';
import type { ExtractScriptsOptions, ExtractStylesOptions } from './types.js';

/**
 * Shared state object holding extracted CSS declarations, class mappings,
 * and raw style rules collected across all HTML files during the build.
 */
export interface StyleExtractionState {
  /** Map of normalized CSS declaration string -> generated class name (e.g. "color:#f00" -> "is-a1b2c3") */
  styleToClass: Map<string, string>;
  /** Map of generated class name -> complete CSS rule (e.g. "is-a1b2c3" -> ".is-a1b2c3 { color: #f00; }") */
  classToRule: Map<string, string>;
  /** Set of unique raw styles extracted from `<style>` tags across all pages */
  rawStyles: Set<string>;
  /** Total count of inline style attributes extracted across all pages */
  extractedTokenCount: number;
}

/**
 * Metadata for an inline script extracted into an external file.
 */
export interface ExtractedScriptFile {
  /** Filename for the script inside assetsDir (e.g. `inline-d41d8cd9.js`) */
  filename: string;
  /** Raw JavaScript code extracted from the inline script body */
  content: string;
}

/**
 * Transformation result for a single HTML file after style extraction.
 */
export interface StyleExtractionFileResult {
  /** Modified HTML string with inline styles removed and replaced with classes */
  html: string;
  /** Whether the input HTML was modified */
  modified: boolean;
  /** Whether this specific HTML file contained extracted styles or `<style>` tags */
  hasExtractedStyles: boolean;
  /** Set of class names added to this specific HTML file */
  fileExtractedClasses: Set<string>;
}

/**
 * Transformation result for a single HTML file after script extraction.
 */
export interface ScriptExtractionFileResult {
  /** Modified HTML string with inline scripts replaced by external `<script src="...">` tags */
  html: string;
  /** Array of extracted script bundles that need to be written to disk */
  scripts: ExtractedScriptFile[];
  /** Whether the input HTML was modified */
  modified: boolean;
}

/**
 * Creates a shared state for tracking and deduplicating extracted styles across all HTML files.
 *
 * @param classPrefix - Prefix for generated utility classes (e.g. `'is-'`).
 * @returns Fresh `StyleExtractionState` instance.
 *
 * @sideeffects None (pure in-memory object instantiation).
 */
export function createStyleExtractionState(_classPrefix = 'is-'): StyleExtractionState {
  const styleToClass = new Map<string, string>();
  const classToRule = new Map<string, string>();
  const rawStyles = new Set<string>();

  return {
    styleToClass,
    classToRule,
    rawStyles,
    extractedTokenCount: 0,
  };
}

// Regex matching opening HTML/SVG/custom elements, safely handling quoted attribute values containing '>' or '/'
const TAG_RE = /<([\w\-:]+)(\s+(?:"[^"]*"|'[^']*'|[^>"'/]|\/(?!>))*?)(\s*\/?)>/gi;
// Regex matching style attribute with double or single quotes and escaped characters
const STYLE_ATTR_RE = /(?<![\w\-:])style=(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/i;
// Regex matching class attribute
const CLASS_ATTR_RE = /(?<![\w\-:])class=(?:"([^"]*)"|'([^']*)')/i;

/**
 * Extracts inline `style="..."` attributes and `<style>` tags from an HTML string.
 *
 * Supported elements:
 * - Standard HTML elements (`div`, `span`, `p`, etc.)
 * - Custom Web Components with hyphens (e.g. `<astro-island>`, `<my-widget>`)
 * - SVG elements (`<svg>`, `<path>`, `<circle>`, etc.)
 *
 * Safety & Robustness:
 * - Masks HTML comments, CDATA, `<textarea>`, and `<script>` blocks during extraction
 *   so literal code or JS string literals are never accidentally modified.
 * - Decodes HTML entities (`&quot;`, `&apos;`, `&amp;`) before building CSS rules.
 * - Preserves media queries on `<style media="...">` tags as `@media ... { ... }`.
 * - Respects `data-preserve` and `data-csp-ignore` to allow keeping intentional inline styles.
 *
 * @param html - Input HTML content of a single page.
 * @param state - Shared state instance accumulating extracted rules across the build.
 * @param options - Extraction configuration options.
 * @returns `StyleExtractionFileResult` containing updated HTML and metadata.
 *
 * @sideeffects
 * - Mutates the provided `state` parameter in-memory (`state.styleToClass`, `state.classToRule`,
 *   `state.rawStyles`, `state.extractedTokenCount`).
 * - Does NOT perform disk I/O.
 */
export function extractInlineStylesFromHtml(
  html: string,
  state: StyleExtractionState,
  options: ExtractStylesOptions = {},
): StyleExtractionFileResult {
  const { extractAttributes = true, extractStyleTags = true, classPrefix = 'is-' } = options;

  let modified = false;
  let hasExtractedStyles = false;
  const fileExtractedClasses = new Set<string>();

  // Mask non-executable regions and scripts to prevent false matches
  const { masked, unmask } = maskHtmlRegions(html, { maskScripts: true });
  let processedHtml = masked;

  function getClassForStyle(styleStr: string): string {
    const trimmed = styleStr.trim().replace(/^;+|;+$/g, '');
    const existing = state.styleToClass.get(trimmed);
    if (existing) {
      return existing;
    }

    const className = computeCssClass(trimmed, classPrefix);
    state.styleToClass.set(trimmed, className);
    state.classToRule.set(className, `.${className} { ${trimmed}; }`);
    return className;
  }

  // 1. Extract <style>...</style> tags
  if (extractStyleTags && /<style\b/i.test(processedHtml)) {
    let previousHtml: string;
    do {
      previousHtml = processedHtml;
      processedHtml = processedHtml.replace(
        /<style\b([^>]*?)>([\s\S]*?)<\/style[^>]*>/gi,
        (match, attrs, content) => {
          // Allow opting out via data-preserve or data-csp-ignore
          if (/(?<![\w\-:])data-(?:preserve|csp-ignore)/i.test(attrs)) {
            return match;
          }

          const trimmed = content.trim();
          if (trimmed) {
            // If the style tag had a media query attribute (e.g. media="print"), preserve it in external CSS
            const mediaMatch = attrs.match(/(?<![\w\-:])media=(?:"([^"]*)"|'([^']*)')/i);
            const media = mediaMatch ? (mediaMatch[1] ?? mediaMatch[2]).trim() : '';

            const rule = media ? `@media ${media} {\n${trimmed}\n}` : trimmed;
            state.rawStyles.add(rule);
            modified = true;
            hasExtractedStyles = true;
          }
          return '';
        },
      );
    } while (processedHtml !== previousHtml && /<style\b/i.test(processedHtml));
  }

  // 2. Extract style="..." attributes from HTML / SVG / Web Component tags
  if (extractAttributes && /(?<![\w\-:])style=/i.test(processedHtml)) {
    processedHtml = processedHtml.replace(TAG_RE, (match, tag, attrs, closing) => {
      const styleMatch = attrs.match(STYLE_ATTR_RE);
      if (!styleMatch) return match;

      const rawStyleVal = styleMatch[1] ?? styleMatch[2];
      // Decode HTML entities (e.g. &quot; -> ", &apos; -> ') and strip outer semicolons
      const cleanStyleVal = decodeHtmlEntities(rawStyleVal)
        .trim()
        .replace(/^;+/, '')
        .replace(/;+$/, '')
        .trim();

      // Safely remove the style="..." attribute without modifying whitespace inside other attributes
      const styleIndex = attrs.indexOf(styleMatch[0]);
      let newAttrs = (
        attrs.slice(0, styleIndex).trimEnd() +
        ' ' +
        attrs.slice(styleIndex + styleMatch[0].length).trimStart()
      ).trim();
      modified = true;

      // If style was empty or only whitespace/semicolons, simply remove it
      if (!cleanStyleVal) {
        const spacer = newAttrs ? ` ${newAttrs}` : '';
        return `<${tag}${spacer}${closing}>`;
      }

      state.extractedTokenCount++;
      const className = getClassForStyle(cleanStyleVal);
      fileExtractedClasses.add(className);
      hasExtractedStyles = true;

      // Merge className into existing class="..." or insert new class="..."
      const classMatch = newAttrs.match(CLASS_ATTR_RE);
      if (classMatch) {
        const quote = classMatch[0].includes('"') ? '"' : "'";
        const existingVal = classMatch[1] ?? classMatch[2];
        const classes = existingVal.trim().split(/\s+/).filter(Boolean);
        if (!classes.includes(className)) {
          classes.push(className);
        }
        newAttrs = newAttrs.replace(
          classMatch[0],
          () => `class=${quote}${classes.join(' ')}${quote}`,
        );
      } else {
        newAttrs = `class="${className}"${newAttrs ? ` ${newAttrs}` : ''}`;
      }

      const spacer = newAttrs ? ` ${newAttrs}` : '';
      return `<${tag}${spacer}${closing}>`;
    });
  }

  return {
    html: modified ? unmask(processedHtml) : html,
    modified,
    hasExtractedStyles,
    fileExtractedClasses,
  };
}

/**
 * Extracts inline `<script>` tags from HTML into external JavaScript bundles.
 *
 * Supported behavior:
 * - Only extracts executable JavaScript (skips `application/ld+json`, `importmap`, templates).
 * - Preserves execution semantics: classic synchronous scripts remain synchronous by default
 *   (does not force `type="module"` unless `asModule: true` is configured).
 * - Preserves other attributes (`async`, `defer`, `id`, `nonce`).
 * - Respects `data-preserve` and `data-csp-ignore` to keep specific scripts inline.
 * - Masks comments, CDATA, and `<textarea>` to avoid false matches.
 *
 * @param html - Input HTML content of a single page.
 * @param options - Extraction configuration options.
 * @param assetsDir - Output asset directory path relative to root (e.g. `'_astro'`).
 * @returns `ScriptExtractionFileResult` containing modified HTML and array of script bundles to emit.
 *
 * @sideeffects
 * - Pure in-memory string and object transformations.
 * - Does NOT perform disk I/O.
 */
export function extractInlineScriptsFromHtml(
  html: string,
  options: ExtractScriptsOptions = {},
  assetsDir = '_astro',
): ScriptExtractionFileResult {
  const {
    filePrefix = 'inline-',
    ignoreTypes = ['application/ld+json', 'application/json', 'text/template'],
    asModule = false,
  } = options;

  const scripts: ExtractedScriptFile[] = [];
  let modified = false;

  if (!/<script\b/i.test(html)) {
    return { html, scripts, modified: false };
  }

  // Mask non-executable regions (comments, CDATA, textarea)
  const { masked, unmask } = maskHtmlRegions(html, { maskScripts: false });
  let processedHtml = masked;

  processedHtml = processedHtml.replace(
    /<script\b([^>]*?)>([\s\S]*?)<\/script[^>]*>/gi,
    (match, attrs, content) => {
      // If it already has src, leave it alone
      if (/(?<![\w\-:])src=/i.test(attrs)) {
        return match;
      }

      // Skip scripts marked with data-preserve or data-csp-ignore
      if (/(?<![\w\-:])data-(?:preserve|csp-ignore)/i.test(attrs)) {
        return match;
      }

      // Check script type (skip JSON-LD, importmaps, client templates, etc.)
      const typeMatch = attrs.match(/(?<![\w\-:])type=(?:"([^"]*)"|'([^']*)')/i);
      const typeVal = typeMatch ? (typeMatch[1] ?? typeMatch[2]) : undefined;
      if (!isExecutableScriptType(typeVal, ignoreTypes)) {
        return match;
      }

      const trimmed = content.trim();
      if (!trimmed) {
        // Empty script tag, remove it
        modified = true;
        return '';
      }

      // Hash script content
      const hash = computeContentHash(trimmed, 8);
      const filename = `${filePrefix}${hash}.js`;
      scripts.push({
        filename,
        content: trimmed,
      });

      const cleanAttrs = attrs.trim();
      const hasType = /(?<![\w\-:])type=/i.test(cleanAttrs);
      const moduleAttr = asModule && !hasType ? ' type="module"' : '';
      const spacer = cleanAttrs ? ` ${cleanAttrs}` : '';
      modified = true;

      return `<script src="/${assetsDir}/${filename}"${moduleAttr}${spacer}></script>`;
    },
  );

  return {
    html: modified ? unmask(processedHtml) : html,
    scripts,
    modified,
  };
}
