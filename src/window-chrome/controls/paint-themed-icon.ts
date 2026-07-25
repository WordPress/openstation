/**
 * Desktop-theme icon painter for window CONTROL buttons.
 *
 * Sibling of `src/title-bar-buttons/paint-icon.ts`, which routes the
 * three shapes a PLUGIN may pass (built-in key / dashicon / inline
 * SVG). This one handles the two shapes a desktop THEME may resolve
 * to, and it has to be separate because the constraints differ:
 *
 *   - **Dashicon** → a light-DOM `<span class="dashicons …">`, the
 *     same trick the plugin painter uses. The global Dashicons
 *     stylesheet does not cross the shadow boundary, so the glyph
 *     has to live outside it.
 *   - **URL / data URI** → the `icon-src` attribute, which the
 *     component paints as a `currentColor`-tinted CSS mask. Not an
 *     `<img>`: an image would ignore the `--wpd-btn-*` tinting the
 *     title bar drives, and a themed close button would stop turning
 *     white when its window gained focus.
 *
 * @since 0.9.7
 * @internal
 */

import {
	resolveThemedIcon,
	resolveThemedIconColor,
} from '../../desktop-themes/icons';
import { slotForWindowControl } from '../../desktop-themes/slots';

/**
 * Paint the active desktop theme's glyph for a control, if it has
 * one.
 *
 * @param host      The `<wpd-window-button>` element.
 * @param controlId Control id (`core/close`, `acme/pin`, …).
 * @return `true` when the theme supplied a glyph and painted it;
 *         `false` when the caller should paint the default.
 */
export function paintThemedControlIcon(
	host: HTMLElement,
	controlId: string,
): boolean {
	const slot = slotForWindowControl( controlId );
	const themed = resolveThemedIcon( slot );
	const tint = resolveThemedIconColor( slot );

	// A tint with no glyph override is meaningful on its own: "keep
	// the built-in chevrons, paint them cyan."
	if ( themed === null && tint === null ) {
		return false;
	}

	// The mask fill. Unset, the component's own `currentColor` default
	// applies — which is what keeps a themed close button turning white
	// on a focused title bar and red on danger-hover. A theme that
	// names a colour here is deliberately opting OUT of that state
	// tinting, so the glyph holds one colour throughout.
	if ( tint !== null ) {
		host.style.setProperty( '--wpd-btn-icon-color', tint );
	} else {
		host.style.removeProperty( '--wpd-btn-icon-color' );
	}

	if ( themed === null ) {
		// Colour-only override: the built-in SVG stays, and it already
		// paints with `currentColor`. Give it the tint through `color`
		// so the inline `fill="currentColor"` picks it up.
		host.style.setProperty( 'color', tint as string );
		return false;
	}

	if ( themed.startsWith( 'dashicons-' ) ) {
		host.removeAttribute( 'icon-src' );
		host.removeAttribute( 'icon' );
		const span = document.createElement( 'span' );
		span.className = `dashicons ${ themed }`;
		span.setAttribute( 'aria-hidden', 'true' );
		if ( tint !== null ) {
			span.style.color = tint;
		}
		host.appendChild( span );
		return true;
	}

	// The component re-validates this itself before it reaches CSS;
	// a value it rejects paints nothing, which is the same visual
	// outcome as returning `false` here would have been.
	host.setAttribute( 'icon-src', themed );
	return true;
}
