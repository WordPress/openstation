/**
 * Tests for the OpenStation Preferences gear.
 *
 * The load-bearing property is that the art is drawn in `currentColor`,
 * because that keyword is what routes it down the mask path in BOTH
 * painters. Nothing about the art looks wrong if someone replaces it
 * with a literal fill; the tile just quietly stops being a gear and
 * starts being a solid blob of dock-icon colour.
 */
import { describe, expect, test } from 'vitest';
import { renderIcon } from '../icon';
import { applyIconMask } from '../desktop-themes/paint-tinted-icon';
import { OS_GEAR_ICON, OS_GEAR_SVG } from './gear-icon';

describe( 'the OpenStation Preferences gear', () => {
	test( 'is drawn in currentColor', () => {
		expect( OS_GEAR_SVG ).toContain( 'currentColor' );
	} );

	test( 'carries no literal fill that a mask would discard', () => {
		expect( OS_GEAR_SVG ).not.toMatch( /fill="#/ );
	} );

	test( 'draws a full ring of teeth', () => {
		// Eight teeth, 45° apart, the last at 315°. A dropped tooth or a
		// wrong step leaves a visible gap in the rim.
		const angles = [ ...OS_GEAR_SVG.matchAll( /rotate\((\d+) 32 32\)/g ) ].map(
			( m ) => Number( m[ 1 ] ),
		);

		expect( angles ).toEqual( [ 0, 45, 90, 135, 180, 225, 270, 315 ] );
	} );

	test( 'renderIcon paints it as a mask, not a background image', () => {
		const el = renderIcon( OS_GEAR_ICON, {
			title: 'OpenStation Preferences',
			className: 'os-window__icon',
		} );

		expect( el.style.getPropertyValue( 'mask' ) ).not.toBe( '' );
		expect( el.style.backgroundImage ).toBe( 'none' );
	} );

	test( 'the dock can mask it', () => {
		// `_makeSvgIcon()` in src/dock.ts masks every image icon with
		// currentColor; an un-maskable URL would fall back to the
		// force-whitened background-image path.
		const el = document.createElement( 'span' );

		expect( applyIconMask( el, OS_GEAR_ICON, 'currentColor' ) ).toBe( true );
	} );
} );
