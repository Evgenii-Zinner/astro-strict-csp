/**
 * HTML utility functions for quote-aware parsing, placeholder masking,
 * and entity decoding.
 */

/**
 * Decodes standard HTML entities commonly found in HTML attribute values.
 *
 * Browsers decode entities in `style="..."` before evaluating them in the CSS engine.
 * When extracting inline styles to external CSS files, decoding is essential so the
 * resulting CSS syntax is valid (e.g. `font-family: "Courier New"` instead of `&quot;Courier New&quot;`).
 *
 * @param str - Encoded attribute string value.
 * @returns Decoded plain text string ready for CSS or JavaScript parsing.
 *
 * @sideeffects None (pure function).
 */
export function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#34;/g, '"')
    .replace(/&#x22;/gi, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export interface MaskOptions {
  /**
   * If true, also masks all `<script>...</script>` tags.
   * Useful when extracting inline styles to prevent matching `style="..."` or `<style>`
   * inside JavaScript string literals or templates.
   */
  maskScripts?: boolean;
}

/**
 * Temporarily masks non-executable HTML regions (HTML comments, CDATA sections, `<textarea>`,
 * and optionally `<script>` tags) using unique HTML comment placeholders (`<!--__CSP_MASK_0__-->`).
 *
 * This guarantees that regex matchers for tags, styles, and scripts will never mistakenly match:
 * 1. Commented-out code (`<!-- <script>old()</script> -->` or `<!-- <div style="..."> -->`)
 * 2. Literal code examples inside `<textarea>` blocks
 * 3. JavaScript template strings containing HTML tags during style extraction
 *
 * @param html - Raw input HTML string.
 * @param options - Configuration options for masking.
 * @returns Object containing the `masked` HTML and an `unmask(content)` function to restore original blocks.
 *
 * @sideeffects None (pure in-memory string transformation).
 */
export function maskHtmlRegions(
  html: string,
  options: MaskOptions = {},
): { masked: string; unmask: (content: string) => string } {
  const placeholders: string[] = [];

  const patterns: RegExp[] = [
    // 1. HTML comments: <!-- ... -->
    /<!--[\s\S]*?-->/g,
    // 2. CDATA sections: <![CDATA[ ... ]]>
    /<!\[CDATA\[[\s\S]*?\]\]>/g,
    // 3. Raw textarea elements (content is treated as literal text by browsers)
    /<textarea\b[\s\S]*?<\/textarea>/gi,
  ];

  if (options.maskScripts) {
    // 4. Script elements (to prevent style regexes from matching JS string literals)
    patterns.push(/<script\b[\s\S]*?<\/script>/gi);
  }

  let masked = html;
  for (const pattern of patterns) {
    masked = masked.replace(pattern, (match) => {
      const idx = placeholders.length;
      placeholders.push(match);
      return `<!--__CSP_MASK_${idx}__-->`;
    });
  }

  const unmask = (content: string): string => {
    if (placeholders.length === 0) return content;
    // Uses a functional replacer to avoid interpreting `$` tokens inside restored blocks
    return content.replace(/<!--__CSP_MASK_(\d+)__-->/g, (_, id) => {
      return placeholders[Number(id)] ?? '';
    });
  };

  return { masked, unmask };
}

/**
 * Valid JavaScript MIME types according to the HTML5 specification.
 */
const JS_MIME_TYPES = new Set([
  'module',
  'text/javascript',
  'application/javascript',
  'text/ecmascript',
  'application/ecmascript',
  'text/jscript',
  'text/livescript',
]);

/**
 * Determines whether a script tag's `type` attribute corresponds to executable JavaScript
 * (as opposed to structured data like `application/ld+json`, `importmap`, or client-side HTML templates).
 *
 * Strict CSP (`script-src`) only restricts executable scripts. Non-executable blocks do not
 * violate CSP and should remain inline in the HTML document.
 *
 * @param typeAttr - Content of the script's `type` attribute (if any).
 * @param ignoreTypes - List of MIME types to explicitly ignore.
 * @returns `true` if the script is executable JavaScript; `false` otherwise.
 *
 * @sideeffects None (pure function).
 */
export function isExecutableScriptType(typeAttr?: string, ignoreTypes: string[] = []): boolean {
  if (!typeAttr) return true;
  const clean = typeAttr.trim().toLowerCase();
  if (!clean) return true;

  // Custom user-ignored types
  if (ignoreTypes.some((t) => t.toLowerCase() === clean)) {
    return false;
  }

  return JS_MIME_TYPES.has(clean);
}
