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
		const el = document.createElement( 'span' );

		expect( applyIconMask( el, OS_GEAR_ICON, 'currentColor' ) ).toBe( true );
	} );
} );
