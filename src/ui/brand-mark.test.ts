/**
 * Tests for the OpenStation logomark art.
 *
 * The single load-bearing property of the icon is that it is drawn in
 * `currentColor`, because that keyword is what routes it down the mask
 * path in BOTH painters. Nothing about the art looks wrong if someone
 * replaces it with a literal fill; it just quietly stops being a mark
 * and starts being a solid blob of dock-icon colour, which is the bug
 * this file exists to have caught once already.
 */
import { describe, expect, test } from 'vitest';
import { renderIcon } from '../icon';
import { applyIconMask } from '../desktop-themes/paint-tinted-icon';
import {
	OPENSTATION_LOGOMARK_SVG,
	OPENSTATION_MARK_ICON,
	OPENSTATION_MARK_SVG,
} from './brand-mark';

describe( 'the OpenStation mark as an icon', () => {
	test( 'is drawn in currentColor', () => {
		expect( OPENSTATION_MARK_SVG ).toContain( 'currentColor' );
	} );

	test( 'carries no literal fill that a mask would discard', () => {
		// A second fill would survive nowhere and mislead the next
		// reader into thinking the icon is coloured art.
		expect( OPENSTATION_MARK_SVG ).not.toMatch( /fill="#/ );
	} );

	test( 'renderIcon paints it as a mask, not a background image', () => {
		// The background-image branch is what produced a white rounded
		// square when this shipped as the app chip.
		const el = renderIcon( OPENSTATION_MARK_ICON, {
			title: 'OpenStation Settings',
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

		expect( applyIconMask( el, OPENSTATION_MARK_ICON, 'currentColor' ) ).toBe(
			true,
		);
	} );
} );

describe( 'the OpenStation mark as artwork', () => {
	test( 'keeps the brand Starlight fill', () => {
		// This one is painted directly by the rebrand announcement, with
		// no mask in the way, so it names the brand colour rather than
		// inheriting whatever the surface happens to be.
		expect( OPENSTATION_LOGOMARK_SVG ).toContain( '#fffbff' );
		expect( OPENSTATION_LOGOMARK_SVG ).not.toContain( 'currentColor' );
	} );

	test( 'both variants trace the same path', () => {
		const path = /d="(M38\.792[^"]+)"/;
		expect( path.exec( OPENSTATION_MARK_SVG )?.[ 1 ] ).toBe(
			path.exec( OPENSTATION_LOGOMARK_SVG )?.[ 1 ],
		);
	} );
} );
