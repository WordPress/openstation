/**
 * OS Settings → Appearance → Accent, at the apply pass: link text.
 *
 * The palette declares `--os-link` and `--os-ui-accent-strong` at
 * Nebula, the brand's pair for Pulse. The picker wrote the accent, its
 * ink and its dim, and left these two alone, so every link and every
 * accent-strong label stayed pink whichever swatch was picked. These
 * pin that each built-in swatch moves them, to a color that still
 * reads at WCAG AA on the palette's dark surfaces.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import { OsSettings } from '../../src/settings';
import { DEFAULT_ACCENTS, STORAGE_KEY } from '../../src/settings/constants';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import type { WallpaperLayer } from '../../src/wallpapers/layer';

const CSS = readFileSync(
	resolve( __dirname, '../../assets/css/variables.css' ),
	'utf8',
);
const TOKENS = [ '--os-link', '--os-ui-accent-strong' ];

function declared( token: string ): string {
	const match = new RegExp( `\\n\\t${ token }:\\s*([^;]+);` ).exec( CSS );
	return match ? match[ 1 ].trim() : '';
}

function luminance( hex: string ): number {
	const rgb = /^#([0-9a-f]{6})$/i.exec( hex )![ 1 ];
	const [ r, g, b ] = [ 0, 2, 4 ].map( ( i ) => {
		const s = parseInt( rgb.slice( i, i + 2 ), 16 ) / 255;
		return s <= 0.03928 ? s / 12.92 : ( ( s + 0.055 ) / 1.055 ) ** 2.4;
	} );
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast( a: string, b: string ): number {
	const [ hi, lo ] = [ luminance( a ), luminance( b ) ].sort( ( x, y ) => y - x );
	return ( hi + 0.05 ) / ( lo + 0.05 );
}

// The palette's surfaces text sits on: Void, Obsidian, Astro.
const SURFACES = [
	'--os-ui-surface-sunken',
	'--os-ui-surface',
	'--os-ui-surface-elevated',
].map( declared );

function applyAccent( accent: string ): void {
	window.localStorage.setItem( STORAGE_KEY, JSON.stringify( { accent } ) );
	new OsSettings( { apply: vi.fn() } as unknown as WallpaperLayer ).apply();
}

/** What a link resolves to: the inline write, else the palette's value. */
function linkOf( token: string ): string {
	return document.body.style.getPropertyValue( token ) || declared( token );
}

beforeEach( () => {
	_resetAllSharedStoresForTests();
	installHooksStub();
	window.localStorage.clear();
	document.body.innerHTML = '';
	document.body.removeAttribute( 'style' );
	const shell = document.createElement( 'div' );
	shell.id = 'os-shell';
	document.body.appendChild( shell );
	return () => clearHooksStub();
} );

describe( 'apply(): link color follows the accent', () => {
	test.each( DEFAULT_ACCENTS.map( ( a ) => [ a.id, a.value ] ) )(
		'%s (%s): links follow it and read at AA on every dark surface',
		( id, value ) => {
			applyAccent( id );
			for ( const token of TOKENS ) {
				const link = linkOf( token );
				for ( const surface of SURFACES ) {
					expect(
						contrast( link, surface ),
						`${ token } ${ link } on ${ surface }`,
					).toBeGreaterThanOrEqual( 4.5 );
				}
				// Pulse keeps the palette's Nebula; every other swatch
				// must move the link off it.
				if ( id !== 'pulse' && value !== declared( token ) ) {
					expect( link, token ).not.toBe( declared( token ) );
				}
			}
		},
	);

	test.each( [ 'pulse', 'nebula' ] )(
		'%s leaves links at Nebula, #ec9bff',
		( id ) => {
			applyAccent( id );
			for ( const token of TOKENS ) {
				expect( linkOf( token ) ).toBe( '#ec9bff' );
			}
		},
	);

	test( 'a worn desktop theme keeps the link color it declares', () => {
		document
			.getElementById( 'os-shell' )!
			.setAttribute( 'data-os-desktop-theme', 'legacy' );
		applyAccent( 'wp-blue' );
		for ( const token of TOKENS ) {
			expect( document.body.style.getPropertyValue( token ) ).toBe( '' );
		}
	} );
} );
