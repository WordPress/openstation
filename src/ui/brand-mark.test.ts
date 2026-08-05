/**
 * Tests for the OpenStation logomark art.
 *
 * The mark is painted directly by the rebrand announcement, with no mask
 * in the way, so the property worth pinning is the opposite of the one
 * shell tiles need: it names the brand colour rather than inheriting
 * whatever the surface happens to be. A `currentColor` here would make
 * the announcement's mark take the dialog's text colour and stop being
 * the brand.
 */
import { describe, expect, test } from 'vitest';
import { OPENSTATION_LOGOMARK_SVG } from './brand-mark';

describe( 'the OpenStation mark as artwork', () => {
	test( 'keeps the brand Starlight fill', () => {
		expect( OPENSTATION_LOGOMARK_SVG ).toContain( '#fffbff' );
		expect( OPENSTATION_LOGOMARK_SVG ).not.toContain( 'currentColor' );
	} );
} );
