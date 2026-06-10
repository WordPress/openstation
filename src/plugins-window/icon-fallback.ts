/**
 * Plugins window — icon URL fallback chain.
 *
 * The PHP `desktop_mode_icon_url` REST field returns the wp.org SVG by
 * default (`https://ps.w.org/<slug>/assets/icon.svg`). Plugins on the
 * .org repo ship a mix of formats — SVG, PNG, and animated GIF
 * (Elementor's icons are 128/256 GIFs, for example). A one-shot
 * `<img src>` on the SVG 404s and the row looks iconless even when
 * the asset repo has art in another format. This helper attaches an
 * `error` handler that walks SVG → 256 PNG → 256 GIF → 128 PNG →
 * 128 GIF before giving up and calling `onExhausted`, at which point
 * the caller paints its placeholder.
 *
 * Custom URLs (not under `ps.w.org/<slug>/assets/`) bypass the chain —
 * one shot, then placeholder. That matches what the
 * `desktop_mode_plugins_window_icon_url` filter docblock promises and
 * applies to both auto-detected local-folder icons and explicit
 * filter overrides.
 *
 * @public
 * @since 0.8.5
 * @since 0.8.6 Added `.gif` variants for plugins like Elementor that
 *              ship animated GIF icons on the wp.org SVN.
 */

const WP_ORG_ASSET_RE =
	/^(https:\/\/ps\.w\.org\/[a-z0-9-]+\/assets\/)icon\.svg$/i;

/**
 * Given the URL the PHP field returned, derive the ordered list of
 * candidates to try. The first entry is always the input URL so the
 * caller can use the array as a single source of truth.
 */
function buildCandidates( initialUrl: string ): string[] {
	const match = initialUrl.match( WP_ORG_ASSET_RE );
	if ( ! match ) {
		return [ initialUrl ];
	}
	const base = match[ 1 ];
	// Prefer the larger 256-px variants over the 128 set, and PNG
	// over GIF within each size — PNG is faster to decode + render
	// for a 32-px card cell, GIF only matters when that's the only
	// format the plugin shipped (Elementor, a handful of others).
	return [
		initialUrl,
		base + 'icon-256x256.png',
		base + 'icon-256x256.gif',
		base + 'icon-128x128.png',
		base + 'icon-128x128.gif',
	];
}

/**
 * Wire an `<img>` element to walk the wp.org icon candidate chain on
 * load failure. Returns the first URL it should start with (which the
 * caller assigns to `img.src`).
 *
 * @param img         The `<img>` to monitor.
 * @param initialUrl  The URL returned by `desktop_mode_icon_url`.
 * @param onExhausted Invoked when every candidate has 404'd — the
 *                    caller should paint its placeholder.
 * @return The URL to assign to `img.src`.
 */
export function attachIconFallback(
	img: HTMLImageElement,
	initialUrl: string,
	onExhausted: () => void,
): string {
	const candidates = buildCandidates( initialUrl );
	let index = 0;

	img.addEventListener( 'error', () => {
		index += 1;
		if ( index < candidates.length ) {
			img.src = candidates[ index ];
			return;
		}
		onExhausted();
	} );

	return candidates[ 0 ];
}
