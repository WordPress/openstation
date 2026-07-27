/**
 * Canonical icon renderer — one place that knows every shape
 * `DockItem.icon` (and other icon-bearing fields like
 * `SystemDockItem.icon`, `RegisterDesktopIcon.icon`) can take.
 *
 * Custom dock rail renderers, palette plugins, launcher widgets,
 * and anything else that wants to paint an icon from one of those
 * fields uses this so behaviour stays consistent across the shell
 * and the ecosystem. Avoids each renderer reinventing the dispatch
 * (and getting subtly different fallbacks).
 *
 * Recognised shapes (in resolution order):
 *
 *   1. `'dashicons-…'`             → `<span class="dashicons dashicons-…">`
 *   2. `'data:image/svg+xml;base64,…'` → `<span>` with the SVG as a
 *      CSS background-image (the safe path; SVG-as-background can't
 *      execute scripts).
 *   3. `'data:image/(png|jpeg|gif|webp|x-icon|…);base64,…'` → `<img>`.
 *      Used by the favicon resolver to paint a downloaded favicon
 *      without a network round-trip on render.
 *   4. `'http://…' | 'https://…'`  → `<img src=…>`.
 *   5. Anything else (empty / `'none'` / `'div'` / unrecognised)
 *      → letter-badge fallback: a coloured circle with the first
 *      one or two letters of `title`. Color is hashed deterministically
 *      from the title so the same plugin gets the same swatch
 *      across reloads.
 */

import { hashTitleToHue } from './ui/util/hash-hue';
import { resolveThemedIcon, resolveThemedIconColor } from './desktop-themes/icons';
import { applyIconMask } from './desktop-themes/paint-tinted-icon';

export interface RenderIconOptions {
	/**
	 * Display label used for the alt text + the letter-badge fallback.
	 * Required because the letter-badge needs the leading characters
	 * and the `<img>` path needs an alt attribute.
	 */
	title: string;
	/**
	 * Class name applied to the returned element. Use this to
	 * target the icon in your renderer's CSS without relying on
	 * the framework's internal class names.
	 */
	className?: string;
	/**
	 * Desktop-theme icon slot this icon occupies (see
	 * `src/desktop-themes/slots.ts`). When an active desktop theme
	 * overrides the slot, its icon is painted INSTEAD of `icon` —
	 * the substitution happens before the shape dispatcher below, so
	 * a theme can turn a dashicon into a PNG or vice versa.
	 *
	 * Omit it and nothing about this function changes.
	 */
	slot?: string;
}

/**
 * Render an icon-string into an `HTMLElement`. The element type
 * varies by shape (`<span>` for dashicons / SVG / letter-badge,
 * `<img>` for URLs); callers that need a uniform shape can wrap
 * the result.
 *
 * @public
 */
export function renderIcon( icon: string, opts: RenderIconOptions ): HTMLElement {
	const className = opts.className ?? '';
	const title = opts.title ?? '';

	// 0. Desktop-theme substitution. Runs before the shape dispatcher
	//    so a themed replacement goes through exactly the same
	//    rendering paths as a native icon — a theme that swaps a
	//    dashicon for an SVG URL gets the `<img>` branch for free.
	//    `resolveThemedIcon` is a single null check when no theme is
	//    active, so this costs effectively nothing by default.
	let tint: string | null = null;
	if ( opts.slot ) {
		const themed = resolveThemedIcon( opts.slot );
		if ( themed !== null ) {
			icon = themed;
		}
		// A tint applies to whatever ends up being painted — including
		// the shell's OWN icon when the theme overrode only the colour.
		// "Recolour every icon, replace none" is a legitimate theme.
		tint = resolveThemedIconColor( opts.slot );
	}

	// 1. Dashicon class. A tint is simply `color` — it is a font glyph.
	if ( typeof icon === 'string' && icon.startsWith( 'dashicons-' ) ) {
		const el = document.createElement( 'span' );
		el.className = `dashicons ${ icon } ${ className }`.trim();
		el.setAttribute( 'aria-hidden', 'true' );
		if ( tint !== null ) {
			el.style.color = tint;
		}
		return el;
	}

	// 1b. Tinted image — painted as a mask rather than an `<img>`, so
	//     the fill comes from the theme and only the artwork's alpha
	//     is used. Placed ahead of every image branch below because it
	//     replaces all of them: data-URI SVG, data-URI raster, and
	//     http(s) URLs are all maskable.
	if ( tint !== null && typeof icon === 'string' ) {
		const el = document.createElement( 'span' );
		el.className = className;
		el.setAttribute( 'aria-hidden', 'true' );
		el.style.display = 'inline-block';
		if ( applyIconMask( el, icon, tint ) ) {
			return el;
		}
		// Not maskable (letter-badge fallback, `none`, a malformed
		// value) — fall through and paint it the ordinary way.
	}

	// 2. Inline SVG data URI — paint as background-image. We re-validate
	// the base64 payload shape because icons registered from JS skip the
	// PHP sanitizer.
	if (
		typeof icon === 'string' &&
		icon.startsWith( 'data:image/svg+xml;base64,' )
	) {
		const base64Part = icon.slice( 'data:image/svg+xml;base64,'.length );
		if ( /^[A-Za-z0-9+/=]+$/.test( base64Part ) ) {
			const el = document.createElement( 'span' );
			el.className = className;
			el.setAttribute( 'aria-hidden', 'true' );
			el.style.backgroundImage = `url("${ icon }")`;
			el.style.backgroundRepeat = 'no-repeat';
			el.style.backgroundPosition = 'center';
			el.style.backgroundSize = 'contain';
			el.style.display = 'inline-block';
			return el;
		}
		// Malformed — fall through.
	}

	// 3. Non-SVG image data URI — render as <img>. The format
	// allowlist + base64 payload check mirrors the SVG branch above
	// so a malformed value falls through to the letter-badge.
	if (
		typeof icon === 'string' &&
		/^data:image\/(png|jpeg|jpg|gif|webp|x-icon|vnd\.microsoft\.icon);base64,/i.test( icon )
	) {
		const commaIdx = icon.indexOf( ',' );
		const payload = commaIdx >= 0 ? icon.slice( commaIdx + 1 ) : '';
		if ( /^[A-Za-z0-9+/=]+$/.test( payload ) ) {
			return makeImgIcon( icon, className );
		}
		// Malformed — fall through.
	}

	// 4. http(s) URL — direct image.
	if (
		typeof icon === 'string' &&
		( icon.startsWith( 'http://' ) || icon.startsWith( 'https://' ) )
	) {
		return makeImgIcon( icon, className );
	}

	// 5. Letter-badge fallback. Picks the first two letters of the
	// title (or the first if the title is one word / one character).
	const span = document.createElement( 'span' );
	span.className = `${ className } desktop-mode-icon-letter`.trim();
	span.setAttribute( 'aria-hidden', 'true' );
	const letters = letterFromTitle( title );
	span.textContent = letters;
	const hue = hashTitleToHue( title );
	span.style.backgroundColor = `hsl( ${ hue }, 60%, 45% )`;
	span.style.color = '#fff';
	span.style.display = 'inline-flex';
	span.style.alignItems = 'center';
	span.style.justifyContent = 'center';
	span.style.fontWeight = '600';
	span.style.borderRadius = '4px';
	return span;
}

/**
 * Build an `<img>` for a URL or data URI icon. Sets
 * `draggable="false"` so the browser's native HTML5 image-drag
 * doesn't pre-empt pointer-event-driven gestures on the parent
 * tile (the bug that froze tile-rearrange when a tile rendered a
 * favicon or any URL/data-URI icon).
 */
function makeImgIcon( src: string, className: string ): HTMLImageElement {
	const img = document.createElement( 'img' );
	img.className = className;
	img.src = src;
	img.alt = '';
	img.setAttribute( 'aria-hidden', 'true' );
	img.draggable = false;
	return img;
}

function letterFromTitle( title: string ): string {
	const trimmed = ( title ?? '' ).trim();
	if ( trimmed === '' ) {
		return '?';
	}
	const words = trimmed.split( /\s+/ );
	if ( words.length >= 2 ) {
		return ( words[ 0 ][ 0 ] + words[ 1 ][ 0 ] ).toUpperCase();
	}
	const first = words[ 0 ];
	if ( first.length >= 2 ) {
		return first.slice( 0, 2 ).toUpperCase();
	}
	return first.toUpperCase();
}
