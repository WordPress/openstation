/**
 * `renderIcon` — silhouette SVG handling.
 *
 * An SVG data URI drawn in `currentColor` is asking to be filled by
 * whatever surface it lands on. A CSS `background-image` has no
 * colour to inherit, so painting one that way yields black — invisible
 * on a dark dock. The dispatcher paints those as a CSS mask instead,
 * which keeps only the alpha and fills it with `currentColor`.
 *
 * Fixed-colour art (the Games gamepad, a plugin's brand mark) must
 * keep the background-image path untouched.
 */
import { describe, expect, test } from 'vitest';
import { renderIcon } from '../../src/icon';

function svgUri( markup: string ): string {
	return 'data:image/svg+xml;base64,' + btoa( markup );
}

const SILHOUETTE = svgUri(
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
		'<rect x="5" y="9" width="54" height="46" fill="none" stroke="currentColor" stroke-width="4"/>' +
		'</svg>'
);

const FIXED_COLOUR = svgUri(
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
		'<rect x="5" y="9" width="54" height="46" fill="#6c5ce7"/>' +
		'</svg>'
);

describe( 'renderIcon — silhouette SVGs', () => {
	test( 'currentColor art paints as a currentColor mask', () => {
		const el = renderIcon( SILHOUETTE, { title: 'Corkboard', className: 'x' } );

		expect( el.tagName ).toBe( 'SPAN' );
		expect( el.classList.contains( 'x' ) ).toBe( true );
		expect( el.getAttribute( 'aria-hidden' ) ).toBe( 'true' );
		// The CSSOM normalises the keyword's case on the way in.
		expect( el.style.backgroundColor.toLowerCase() ).toBe( 'currentcolor' );
		expect( el.style.getPropertyValue( 'mask' ) ).toContain( SILHOUETTE );
		// The mask must not be fighting a background-image underneath.
		expect( el.style.backgroundImage ).toBe( 'none' );
	} );

	test( 'the mask is sized to contain, like the background-image path', () => {
		const el = renderIcon( SILHOUETTE, { title: 'Corkboard' } );

		expect( el.style.getPropertyValue( 'mask' ) ).toContain( 'contain' );
		expect( el.style.getPropertyValue( 'mask' ) ).toContain( 'no-repeat' );
		expect( el.style.display ).toBe( 'inline-block' );
	} );

	test( 'fixed-colour art keeps the background-image path', () => {
		const el = renderIcon( FIXED_COLOUR, { title: 'Games' } );

		expect( el.tagName ).toBe( 'SPAN' );
		expect( el.style.backgroundImage ).toContain( FIXED_COLOUR );
		expect( el.style.backgroundSize ).toBe( 'contain' );
		// No mask — the art carries its own colours and must keep them.
		expect( el.style.getPropertyValue( 'mask' ) ).toBe( '' );
		expect( el.style.backgroundColor ).toBe( '' );
	} );

	test( 'repeated renders of the same icon agree (memo is not stateful)', () => {
		const a = renderIcon( SILHOUETTE, { title: 'Corkboard' } );
		const b = renderIcon( SILHOUETTE, { title: 'Corkboard' } );
		const c = renderIcon( FIXED_COLOUR, { title: 'Games' } );

		expect( b.style.backgroundColor ).toBe( a.style.backgroundColor );
		expect( b.style.getPropertyValue( 'mask' ) ).toBe(
			a.style.getPropertyValue( 'mask' )
		);
		expect( c.style.getPropertyValue( 'mask' ) ).toBe( '' );
	} );

	test( 'malformed base64 still falls through to the letter-badge', () => {
		const el = renderIcon( 'data:image/svg+xml;base64,!!!nope!!!', {
			title: 'Foo',
		} );

		expect( el.classList.contains( 'desktop-mode-icon-letter' ) ).toBe( true );
	} );

	test( 'base64 that passes the charset check but not atob degrades safely', () => {
		// Valid base64 alphabet, invalid padding — `atob` throws. The
		// icon must still render, just via the background-image path.
		const el = renderIcon( 'data:image/svg+xml;base64,QUJDR', { title: 'Foo' } );

		expect( el.tagName ).toBe( 'SPAN' );
		expect( el.style.getPropertyValue( 'mask' ) ).toBe( '' );
		expect( el.style.backgroundImage ).toContain( 'data:image/svg+xml;base64,' );
	} );
} );
