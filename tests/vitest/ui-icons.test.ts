/**
 * The thirty-icon set.
 *
 * `src/ui/icons/set.ts` is generated from the brand repository, so
 * these tests are not about whether a path is drawn correctly. They
 * are about the two things a generator cannot check from where it
 * runs: that the drawings still obey the shell's rules once they are
 * in here, and that the rendering helpers around them keep the
 * contracts every call site relies on.
 */
import { describe, expect, test } from 'vitest';
import {
	isOsIconName,
	osIcon,
	osIconDataUri,
	osIconDef,
	osIconSetApi,
	osIconSvg,
	OS_CORE_ICON_NAMES,
	OS_ICONS,
	OS_ICON_NAMES,
	OS_OWN_ICON_NAMES,
} from '../../src/ui/icons';

describe( 'the icon set', () => {
	test( 'is nineteen from Core and eleven of ours', () => {
		// The split is the rule stated out loud: Core owns the verbs,
		// OpenStation owns the nouns. A thirty-first icon is a design
		// decision, not a drive-by addition, so the counts are pinned.
		expect( OS_CORE_ICON_NAMES ).toHaveLength( 19 );
		expect( OS_OWN_ICON_NAMES ).toHaveLength( 11 );
		expect( OS_ICON_NAMES ).toHaveLength( 30 );
		expect( Object.keys( OS_ICONS ) ).toHaveLength( 30 );
	} );

	test( 'names the eleven that are ours', () => {
		// These are the only shapes drawn locally. Anything joining
		// them has to be station vocabulary rather than a generic verb.
		expect( [ ...OS_OWN_ICON_NAMES ].sort() ).toEqual( [
			'apps',
			'command',
			'copilot',
			'dock',
			'lock',
			'snap',
			'spaces',
			'user',
			'widgets',
			'window',
			'windows',
		] );
	} );

	test.each( OS_ICON_NAMES )( '%s paints in currentColor only', ( name ) => {
		const markup = osIconSvg( name );
		// A hardcoded colour cannot follow a control through its hover
		// and selected states, cannot follow the shell into a desktop
		// theme, and is invisible to the mask path the dock and title
		// bar paint icons through.
		const hardcoded = markup.match(
			/(?:fill|stroke|stop-color)\s*[=:]\s*"?\s*(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))/gi
		);
		expect(
			hardcoded,
			`${ name } hardcodes ${ ( hardcoded || [] ).join( ', ' ) }.`
		).toBeNull();
	} );

	test.each( OS_ICON_NAMES )( '%s is on the 24x24 grid', ( name ) => {
		// The two drawing languages share the grid even though one is
		// filled and the other monoline. A stray viewBox is what makes
		// one glyph sit visibly larger than the icons beside it.
		expect( osIconSvg( name ) ).toContain( 'viewBox="0 0 24 24"' );
	} );

	test.each( OS_OWN_ICON_NAMES )( '%s keeps its stroke', ( name ) => {
		// Ours are monoline at 1.5, unlike the outlined copies in
		// `assets/icons/` that WordPress's registry needs. If a shell
		// icon ever arrives outlined it will look right at a glance and
		// wrong at every size, because the stroke stops scaling with
		// the drawing.
		expect( OS_ICONS[ name ].a ).toContain( 'stroke-width="1.5"' );
	} );

	test.each( OS_CORE_ICON_NAMES )( '%s stays filled', ( name ) => {
		// Core's icons are solid paths. Redrawing one as monoline stops
		// it being recognisable as the Core icon, which was the whole
		// reason for borrowing it.
		expect( OS_ICONS[ name ].a ).toBe( 'fill="currentColor"' );
	} );

	test( 'carries no title element', () => {
		// The accessible name belongs to the call site: a <title> would
		// be announced on every instance regardless of what the button
		// around it already says.
		for ( const name of OS_ICON_NAMES ) {
			expect( OS_ICONS[ name ].b ).not.toContain( '<title' );
		}
	} );
} );

describe( 'osIconSvg', () => {
	test( 'defaults to 24 and hides itself from assistive tech', () => {
		const markup = osIconSvg( 'close' );
		expect( markup ).toContain( 'width="24"' );
		expect( markup ).toContain( 'height="24"' );
		expect( markup ).toContain( 'aria-hidden="true"' );
		expect( markup ).not.toContain( 'role="img"' );
	} );

	test( 'a title makes it an image with a name', () => {
		const markup = osIconSvg( 'close', { title: 'Dismiss' } );
		expect( markup ).toContain( 'role="img"' );
		expect( markup ).toContain( 'aria-label="Dismiss"' );
		expect( markup ).not.toContain( 'aria-hidden' );
	} );

	test( 'size null leaves the box to CSS', () => {
		// Components that size their glyph in shadow styles pass null
		// rather than repeating the number in two places.
		const markup = osIconSvg( 'close', { size: null } );
		expect( markup ).not.toContain( 'width=' );
		expect( markup ).not.toContain( 'height=' );
	} );

	test( 'rotation wraps rather than redrawing', () => {
		// The set ships one chevron, pointing right, the way Core does.
		// Rotating in a wrapper keeps the path byte-identical to the
		// brand source so a re-export from upstream still lands clean.
		const markup = osIconSvg( 'chevron-right', { rotate: 90 } );
		expect( markup ).toContain( '<g transform="rotate(90 12 12)">' );
		expect( markup ).toContain( OS_ICONS[ 'chevron-right' ].b );
	} );

	test( 'escapes a title and a class name', () => {
		// Both reach this from plugin registrations, so neither may
		// close the attribute it lands in.
		const markup = osIconSvg( 'close', {
			title: '"><script>x</script>',
			className: 'a"b',
		} );
		expect( markup ).not.toContain( '<script>' );
		expect( markup ).toContain( 'class="a&quot;b"' );
	} );

	test( 'an unknown name renders nothing', () => {
		// A missing glyph is a blemish; a thrown error inside a render
		// pass takes the whole surface down with it.
		expect( osIconSvg( 'not-an-icon' ) ).toBe( '' );
		expect( osIconDataUri( 'not-an-icon' ) ).toBe( '' );
		expect( osIconDef( 'not-an-icon' ) ).toBeNull();
		expect( isOsIconName( 'not-an-icon' ) ).toBe( false );
		expect( isOsIconName( 'close' ) ).toBe( true );
	} );

	test( 'inherited object keys are not icons', () => {
		// `OS_ICONS[ name ]` on a plugin-supplied string would happily
		// resolve `constructor` or `toString` without the lookup guard.
		expect( osIconDef( 'constructor' ) ).toBeNull();
		expect( osIconDef( 'toString' ) ).toBeNull();
	} );
} );

describe( 'osIcon', () => {
	test( 'returns a parsed SVG element in the SVG namespace', () => {
		// Parsed through innerHTML on an HTML div rather than
		// createElementNS: the HTML parser namespaces the children
		// correctly, and a hand-built root does not.
		const el = osIcon( 'close', { size: 16 } );
		expect( el.namespaceURI ).toBe( 'http://www.w3.org/2000/svg' );
		expect( el.tagName.toLowerCase() ).toBe( 'svg' );
		expect( el.getAttribute( 'width' ) ).toBe( '16' );
		expect( el.querySelector( 'path' ) ).not.toBeNull();
	} );

	test( 'hands out a fresh element every call', () => {
		// A node lives in one place in the DOM. Two call sites sharing
		// one element would move it between them instead of drawing it
		// twice, and the second surface would silently render empty.
		expect( osIcon( 'close' ) ).not.toBe( osIcon( 'close' ) );
	} );

	test( 'an unknown name still returns an element to append', () => {
		const el = osIcon( 'not-an-icon' );
		expect( el.tagName.toLowerCase() ).toBe( 'svg' );
		expect( el.childNodes ).toHaveLength( 0 );
	} );
} );

describe( 'osIconDataUri', () => {
	test( 'percent-encodes rather than base64', () => {
		// Readable in devtools, safe past btoa's Latin-1 limit, and it
		// compresses in a stylesheet.
		const uri = osIconDataUri( 'spaces', { size: 32 } );
		expect( uri.startsWith( 'data:image/svg+xml,' ) ).toBe( true );
		expect( decodeURIComponent( uri.slice( 'data:image/svg+xml,'.length ) ) ).toBe(
			osIconSvg( 'spaces', { size: 32 } )
		);
	} );

	test( 'survives the CSS url() sanitiser in os-window-button', () => {
		// Title-bar and dock art is painted through a CSS mask, and the
		// value lands inside url('…') inside a style attribute. Quotes,
		// parens, backslashes, angle brackets and whitespace are what
		// would break out of it, so none may survive the encoding.
		const uri = osIconDataUri( 'window' );
		expect( uri ).not.toMatch( /['"()\\<>\s]/ );
	} );
} );

describe( 'wp.os.iconSet', () => {
	test( 'exposes the same three renderers the shell uses', () => {
		expect( osIconSetApi.svg( 'trash', { size: 20 } ) ).toBe(
			osIconSvg( 'trash', { size: 20 } )
		);
		expect( osIconSetApi.dataUri( 'spaces' ) ).toBe(
			osIconDataUri( 'spaces' )
		);
		expect( osIconSetApi.node( 'window' ).tagName.toLowerCase() ).toBe(
			'svg'
		);
		expect( osIconSetApi.has( 'window' ) ).toBe( true );
		expect( osIconSetApi.has( 'nope' ) ).toBe( false );
	} );

	test( 'lists the whole set and the eleven that are ours', () => {
		expect( osIconSetApi.names ).toHaveLength( 30 );
		expect( osIconSetApi.ours ).toHaveLength( 11 );
		expect( osIconSetApi.ours ).toContain( 'copilot' );
		expect( osIconSetApi.ours ).not.toContain( 'trash' );
	} );

	test( 'cannot be reassigned by one plugin on behalf of the rest', () => {
		// Every plugin on the page reaches the same object. A third
		// party swapping `svg` would silently change what everyone
		// else draws, so the surface is frozen rather than trusted.
		expect( Object.isFrozen( osIconSetApi ) ).toBe( true );
		expect( () => {
			( osIconSetApi as { svg: unknown } ).svg = () => 'pwned';
		} ).toThrow();
		expect( osIconSetApi.svg( 'close' ) ).toBe( osIconSvg( 'close' ) );
	} );

	test( 'hands out copies of its lists, not the originals', () => {
		// `names.sort()` in a plugin must not reorder the set for the
		// shell. Frozen arrays make the attempt throw rather than
		// silently succeed.
		expect( Object.isFrozen( osIconSetApi.names ) ).toBe( true );
		expect( osIconSetApi.names ).not.toBe( OS_ICON_NAMES );
		expect( osIconSetApi.ours ).not.toBe( OS_OWN_ICON_NAMES );
	} );
} );
