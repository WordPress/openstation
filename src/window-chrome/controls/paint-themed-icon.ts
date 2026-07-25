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

import { resolveThemedIcon } from '../../desktop-themes/icons';
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
	const themed = resolveThemedIcon( slotForWindowControl( controlId ) );
	if ( themed === null ) {
		return false;
	}

	if ( themed.startsWith( 'dashicons-' ) ) {
		host.removeAttribute( 'icon-src' );
		host.removeAttribute( 'icon' );
		const span = document.createElement( 'span' );
		span.className = `dashicons ${ themed }`;
		span.setAttribute( 'aria-hidden', 'true' );
		host.appendChild( span );
		return true;
	}

	// The component re-validates this itself before it reaches CSS;
	// a value it rejects paints nothing, which is the same visual
	// outcome as returning `false` here would have been.
	host.setAttribute( 'icon-src', themed );
	return true;
}
