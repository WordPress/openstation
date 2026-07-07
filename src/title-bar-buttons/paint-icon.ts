/**
 * Icon painter for plugin-registered title-bar buttons.
 *
 * `<wpd-window-button>` only knows seven built-in icon keys
 * (`minimize` / `maximize` / `fullscreen` / `fullscreen-exit` /
 * `detach` / `close` / `menu`); passing a Dashicons class or an
 * inline SVG via the `icon` attribute paints nothing because the
 * shadow-DOM icon map has no entry for it. Worse, the global
 * Dashicons stylesheet doesn't reach into the button's shadow
 * root — even if we DID add a Dashicons branch in the component,
 * the rendered `<span class="dashicons">` would be unstyled.
 *
 * This helper routes the three accepted icon shapes:
 *
 *   - Built-in key  → `host.setAttribute( 'icon', key )` (shadow paints).
 *   - Dashicons     → `<span class="dashicons …">` appended to the
 *                     host's light DOM where Dashicons CSS reaches.
 *   - Inline SVG    → SVG string appended to the host's light DOM.
 *
 * Plugin SVG strings are inserted via `innerHTML` because plugin
 * code already runs with shell privileges in the same JS realm —
 * sanitising it here would be theatre. Plugin authors who care
 * about XSS hygiene against their own data sanitise on their side.
 *
 * @since 0.5.2
 * @internal
 */

const DASHICON_PATTERN = /^dashicons-[a-z0-9-]+$/i;
const INLINE_SVG_PATTERN = /^\s*<svg[\s>]/i;

export function paintTitleBarButtonIcon(
	host: HTMLElement,
	icon: string,
): void {
	if ( ! icon ) {
		return;
	}
	if ( DASHICON_PATTERN.test( icon ) ) {
		const span = document.createElement( 'span' );
		span.className = `dashicons ${ icon }`;
		span.setAttribute( 'aria-hidden', 'true' );
		host.appendChild( span );
		return;
	}
	if ( INLINE_SVG_PATTERN.test( icon ) ) {
		const wrapper = document.createElement( 'span' );
		wrapper.setAttribute( 'aria-hidden', 'true' );
		wrapper.innerHTML = icon;
		host.appendChild( wrapper );
		return;
	}
	// Fall through — built-in key (minimize / close / etc.) or
	// unknown string. The component's shadow DOM owns built-in
	// rendering; unknown strings paint nothing (matches behaviour
	// before this helper existed for built-in keys, but now
	// dashicons + inline SVG actually work).
	host.setAttribute( 'icon', icon );
}
