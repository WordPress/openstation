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

import { findScriptByPath, isScriptInDocument } from '../script-presence';

/**
 * Map of url → in-flight or resolved load promise. Keeps concurrent
 * requests for the same script deduplicated.
 */
const pending = new Map<string, Promise<void>>();

/**
 * Inline `extra` data harvested from a registered WP script handle by
 * {@link openstation_resolve_script_payload} on the server. Without
 * this, the lazy-load path would silently drop everything attached
 * via `wp_localize_script` / `wp_add_inline_script` /
 * `wp_set_script_translations` — the dynamically-appended `<script
 * src=…>` never goes through `wp_print_scripts()`.
 *
 * @public
 */
export interface ScriptExtras {
	/**
	 * The WordPress script handle this payload was harvested from.
	 *
	 * Carried so the loader can tell whether the document already ran
	 * the script when there is no `<script src>` to find — which is
	 * every Core package on a stock wp-admin, where concatenation
	 * serves them all from one `load-scripts.php` blob. See
	 * {@link isScriptInDocument}.
	 *
	 * Optional, and worth passing whenever the caller knows it: a
	 * URL-only ref can only be matched against tags, and re-running a
	 * package that was already delivered replaces the object other
	 * code is holding.
	 */
	handle?: string;
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
	/**
	 * The handle's dependency closure, in load order, executed before
	 * the script itself.
	 *
	 * WordPress resolves a script's dependencies when it ENQUEUES it,
	 * so a normally-printed bundle finds its packages already on the
	 * page. A handle delivered only through this loader never goes
	 * through that: one URL is injected and nothing else. A widget
	 * declaring `wp-api-fetch` therefore found `wp.apiFetch` undefined
	 * at mount — which used to work by accident, because Core's ⌘K
	 * palette put the whole Gutenberg runtime on every admin page until
	 * it was deferred.
	 *
	 * Anything already in the document is skipped, so this costs
	 * nothing on a page that had the packages anyway.
	 */
	deps?: Array< { url: string } & ScriptExtras >;
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

	// Dependencies first, strictly in order — that order IS the
	// contract (`wp-data` before `wp-core-data`, api-fetch's nonce
	// middleware between its own before/after snippets). Anything
	// already in the document is skipped, so a page that had these
	// packages anyway pays nothing, and the memo above means a shared
	// dependency is fetched once however many bundles declare it.
	const deps = extras?.deps;
	if ( deps && deps.length > 0 ) {
		const loadDep = ( dep: { url: string } & ScriptExtras ) => {
			if ( ! dep.url || isScriptInDocument( dep ) ) {
				return Promise.resolve();
			}
			return loadVendorScript( dep.url, { ...dep, deps: undefined } );
		};
		const withDeps = deps
			.reduce(
				( prev, dep ) => prev.then( () => loadDep( dep ) ),
				Promise.resolve< void >( undefined ),
			)
			// The handle itself, once its packages are in. Injected
			// directly rather than by re-entering `loadVendorScript` —
			// the memo below is keyed by URL and this promise is
			// already stored under it, so recursing would await itself.
			.then( () => injectScriptTag( url, extras ) );
		pending.set( url, withDeps );
		return withDeps;
	}

	const promise = injectScriptTag( url, extras );
	pending.set( url, promise );
	return promise;
}

/**
 * Inject one `<script>` tag and its inline data, resolving on `load`.
 *
 * The memo and the dependency walk live in `loadVendorScript`; this is
 * only the tag mechanics.
 *
 * @param url    Absolute URL of the script.
 * @param extras Optional inline data harvested from the registered handle.
 */
function injectScriptTag( url: string, extras?: ScriptExtras ): Promise< void > {
	return new Promise<void>( ( resolve, reject ) => {
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

		// The page may already carry this file from
		// `wp_enqueue_script()` — which is normal and expected the
		// moment a plugin names an ALREADY-ENQUEUED handle as its
		// native window's `script`. Those tags have no
		// `data-os-vendor` marker, so the check above misses them and
		// we would inject a second copy of the same bundle.
		//
		// A bundle evaluated twice registers every `addAction` /
		// `addFilter` twice, and `@wordpress/hooks` appends rather
		// than replaces on a repeated namespace — so every subscriber
		// runs twice. It shows up as duplicated UI: two identical
		// panels stacked in a folder, two badges on one tile. Nothing
		// in the symptom points at script loading, which is what made
		// it expensive to find.
		//
		// Matched on pathname rather than href: WordPress appends
		// `?ver=…` and a caller may hold the same file with a
		// different (or no) query. Within one document the path IS
		// the identity of the bundle.
		const alreadyInDocument = findScriptByPath( url );
		if ( alreadyInDocument ) {
			// Resolved rather than awaited. A tag the document
			// printed for itself is the document's own ordering
			// problem; ours is only to not print it twice. Waiting on
			// a `load` that already fired would hang the sync
			// forever, and the caller tolerates an absent render
			// callback.
			alreadyInDocument.dataset.osVendor = url;
			alreadyInDocument.dataset.loaded = '1';
			resolve();
			return;
		}

		// Or the document has it with no tag of its own to stamp,
		// because Core's concatenator folded it into a
		// `load-scripts.php` blob along with every other package. Same
		// verdict, reached by reading the blob's handle list —
		// `isScriptInDocument` has the full reasoning.
		if ( isScriptInDocument( { handle: extras?.handle } ) ) {
			resolve();
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
 * Inject one inline `<script>` outside a `loadVendorScript()` call.
 *
 * For harvested handle data that has to land even though the bundle
 * it belongs to is NOT being fetched: two native windows can share
 * one script URL (every App Framework window rides
 * `openstation-app-runtime`), and the URL-keyed dedupe means only the first
 * window's load carries its extras through `loadVendorScript`. The
 * sibling's per-entry data — most critically its synthesized
 * `openStationWindowConfig[ id ]` assignment — is injected through
 * this on its own first open instead.
 */
export function injectInlineScript( code: string ): void {
	injectInline( code );
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
