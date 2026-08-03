/**
 * OpenStation — Lazy vendor-script loader.
 *
 * Canvas wallpapers routinely want heavy dependencies (PixiJS, Three,
 * phaser) that would balloon the main bundle if eagerly imported.
 * Vite's library-mode IIFE output flattens dynamic `import()` into
 * the main chunk, so we can't rely on code splitting — instead we
 * inject a `<script>` tag the first time a wallpaper needs it and
 * resolve a shared promise to subsequent callers.
 *
 * Exported on `wp.os.loadVendorScript` so third-party canvas
 * plugins can reuse the same memoization and not race each other on
 * first activation.
 */

/**
 * Map of url → in-flight or resolved load promise. Keeps concurrent
 * requests for the same script deduplicated.
 */
const pending = new Map<string, Promise<void>>();

/**
 * Inline `extra` data harvested from a registered WP script handle by
 * {@link open_station_resolve_script_payload} on the server. Without
 * this, the lazy-load path would silently drop everything attached
 * via `wp_localize_script` / `wp_add_inline_script` /
 * `wp_set_script_translations` — the dynamically-appended `<script
 * src=…>` never goes through `wp_print_scripts()`.
 *
 * @public
 */
export interface ScriptExtras {
	/**
	 * `wp.i18n.setLocaleData( … )` snippet emitted by
	 * `wp_set_script_translations()`. A single blob; injected before
	 * the body fires.
	 */
	translations?: string;
	/**
	 * Each entry is a precomputed `var x = …;` style assignment
	 * string from `wp_localize_script()` (multiple `wp_localize_script`
	 * calls on the same handle are concatenated by core into one
	 * `extra['data']` blob, so this is usually a single-element array).
	 */
	l10n?: string[];
	/** `wp_add_inline_script( $h, $code, 'before' )` strings. */
	before?: string[];
	/** `wp_add_inline_script( $h, $code, 'after' )` strings — injected only after the src `load` fires, mirroring `wp_print_scripts` ordering. */
	after?: string[];
}

/**
 * Fetch a remote script by injecting a `<script>` tag into the
 * document. Resolves when the script fires `load`, rejects on
 * `error`. Calls for the same URL after resolution return immediately.
 *
 * When `extras` is supplied, the inline `extra` data is injected as
 * sibling `<script>` tags around the src tag in the same order
 * `WP_Scripts::do_item()` would have used:
 * `translations → l10n → before → <script src> → after`. The `after`
 * snippets are injected only after the src script's `load` event so
 * they don't race the body, mirroring browser parse-order semantics
 * for static HTML.
 *
 * Only same-origin and plugin-hosted URLs should be passed. The
 * shell does no CSP / SRI plumbing here; plugins that need cross-
 * origin integrity should ship their own loader.
 *
 * @param url    Absolute URL of the script.
 * @param extras Optional inline data harvested from the registered handle.
 */
export function loadVendorScript(
	url: string,
	extras?: ScriptExtras,
): Promise<void> {
	const existing = pending.get( url );
	if ( existing ) {
		return existing;
	}

	const promise = new Promise<void>( ( resolve, reject ) => {
		// If the URL is already in the DOM (e.g. another plugin
		// enqueued the same file), wait on its load state rather than
		// double-adding. Note: we deliberately do NOT re-inject extras
		// when re-entering — first caller's extras win, which matches
		// the URL-keyed memoization above. Same URL → same registered
		// handle → same extras.
		const selector = `script[data-os-vendor="${ cssEscape( url ) }"]`;
		const preexisting = document.querySelector<HTMLScriptElement>( selector );
		if ( preexisting ) {
			if ( preexisting.dataset.loaded === '1' ) {
				resolve();
				return;
			}
			preexisting.addEventListener( 'load', () => resolve(), { once: true } );
			preexisting.addEventListener(
				'error',
				() => reject( new Error( `Failed to load ${ url }` ) ),
				{ once: true },
			);
			return;
		}

		// Inline extras that run BEFORE the body — translations, then
		// localized data, then `wp_add_inline_script(..., 'before')`.
		// Each is a synchronous append: an inline `<script>` executes
		// during `appendChild()` so the side-effects are visible by
		// the time we reach the next line.
		if ( extras?.translations ) {
			injectInline( extras.translations );
		}
		for ( const code of extras?.l10n ?? [] ) {
			injectInline( code );
		}
		for ( const code of extras?.before ?? [] ) {
			injectInline( code );
		}

		const script = document.createElement( 'script' );
		script.src = url;
		script.async = true;
		script.dataset.osVendor = url;
		script.addEventListener(
			'load',
			() => {
				script.dataset.loaded = '1';
				// `after` runs only once the body has executed —
				// otherwise it would race the bundle (since the src
				// is `async`). This mirrors the parse-order semantics
				// of static `<script>` tags.
				for ( const code of extras?.after ?? [] ) {
					injectInline( code );
				}
				resolve();
			},
			{ once: true },
		);
		script.addEventListener(
			'error',
			() => {
				// Don't cache failures — a flaky connection should let
				// the next attempt try again.
				pending.delete( url );
				script.remove();
				reject( new Error( `Failed to load ${ url }` ) );
			},
			{ once: true },
		);
		document.head.appendChild( script );
	} );

	pending.set( url, promise );
	return promise;
}

/**
 * Append a synchronous inline `<script>` tag with `code` as the body.
 * `textContent` (not `innerHTML`) is used so the JS isn't HTML-parsed
 * — `</script>` inside string literals can't terminate the tag.
 */
function injectInline( code: string ): void {
	if ( ! code ) {
		return;
	}
	const tag = document.createElement( 'script' );
	tag.textContent = code;
	tag.dataset.osVendorInline = '1';
	document.head.appendChild( tag );
}

/**
 * Narrow helper for escaping strings into a CSS attribute selector.
 * Using the modern `CSS.escape()` when available, falling back to a
 * manual regex replacement. Older browsers that predate `CSS.escape`
 * are extreme outliers for a WP admin — the fallback is conservative
 * rather than robust.
 */
function cssEscape( value: string ): string {
	if ( typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ) {
		return CSS.escape( value );
	}
	return value.replace( /["\\]/g, '\\$&' );
}
