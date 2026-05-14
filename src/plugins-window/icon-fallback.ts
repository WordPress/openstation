/**
 * Plugins window — icon URL fallback chain.
 *
 * The PHP `desktop_mode_icon_url` REST field returns the wp.org SVG by
 * default (`https://ps.w.org/<slug>/assets/icon.svg`). Many plugins on
 * the wp.org repo only ship PNG variants — `icon-256x256.png` or
 * `icon-128x128.png` — so a one-shot `<img src>` on the SVG 404s and
 * the row looks iconless even though art exists. This helper attaches
 * an `error` handler that walks SVG → 256 PNG → 128 PNG before giving
 * up and calling `onExhausted`, at which point the caller paints its
 * placeholder.
 *
 * Custom URLs (not under `ps.w.org/<slug>/assets/`) bypass the chain —
 * one shot, then placeholder. That matches what the
 * `desktop_mode_plugins_window_icon_url` filter docblock promises.
 *
 * @public
 * @since 0.18.0
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
	return [
		initialUrl,
		base + 'icon-256x256.png',
		base + 'icon-128x128.png',
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
