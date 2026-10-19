import { computeContentHash } from './crypto.js';
import { decodeHtmlEntities, maskHtmlRegions } from './html-utils.js';
import type { ExtractEventsOptions } from './types.js';

/**
 * Shared state object holding extracted inline event handlers across all HTML files
 * during the build.
 */
export interface EventExtractionState {
  /** Map of normalized handler JS code -> generated handler ID (e.g. "window.print()" -> "evt-8f1a2c") */
  codeToId: Map<string, string>;
  /** Map of generated handler ID -> normalized handler JS code */
  idToCode: Map<string, string>;
  /** Set of unique event types encountered across all files (e.g. "click", "submit", "change") */
  activeEvents: Set<string>;
  /** Total count of inline event handler attributes extracted across all pages */
  extractedEventCount: number;
}

/**
 * Transformation result for a single HTML file after event extraction.
 */
export interface EventExtractionFileResult {
  /** Modified HTML string with on* attributes replaced by data-csp-on-* */
  html: string;
  /** Whether the input HTML was modified */
  modified: boolean;
  /** Whether this specific HTML file contained extracted event handlers */
  hasExtractedEvents: boolean;
}

/**
 * Creates a shared state for tracking and deduplicating extracted event handlers across all HTML files.
 *
 * @returns Fresh `EventExtractionState` instance.
 */
export function createEventExtractionState(): EventExtractionState {
  return {
    codeToId: new Map(),
    idToCode: new Map(),
    activeEvents: new Set(),
    extractedEventCount: 0,
  };
}

// Regex matching opening HTML/SVG/custom elements, safely handling quoted attribute values
const TAG_RE = /<([\w\-:]+)(\s+(?:[^>"'/]+|"[^"]*"|'[^']*'|\/(?!>))*?)(\s*\/?)>/gi;

// Regex matching individual on<event>= attributes within element tag attributes
const EVENT_ATTR_RE = /(?<![\w\-:])on([a-zA-Z]+)=(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/gi;

/**
 * Extracts inline event handlers (`onclick`, `onsubmit`, `onchange`, etc.) from an HTML string.
 * Replaces inline event attributes with delegated data attributes (`data-csp-on-[event]="evt-[hash]"`),
 * and collects the handler code into the shared build state for bundle generation.
 *
 * @param html - Input HTML content of a single page.
 * @param state - Shared state instance accumulating extracted handlers across the build.
 * @param options - Extraction configuration options.
 * @returns `EventExtractionFileResult` containing updated HTML and metadata.
 *
 * @sideeffects
 * - Mutates the provided `state` parameter in-memory (`state.codeToId`, `state.idToCode`,
 *   `state.activeEvents`, `state.extractedEventCount`).
 * - Does NOT perform disk I/O.
 */
export function extractInlineEventsFromHtml(
  html: string,
  state: EventExtractionState,
  options: ExtractEventsOptions = {},
): EventExtractionFileResult {
  const { dataAttributePrefix = 'data-csp-on-' } = options;

  let modified = false;
  let hasExtractedEvents = false;

  // Quick check: if no "on" attributes present, return untouched
  if (!/(?<![\w\-:])on[a-zA-Z]+=/i.test(html)) {
    return { html, modified: false, hasExtractedEvents: false };
  }

  // Mask non-executable regions and scripts to prevent false matches inside comments, CDATA, textareas, or JS
  const { masked, unmask } = maskHtmlRegions(html, { maskScripts: true });
  let processedHtml = masked;

  processedHtml = processedHtml.replace(TAG_RE, (match, tag, attrs, closing) => {
    // Quick check if this specific tag has any on* attributes
    if (!/(?<![\w\-:])on[a-zA-Z]+=/i.test(attrs)) {
      return match;
    }

    // Allow opting out via data-preserve or data-csp-ignore on the element
    if (/(?<![\w\-:])data-(?:preserve|csp-ignore)/i.test(attrs)) {
      return match;
    }

    const newAttrs = attrs.replace(
      EVENT_ATTR_RE,
      (_attrMatch: string, eventName: string, doubleQuoted?: string, singleQuoted?: string) => {
        const event = eventName.toLowerCase();
        const rawCode = doubleQuoted ?? singleQuoted ?? '';
        const code = decodeHtmlEntities(rawCode).trim();

        if (!code) {
          return ''; // Strip empty event handler
        }

        let handlerId = state.codeToId.get(code);
        if (!handlerId) {
          handlerId = `evt-${computeContentHash(code, 6)}`;
          state.codeToId.set(code, handlerId);
          state.idToCode.set(handlerId, code);
        }

        state.activeEvents.add(event);
        state.extractedEventCount++;
        hasExtractedEvents = true;

        return `${dataAttributePrefix}${event}="${handlerId}"`;
      },
    );

    modified = true;
    return `<${tag}${newAttrs}${closing}>`;
  });

  return {
    html: modified ? unmask(processedHtml) : html,
    modified,
    hasExtractedEvents,
  };
}

/**
 * Generates the minimal, zero-dependency delegated runtime dispatcher script
 * that attaches event listeners to `document` and routes events to their extracted handlers.
 *
 * @param state - Event extraction state containing collected handler functions and active event types.
 * @param dataAttributePrefix - Prefix for data attributes (default: `'data-csp-on-'`).
 * @returns JavaScript code for the external dispatcher bundle.
 */
export function generateEventDispatcherScript(
  state: EventExtractionState,
  dataAttributePrefix = 'data-csp-on-',
): string {
  const handlersObj: string[] = [];
  for (const [id, code] of state.idToCode.entries()) {
    handlersObj.push(`    ${JSON.stringify(id)}: function(event) {\n      ${code}\n    }`);
  }

  const eventsArray = JSON.stringify(Array.from(state.activeEvents).sort());

  return `/**
 * Generated by astro-strict-csp.
 * Delegated runtime dispatcher for inline event handlers under Strict CSP.
 */
(function() {
  var h = {
${handlersObj.join(',\n')}
  };
  var events = ${eventsArray};
  var prefix = ${JSON.stringify(dataAttributePrefix)};

  for (var i = 0; i < events.length; i++) {
    (function(eventName) {
      var attr = prefix + eventName;
      document.addEventListener(eventName, function(e) {
        var el = e.target && e.target.closest ? e.target.closest('[' + attr + ']') : null;
        if (el) {
          var id = el.getAttribute(attr);
          var fn = h[id];
          if (fn) {
            var res = fn.call(el, e);
            if (res === false) {
              e.preventDefault();
            }
          }
        }
      }, true);
    })(events[i]);
  }
})();
`;
}
