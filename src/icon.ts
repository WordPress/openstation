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
 *   3. `'http://…' | 'https://…'`  → `<img src=…>`.
 *   4. Anything else (empty / `'none'` / `'div'` / unrecognised)
 *      → letter-badge fallback: a coloured circle with the first
 *      one or two letters of `title`. Color is hashed deterministically
 *      from the title so the same plugin gets the same swatch
 *      across reloads.
 *
 * @since 0.18.0
 */

import { hashTitleToHue } from './ui/util/hash-hue';

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
}

/**
 * Render an icon-string into an `HTMLElement`. The element type
 * varies by shape (`<span>` for dashicons / SVG / letter-badge,
 * `<img>` for URLs); callers that need a uniform shape can wrap
 * the result.
 *
 * @public
 * @since 0.18.0
 */
export function renderIcon( icon: string, opts: RenderIconOptions ): HTMLElement {
	const className = opts.className ?? '';
	const title = opts.title ?? '';

	// 1. Dashicon class.
	if ( typeof icon === 'string' && icon.startsWith( 'dashicons-' ) ) {
		const el = document.createElement( 'span' );
		el.className = `dashicons ${ icon } ${ className }`.trim();
		el.setAttribute( 'aria-hidden', 'true' );
		return el;
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

	// 3. http(s) URL — direct image.
	if (
		typeof icon === 'string' &&
		( icon.startsWith( 'http://' ) || icon.startsWith( 'https://' ) )
	) {
		const img = document.createElement( 'img' );
		img.className = className;
		img.src = icon;
		img.alt = '';
		img.setAttribute( 'aria-hidden', 'true' );
		return img;
	}

	// 4. Letter-badge fallback. Picks the first two letters of the
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
