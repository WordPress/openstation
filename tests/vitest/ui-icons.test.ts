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

		expect( OS_CORE_ICON_NAMES ).toHaveLength( 19 );
		expect( OS_OWN_ICON_NAMES ).toHaveLength( 11 );
		expect( OS_ICON_NAMES ).toHaveLength( 30 );
		expect( Object.keys( OS_ICONS ) ).toHaveLength( 30 );
	} );

	test( 'names the eleven that are ours', () => {

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

		const hardcoded = markup.match(
			/(?:fill|stroke|stop-color)\s*[=:]\s*"?\s*(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))/gi
		);
		expect(
			hardcoded,
			`${ name } hardcodes ${ ( hardcoded || [] ).join( ', ' ) }.`
		).toBeNull();
	} );

	test.each( OS_ICON_NAMES )( '%s is on the 24x24 grid', ( name ) => {

		expect( osIconSvg( name ) ).toContain( 'viewBox="0 0 24 24"' );
	} );

	test.each( OS_OWN_ICON_NAMES )( '%s keeps its stroke', ( name ) => {

		expect( OS_ICONS[ name ].a ).toContain( 'stroke-width="1.5"' );
	} );

	test.each( OS_CORE_ICON_NAMES )( '%s stays filled', ( name ) => {

		expect( OS_ICONS[ name ].a ).toBe( 'fill="currentColor"' );
	} );

	test( 'carries no title element', () => {

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

		const markup = osIconSvg( 'close', { size: null } );
		expect( markup ).not.toContain( 'width=' );
		expect( markup ).not.toContain( 'height=' );
	} );

	test( 'rotation wraps rather than redrawing', () => {

		const markup = osIconSvg( 'chevron-right', { rotate: 90 } );
		expect( markup ).toContain( '<g transform="rotate(90 12 12)">' );
		expect( markup ).toContain( OS_ICONS[ 'chevron-right' ].b );
	} );

	test( 'escapes a title and a class name', () => {

		const markup = osIconSvg( 'close', {
			title: '"><script>x</script>',
			className: 'a"b',
		} );
		expect( markup ).not.toContain( '<script>' );
		expect( markup ).toContain( 'class="a&quot;b"' );
	} );

	test( 'an unknown name renders nothing', () => {

		expect( osIconSvg( 'not-an-icon' ) ).toBe( '' );
		expect( osIconDataUri( 'not-an-icon' ) ).toBe( '' );
		expect( osIconDef( 'not-an-icon' ) ).toBeNull();
		expect( isOsIconName( 'not-an-icon' ) ).toBe( false );
		expect( isOsIconName( 'close' ) ).toBe( true );
	} );

	test( 'inherited object keys are not icons', () => {

		expect( osIconDef( 'constructor' ) ).toBeNull();
		expect( osIconDef( 'toString' ) ).toBeNull();
	} );
} );

describe( 'osIcon', () => {
	test( 'returns a parsed SVG element in the SVG namespace', () => {

		const el = osIcon( 'close', { size: 16 } );
		expect( el.namespaceURI ).toBe( 'http://www.w3.org/2000/svg' );
		expect( el.tagName.toLowerCase() ).toBe( 'svg' );
		expect( el.getAttribute( 'width' ) ).toBe( '16' );
		expect( el.querySelector( 'path' ) ).not.toBeNull();
	} );

	test( 'hands out a fresh element every call', () => {

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

		const uri = osIconDataUri( 'spaces', { size: 32 } );
		expect( uri.startsWith( 'data:image/svg+xml,' ) ).toBe( true );
		expect( decodeURIComponent( uri.slice( 'data:image/svg+xml,'.length ) ) ).toBe(
			osIconSvg( 'spaces', { size: 32 } )
		);
	} );

	test( 'survives the CSS url() sanitiser in os-window-button', () => {

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

		expect( Object.isFrozen( osIconSetApi ) ).toBe( true );
		expect( () => {
			( osIconSetApi as { svg: unknown } ).svg = () => 'pwned';
		} ).toThrow();
		expect( osIconSetApi.svg( 'close' ) ).toBe( osIconSvg( 'close' ) );
	} );

	test( 'hands out copies of its lists, not the originals', () => {

		expect( Object.isFrozen( osIconSetApi.names ) ).toBe( true );
		expect( osIconSetApi.names ).not.toBe( OS_ICON_NAMES );
		expect( osIconSetApi.ours ).not.toBe( OS_OWN_ICON_NAMES );
	} );
} );
