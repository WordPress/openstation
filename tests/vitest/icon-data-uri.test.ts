/**
 * `renderIcon` — non-SVG image data URI handling.
 *
 * The favicon resolver returns favicon bytes as
 * `data:image/png;base64,…` (or jpeg / gif / webp / x-icon). The
 * canonical icon dispatcher needs to render those as `<img>` instead
 * of falling through to the letter-badge.
 */
import { describe, expect, test } from 'vitest';
import { renderIcon } from '../../src/icon';

const VALID_PNG_DATA_URI =
	'data:image/png;base64,' +
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWMQEhTwDwACzwExt7K1+QAAAABJRU5ErkJggg==';

describe( 'renderIcon — non-SVG image data URIs', () => {
	test( 'data:image/png;base64 renders as <img>', () => {
		const el = renderIcon( VALID_PNG_DATA_URI, { title: 'GitHub', className: 'x' } );
		expect( el.tagName ).toBe( 'IMG' );
		expect( ( el as HTMLImageElement ).src ).toBe( VALID_PNG_DATA_URI );
		expect( el.classList.contains( 'x' ) ).toBe( true );
		expect( el.getAttribute( 'aria-hidden' ) ).toBe( 'true' );
		// Native HTML5 image drag must be disabled or it pre-empts the
		// pointer-event-driven tile rearrange.
		expect( ( el as HTMLImageElement ).draggable ).toBe( false );
	} );

	test( 'http(s) URL <img> is also non-draggable', () => {
		const el = renderIcon( 'https://example.com/icon.png', { title: 'X' } );
		expect( el.tagName ).toBe( 'IMG' );
		expect( ( el as HTMLImageElement ).draggable ).toBe( false );
	} );

	test( 'data:image/jpeg, gif, webp, x-icon all render as <img>', () => {
		const samples = [
			'data:image/jpeg;base64,QUJD',
			'data:image/gif;base64,QUJD',
			'data:image/webp;base64,QUJD',
			'data:image/x-icon;base64,QUJD',
			'data:image/vnd.microsoft.icon;base64,QUJD',
		];
		for ( const uri of samples ) {
			const el = renderIcon( uri, { title: 'X' } );
			expect( el.tagName, `expected IMG for ${ uri }` ).toBe( 'IMG' );
			expect( ( el as HTMLImageElement ).src ).toBe( uri );
		}
	} );

	test( 'malformed base64 in PNG data URI falls through to letter-badge', () => {
		const broken = 'data:image/png;base64,!!!not-valid!!!';
		const el = renderIcon( broken, { title: 'Foo' } );
		expect( el.tagName ).toBe( 'SPAN' );
		expect( el.classList.contains( 'desktop-mode-icon-letter' ) ).toBe( true );
	} );

	test( 'unsupported data URI subtype falls through to letter-badge', () => {
		const tiff = 'data:image/tiff;base64,QUJD';
		const el = renderIcon( tiff, { title: 'Foo' } );
		expect( el.tagName ).toBe( 'SPAN' );
		expect( el.classList.contains( 'desktop-mode-icon-letter' ) ).toBe( true );
	} );

	test( 'SVG data URI still renders as background-image span (case 2)', () => {
		const svg =
			'data:image/svg+xml;base64,' +
			btoa(
				'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>',
			);
		const el = renderIcon( svg, { title: 'X' } );
		expect( el.tagName ).toBe( 'SPAN' );
		expect( el.style.backgroundImage ).toContain( 'data:image/svg+xml;base64,' );
	} );
} );
