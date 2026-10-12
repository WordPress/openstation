/**
 * The ink on an accent fill (`--os-ui-accent-ink`): the label of a
 * primary button, the tick in a checked box.
 *
 * `accentWantsDarkInk` picks between Void and Starlight. The pick has
 * to be the one that reads better on the fill, measured as the WCAG
 * contrast ratio, for every swatch and for a custom colour. Pulse is
 * the exception: the brand pairs it with Starlight.
 */
import { describe, expect, test } from 'vitest';
import { accentWantsDarkInk } from '../../src/settings';

const VOID = '#0c0b0f';
const STARLIGHT = '#fffbff';

function luminance( hex: string ): number {
	const channel = ( i: number ): number => {
		const s = parseInt( hex.slice( 1 + i * 2, 3 + i * 2 ), 16 ) / 255;
		return s <= 0.03928 ? s / 12.92 : ( ( s + 0.055 ) / 1.055 ) ** 2.4;
	};
	return 0.2126 * channel( 0 ) + 0.7152 * channel( 1 ) + 0.0722 * channel( 2 );
}

function contrast( a: string, b: string ): number {
	const [ hi, lo ] = [ luminance( a ), luminance( b ) ].sort( ( x, y ) => y - x );
	return ( hi + 0.05 ) / ( lo + 0.05 );
}

describe( 'accentWantsDarkInk', () => {
	test.each( [
		[ 'Nebula', '#ec9bff' ],
		[ 'Sirius', '#9af2ff' ],
		[ 'Lagoon', '#9f98ff' ],
		[ 'Starlight', '#fffbff' ],
		[ 'WordPress Blue', '#2271b1' ],
		[ 'Indigo', '#3858e9' ],
		[ 'Teal', '#04a4cc' ],
		[ 'Emerald', '#059669' ],
		[ 'Amber', '#d97706' ],
		[ 'Rose', '#e11d48' ],
		[ 'custom red', '#ff0000' ],
		[ 'custom green', '#00a000' ],
		[ 'custom navy', '#000080' ],
	] )( '%s (%s) gets the ink with more contrast', ( _label, hex ) => {
		const ink = accentWantsDarkInk( hex ) ? VOID : STARLIGHT;
		const other = ink === VOID ? STARLIGHT : VOID;
		expect( contrast( hex, ink ) ).toBeGreaterThan( contrast( hex, other ) );
	} );

	test( 'a custom #ff0000 primary button passes AA', () => {
		const ink = accentWantsDarkInk( '#ff0000' ) ? VOID : STARLIGHT;
		expect( contrast( '#ff0000', ink ) ).toBeGreaterThanOrEqual( 4.5 );
	} );

	test( 'Pulse keeps the Starlight ink the brand pairs it with', () => {
		expect( accentWantsDarkInk( '#f252fc' ) ).toBe( false );
		expect( accentWantsDarkInk( '#F252FC' ) ).toBe( false );
	} );

	test( 'anything that is not a six-digit hex keeps Starlight', () => {
		expect( accentWantsDarkInk( 'red' ) ).toBe( false );
		expect( accentWantsDarkInk( '#fff' ) ).toBe( false );
	} );
} );
