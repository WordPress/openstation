/**
 * Verifies `paintTitleBarButtonIcon` routes the three documented
 * icon shapes (built-in key / Dashicons class / inline SVG) onto
 * the right place — Dashicons + SVG into the host's light DOM,
 * built-in keys onto the `icon` attribute.
 *
 * Catches the regression that prompted this helper: passing a
 * Dashicons class via `wp.os.registerTitleBarButton({ icon })`
 * silently rendered an empty button, because `<os-window-button>`
 * only knows seven hardcoded icon keys.
 */
import { describe, expect, test } from 'vitest';
import { paintTitleBarButtonIcon } from '../../src/title-bar-buttons/paint-icon';

function makeHost(): HTMLElement {
	const host = document.createElement( 'os-window-button' );
	document.body.appendChild( host );
	return host;
}

describe( 'paintTitleBarButtonIcon', () => {
	test( 'dashicons class lands in light DOM with the right class names', () => {
		const host = makeHost();
		paintTitleBarButtonIcon( host, 'dashicons-visibility' );

		const span = host.querySelector< HTMLElement >( 'span.dashicons' );
		expect( span ).not.toBeNull();
		expect( span!.classList.contains( 'dashicons-visibility' ) ).toBe( true );
		expect( span!.getAttribute( 'aria-hidden' ) ).toBe( 'true' );
		// `icon` attribute is NOT set — the shadow-DOM path is bypassed.
		expect( host.hasAttribute( 'icon' ) ).toBe( false );
	} );

	test( 'inline SVG string is appended verbatim into light DOM', () => {
		const host = makeHost();
		const svg = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6"/></svg>';
		paintTitleBarButtonIcon( host, svg );

		expect( host.querySelector( 'svg' ) ).not.toBeNull();
		expect( host.querySelector( 'circle' ) ).not.toBeNull();
		expect( host.hasAttribute( 'icon' ) ).toBe( false );
	} );

	test( 'built-in key forwards to the `icon` attribute', () => {
		const host = makeHost();
		paintTitleBarButtonIcon( host, 'menu' );

		expect( host.getAttribute( 'icon' ) ).toBe( 'menu' );
		// No light-DOM children for built-ins — shadow paints them.
		expect( host.querySelector( 'span.dashicons' ) ).toBeNull();
		expect( host.querySelector( 'svg' ) ).toBeNull();
	} );

	test( 'empty icon is a no-op (no attribute, no children)', () => {
		const host = makeHost();
		paintTitleBarButtonIcon( host, '' );

		expect( host.hasAttribute( 'icon' ) ).toBe( false );
		expect( host.children ).toHaveLength( 0 );
	} );

	test( 'unknown string falls through to icon attribute (graceful, even if empty)', () => {
		const host = makeHost();
		paintTitleBarButtonIcon( host, 'not-a-known-key' );

		// We don't paint anything in light DOM, but we DO forward
		// the value as the icon attribute — the component's shadow
		// painter no-ops on unknown keys, which is the "empty
		// button" behaviour matching the pre-fix world.
		expect( host.getAttribute( 'icon' ) ).toBe( 'not-a-known-key' );
	} );

	test( 'malformed dashicons class (with spaces / arbitrary html) is rejected', () => {
		const host = makeHost();
		// Caller could have passed something like
		// `dashicons-foo" onerror="…"` if a string came from user
		// data — it shouldn't class-inject. The regex requires
		// the entire string to match the safe pattern.
		paintTitleBarButtonIcon(
			host,
			'dashicons-foo" onclick="alert(1)',
		);
		expect( host.querySelector( 'span.dashicons' ) ).toBeNull();
		// Falls through to icon attribute — invalid but inert.
		expect( host.getAttribute( 'icon' ) ).toBe(
			'dashicons-foo" onclick="alert(1)',
		);
	} );
} );
