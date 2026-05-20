/**
 * Console-quiet Gravatar resolver.
 *
 * `<wpd-avatar>` falls back to initials when its `src` errors out,
 * but a raw Gravatar URL serves the "mystery person" silhouette by
 * default (HTTP 200, no error) — so the initials fallback never
 * triggers and users with no registered Gravatar see the silhouette
 * forever. Forcing `d=404` would fix the visual, but every miss
 * logs a 404 to DevTools (both `<img>` and `fetch` paths).
 *
 * The trick: load the URL with `d=blank` (always 200, returns a
 * transparent PNG sized to `s=`), then sample the alpha channel of
 * the center pixel via canvas. Gravatar serves
 * `Access-Control-Allow-Origin: *`, so the canvas readback works as
 * long as the image is loaded with `crossOrigin = 'anonymous'`.
 *
 * Two exports:
 *
 *   - {@link resolveAvatarUrl} — async; resolves to the URL to use
 *     (or `null` to fall back to initials). Results cached per
 *     canonical URL.
 *   - {@link applyAvatarSrc} — fire-and-forget convenience wrapper
 *     that sets / removes the `src` attribute on a `<wpd-avatar>`
 *     element once the probe resolves. Safe to call from cell
 *     renderers — the helper guards against detached hosts when the
 *     row is removed mid-probe.
 *
 * Non-Gravatar URLs (BuddyPress, custom plugin avatars, …) skip the
 * probe and pass through unchanged.
 *
 * @since 0.19.0
 */

const gravatarCache = new Map<
	string,
	string | null | Promise< string | null >
>();

/**
 * Resolve the URL a `<wpd-avatar>` should use for `src`, or `null`
 * when the commenter / user has no registered Gravatar and the
 * avatar should fall back to its initials tile.
 *
 * @param raw The raw Gravatar URL (or any avatar URL).
 * @return The URL to set as `src`, or `null` to leave unset.
 */
export async function resolveAvatarUrl(
	raw: string,
): Promise< string | null > {
	if ( ! raw ) {
		return null;
	}
	let parsed: URL;
	try {
		parsed = new URL( raw, window.location.href );
	} catch {
		return raw;
	}
	if ( ! /gravatar\.com$/i.test( parsed.hostname ) ) {
		// Non-Gravatar URL — assume the producer knows what it's
		// doing and hand it straight through.
		return raw;
	}

	// Canonical cache key: drop the per-call `d=` / `s=` params so
	// the same email collapses to one entry across 24px / 48px / 96px
	// renderings.
	parsed.searchParams.delete( 'd' );
	parsed.searchParams.delete( 's' );
	const cacheKey = parsed.toString();

	const cached = gravatarCache.get( cacheKey );
	if ( cached !== undefined ) {
		return cached instanceof Promise ? cached : cached;
	}

	const probeUrl = new URL( raw, window.location.href );
	probeUrl.searchParams.set( 'd', 'blank' );
	const probe = new Promise< string | null >( ( resolve ) => {
		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.onload = () => {
			try {
				const canvas = document.createElement( 'canvas' );
				canvas.width = 1;
				canvas.height = 1;
				// `willReadFrequently: true` keeps the canvas CPU-backed so
				// the `getImageData` call below doesn't pay a GPU sync. The
				// probe runs once per distinct avatar URL; per-canvas the
				// readback is one-shot, but Chrome's heuristic still flags
				// the pattern across the page-wide chorus of avatar resolves.
				const ctx = canvas.getContext( '2d', { willReadFrequently: true } );
				if ( ! ctx ) {
					// No 2D context — fall back to the original URL so
					// real avatars still render. Worst case: the
					// occasional mystery-person silhouette slips
					// through on exotic browsers.
					resolve( raw );
					return;
				}
				ctx.drawImage( img, 0, 0, 1, 1 );
				const pixel = ctx.getImageData( 0, 0, 1, 1 ).data;
				resolve( pixel[ 3 ] === 0 ? null : raw );
			} catch {
				// Tainted canvas (CORS slip), security exception —
				// the image already loaded successfully, so it's safe
				// to use as-is. Better a known-real avatar than an
				// empty tile.
				resolve( raw );
			}
		};
		img.onerror = () => resolve( null );
		img.src = probeUrl.toString();
	} ).then( ( next ) => {
		gravatarCache.set( cacheKey, next );
		return next;
	} );
	gravatarCache.set( cacheKey, probe );
	return probe;
}

/**
 * Fire-and-forget convenience: probe the URL and set / remove the
 * `src` attribute on the given `<wpd-avatar>` element when the
 * probe resolves. Safe to call from cell renderers — guards against
 * detached hosts when the row was removed mid-probe.
 */
export function applyAvatarSrc( avatar: HTMLElement, raw: string ): void {
	if ( ! raw ) {
		return;
	}
	void resolveAvatarUrl( raw ).then( ( url ) => {
		if ( ! avatar.isConnected ) {
			return;
		}
		if ( url ) {
			avatar.setAttribute( 'src', url );
		} else {
			avatar.removeAttribute( 'src' );
		}
	} );
}

/**
 * Test-only: clear the cache so a fresh probe runs next time.
 *
 * @internal
 */
export function _resetAvatarResolveCache(): void {
	gravatarCache.clear();
}
