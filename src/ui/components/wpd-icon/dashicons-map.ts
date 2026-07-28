/**
 * Resolve a dashicon name (e.g. `"email-alt"`) to its glyph
 * character.
 *
 * The classic recipe — `<span class="dashicons dashicons-email-alt">`
 * paired with WP core's `.dashicons-foo:before { content: "\fXXX" }`
 * stylesheet — works fine in light DOM but breaks the moment the
 * span is inside a shadow tree (a `<wpd-table>` cell, a
 * `<wpd-confirm-dialog>`, the `<wpd-icon>` component's own shadow).
 * The `:before` rule lives in the document stylesheet, and CSS
 * doesn't pierce shadow boundaries — the span renders as an empty
 * box.
 *
 * We sidestep the whole issue by:
 *   1. Scanning the document's accessible stylesheets ONCE at
 *      module load to extract `.dashicons-foo:before { content: ... }`
 *      rules into a name → character map.
 *   2. Letting consumers render the character DIRECTLY as text
 *      content with `font-family: dashicons` inline. That works
 *      everywhere because the @font-face declaration is
 *      document-global.
 *
 * The cache survives stylesheet load order (see {@link primeOnLoad})
 * and is robust to cross-origin sheets (skipped silently with no
 * console noise).
 *
 * @public
 */

let _cache: Map< string, string > | null = null;

/**
 * Extract the literal glyph from a CSS `content` value such as
 * `"\f465"` or `'\\f465'`. Handles both unescaped and escaped
 * forms, and strips surrounding single / double quotes the CSSOM
 * may add when reading the property.
 */
function parseCssContentToChar( raw: string ): string | null {
	let value = raw.trim();
	if ( value === '' ) {
		return null;
	}
	// CSSOM round-trips `content: "\f465"` as the literal string
	// `"\f465"` (still with quotes). Strip them.
	if (
		( value.startsWith( '"' ) && value.endsWith( '"' ) ) ||
		( value.startsWith( "'" ) && value.endsWith( "'" ) )
	) {
		value = value.slice( 1, -1 );
	}
	// Hex escape `\f465` (with optional trailing whitespace).
	const escaped = value.match( /^\\([0-9a-f]{1,6})\s?$/i );
	if ( escaped ) {
		return String.fromCodePoint( parseInt( escaped[ 1 ], 16 ) );
	}
	// Already a literal character.
	return value || null;
}

/**
 * Walk every accessible stylesheet looking for `.dashicons-foo:before`
 * rules. Builds the cached name → glyph map. CORS-restricted
 * stylesheets are skipped without a fuss — at the worst they
 * leave a few names unresolved, which the caller can detect and
 * fall back from.
 */
function buildMap(): Map< string, string > {
	const map = new Map< string, string >();
	if ( typeof document === 'undefined' ) {
		return map;
	}
	const sheets = Array.from( document.styleSheets ?? [] );
	for ( const sheet of sheets ) {
		let rules: CSSRuleList | null = null;
		try {
			rules = sheet.cssRules;
		} catch {
			// Cross-origin stylesheet without `crossorigin` —
			// accessing cssRules throws SecurityError. Skip; WP's
			// core dashicons sheet is same-origin and reachable.
			continue;
		}
		if ( ! rules ) {
			continue;
		}
		for ( const rule of Array.from( rules ) ) {
			// Tolerate older CSSStyleRule shapes — the property bag
			// always carries `selectorText` and `style.content`.
			const styleRule = rule as CSSStyleRule;
			if ( ! styleRule || ! styleRule.selectorText ) {
				continue;
			}
			const match = styleRule.selectorText.match(
				/\.dashicons-([a-z0-9-]+)::?before/i,
			);
			if ( ! match ) {
				continue;
			}
			const content = styleRule.style?.content;
			if ( ! content ) {
				continue;
			}
			const char = parseCssContentToChar( content );
			if ( char ) {
				map.set( match[ 1 ], char );
			}
		}
	}
	return map;
}

/**
 * Resolve a dashicon name to its glyph character, or `null` when
 * the codepoint isn't known (the icon doesn't exist, or the
 * dashicons stylesheet hasn't loaded yet).
 *
 * Callers that render via `<wpd-icon>` get the resolution
 * automatically; this is exported for ad-hoc DOM construction
 * where pulling in the component is overkill.
 */
export function resolveDashicon( name: string ): string | null {
	if ( ! _cache ) {
		_cache = buildMap();
	}
	const slug = name.startsWith( 'dashicons-' )
		? name.slice( 'dashicons-'.length )
		: name;
	return _cache.get( slug ) ?? null;
}

/**
 * Re-scan stylesheets after a late dashicons load. The framework
 * calls this once on `DOMContentLoaded` AND on the `load` event so
 * scripts that boot before the dashicons sheet has parsed don't
 * end up with a permanently empty cache.
 */
export function refreshDashiconCache(): void {
	_cache = buildMap();
}

/**
 * Schedule a single re-scan on `DOMContentLoaded` (and `load` as a
 * belt-and-braces safety net) so consumers don't have to think
 * about timing. Idempotent — safe to call from every component
 * that uses the resolver.
 */
let _scheduled = false;
export function primeOnLoad(): void {
	if ( _scheduled || typeof window === 'undefined' ) {
		return;
	}
	_scheduled = true;
	const refresh = (): void => {
		refreshDashiconCache();
	};
	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', refresh, { once: true } );
	}
	window.addEventListener( 'load', refresh, { once: true } );
}
