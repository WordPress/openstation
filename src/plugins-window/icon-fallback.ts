/**
 * Plugins window — icon URL fallback chain.
 *
 * The PHP `openstation_icon_url` REST field prefers the URL wp.org
 * itself gave us, and guesses `https://ps.w.org/<slug>/assets/icon.svg`
 * when that metadata isn't cached yet. This chain is for the guess.
 * Plugins on the .org repo ship a mix of formats — SVG, PNG, animated
 * GIF (Elementor), JPEG (Gutenberg, UpdraftPlus). A one-shot
 * `<img src>` on the SVG 404s and the row looks iconless even when the
 * asset repo has art in another format, so this helper attaches an
 * `error` handler that walks the variants before giving up and calling
 * `onExhausted`, at which point the caller paints its placeholder.
 *
 * Custom URLs (not under `ps.w.org/<slug>/assets/`) bypass the chain —
 * one shot, then placeholder. That matches what the
 * `openstation_plugins_window_icon_url` filter docblock promises and
 * applies to both auto-detected local-folder icons and explicit
 * filter overrides.
 *
 * @public
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
	// 256-px variants before the 128 set, and within each size the
	// likeliest format first — PNG (also the fastest to decode for a
	// 32-px cell), then JPEG, then GIF. The last two only matter when
	// that is all the plugin shipped: Gutenberg and UpdraftPlus are
	// JPEG-only, Elementor GIF-only.
	return [
		initialUrl,
		base + 'icon-256x256.png',
		base + 'icon-256x256.jpg',
		base + 'icon-256x256.gif',
		base + 'icon-128x128.png',
		base + 'icon-128x128.jpg',
		base + 'icon-128x128.gif',
	];
}

/**
 * Wire an `<img>` element to walk the wp.org icon candidate chain on
 * load failure. Returns the first URL it should start with (which the
 * caller assigns to `img.src`).
 *
 * @param img         The `<img>` to monitor.
 * @param initialUrl  The URL returned by `openstation_icon_url`.
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
