/**
 * OpenStation — which scripts this document has already executed.
 *
 * Every lazy-load path in the shell — a widget's bundle, a native
 * window's, the deferred command-palette chain — asks the same
 * question before it appends a `<script>`: *is this already here?*
 * Getting it wrong is not a wasted request. A bundle evaluated twice
 * re-registers every subscription it makes, and a SINGLETON package
 * evaluated twice replaces an object other code is still holding:
 * re-running `wp-hooks` assigns a brand-new registry to
 * `window.wp.hooks`, and everything that subscribed against the old
 * one goes deaf while the actions keep firing on the new one.
 *
 * That question used to have a single answer — a `<script src>` in
 * the document with the same origin and path. It is blind to Core's
 * script concatenation, which is ON by default in wp-admin
 * (`script_concat_settings()`; only `SCRIPT_DEBUG`, or
 * `CONCATENATE_SCRIPTS = false`, turns it off, which is why no
 * developer environment ever showed this). Under it every script
 * below `wp-includes/js/` and `wp-admin/js/` is served from a single
 * `load-scripts.php` response and has no tag of its own. So the sniff
 * missed `wp-hooks`, the loader appended it, and the shell's
 * boot-time subscribers stopped hearing their own events — windows
 * sat under their loading overlay for good.
 *
 * A concatenated blob is not opaque, though. It names the handles it
 * carries in its own query string, because that is how
 * `wp-admin/load-scripts.php` knows what to serve. Reading them back
 * is the missing signal, and it is document truth: no server
 * round-trip, and nothing to keep in sync with a boot-time snapshot
 * that a later print would invalidate.
 *
 * A script is therefore in the document when EITHER holds:
 *
 *   - some `<script src>` serves the same origin + path, or
 *   - its handle is listed in a `load-scripts.php` blob.
 *
 * The second test needs the caller to know the handle. Every
 * server-built payload carries one — `openstation_resolve_script_-`
 * `dependencies()` stamps `handle` on every dependency it resolves —
 * while a plugin calling `wp.os.loadVendorScript( url )` with a bare
 * URL gets the first test only, which is all it ever had.
 */

/**
 * A script, identified however the caller happens to know it. Both
 * fields are optional by design: a payload-driven caller has both, a
 * plugin holding only a URL has one, and the answer is the best the
 * available evidence supports.
 */
export interface ScriptRef {
	/** Absolute or document-relative URL of the script. */
	url?: string;
	/** WordPress script handle, e.g. `wp-hooks`. */
	handle?: string;
}

/**
 * Find a `<script src>` already in the document serving the same
 * file, ignoring the query string.
 *
 * `wp_enqueue_script()` prints `…/desktop.min.js?ver=0.9.8` while a
 * registry entry may hold the bare path or a different `ver`. Within
 * one document those are the same bundle, and injecting it a second
 * time evaluates it a second time — which duplicates every hook
 * subscription the bundle registers.
 *
 * Origin is part of the identity, though the query string isn't:
 * `loadVendorScript` is public API and vendor bundles have generic
 * paths, so two CDNs both serving `/dist/index.js` are two different
 * bundles. Matching on pathname alone would silently swallow the
 * second one.
 *
 * @param url Candidate URL.
 * @return The existing tag, or `null`.
 */
export function findScriptByPath( url: string ): HTMLScriptElement | null {
	let origin: string;
	let path: string;
	try {
		const parsed = new URL( url, document.baseURI );
		origin = parsed.origin;
		path = parsed.pathname;
	} catch {
		return null;
	}
	if ( ! path ) {
		return null;
	}
	const tags = document.querySelectorAll< HTMLScriptElement >(
		'script[src]',
	);
	for ( const tag of Array.from( tags ) ) {
		try {
			const candidate = new URL( tag.src, document.baseURI );
			if (
				candidate.origin === origin &&
				candidate.pathname === path
			) {
				return tag;
			}
		} catch {
			/* A malformed src can't match anything — skip it. */
		}
	}
	return null;
}

/**
 * Parsed handle lists, keyed by the blob URL that carried them. A
 * given URL always answers the same way — the handles are in the URL
 * — so this is a pure memo, not a cache that can go stale. The tag
 * list itself is re-read on every query, which is what keeps the
 * answer live for a blob printed after boot.
 */
const concatenated = new Map< string, string[] >();

/**
 * The script handles one `load-scripts.php` URL delivers.
 *
 * Reassembled exactly the way `wp-admin/load-scripts.php` does it:
 * join every `load[…]` value, *then* split on commas. The chunking
 * exists only because `_print_scripts()` cuts the handle list every
 * 128 characters, and a cut lands mid-name as often as not — so
 * splitting a chunk on its own would yield `wp-ho` and `oks`.
 *
 * Chunks are ordered by the numeric index in their `chunk_N` key.
 * Core sorts those keys as strings, which agrees with this for the
 * first ten chunks and is Core's own quirk past them; we want whole
 * names either way, and only the set of them.
 *
 * @param src Resolved `src` of a candidate `<script>` tag.
 * @return The handles, or an empty list when the URL isn't a blob.
 */
function handlesInConcatUrl( src: string ): string[] {
	const memo = concatenated.get( src );
	if ( memo ) {
		return memo;
	}

	let handles: string[] = [];
	try {
		const url = new URL( src, document.baseURI );
		if ( url.pathname.endsWith( '/load-scripts.php' ) ) {
			const chunks: Array< { order: number; value: string } > = [];
			url.searchParams.forEach( ( value, key ) => {
				if ( 'load' !== key && ! key.startsWith( 'load[' ) ) {
					return;
				}
				const index = /(\d+)/.exec( key );
				chunks.push( {
					order: index ? Number( index[ 1 ] ) : chunks.length,
					value,
				} );
			} );
			chunks.sort( ( a, b ) => a.order - b.order );
			handles = chunks
				.map( ( chunk ) => chunk.value )
				.join( '' )
				.split( ',' )
				.map( ( handle ) => handle.trim() )
				.filter( Boolean );
		}
	} catch {
		/* A malformed src carries nothing. */
	}

	concatenated.set( src, handles );
	return handles;
}

/**
 * Every script handle Core's concatenator has already delivered to
 * this document.
 *
 * Empty on a `SCRIPT_DEBUG` site, where nothing is concatenated and
 * every handle has a tag of its own for {@link findScriptByPath} to
 * find.
 *
 * @return The handles, as a set.
 */
export function concatenatedScriptHandles(): Set< string > {
	const handles = new Set< string >();
	const tags = document.querySelectorAll< HTMLScriptElement >(
		'script[src*="load-scripts.php"]',
	);
	for ( const tag of Array.from( tags ) ) {
		for ( const handle of handlesInConcatUrl( tag.src ) ) {
			handles.add( handle );
		}
	}
	return handles;
}

/**
 * Whether this document has already been given the script.
 *
 * The one test every lazy loader should ask before appending a tag.
 * Consults each signal the caller has given it evidence for; a `ref`
 * with neither field is never in the document.
 *
 * @param ref The script, by URL and/or handle.
 * @return `true` when appending it again would re-execute it.
 */
export function isScriptInDocument( ref: ScriptRef ): boolean {
	if ( ref.url && findScriptByPath( ref.url ) ) {
		return true;
	}
	return !! ref.handle && concatenatedScriptHandles().has( ref.handle );
}
