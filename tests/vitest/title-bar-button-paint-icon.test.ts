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

		expect( host.getAttribute( 'icon' ) ).toBe( 'not-a-known-key' );
	} );

	test( 'malformed dashicons class (with spaces / arbitrary html) is rejected', () => {
		const host = makeHost();

		paintTitleBarButtonIcon(
			host,
			'dashicons-foo" onclick="alert(1)',
		);
		expect( host.querySelector( 'span.dashicons' ) ).toBeNull();

		expect( host.getAttribute( 'icon' ) ).toBe(
			'dashicons-foo" onclick="alert(1)',
		);
	} );
} );
