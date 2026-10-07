import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join( __dirname, '../..' );
const DESKTOP = readFileSync( join( ROOT, 'assets/css/desktop.css' ), 'utf8' );

const TARGET_MIN = 24;

function boxOf( selector: string ): { width: number; height: number } {
	const escaped = selector.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' );
	const rule = new RegExp( `^${ escaped }\\s*\\{([^}]*)\\}`, 'm' ).exec( DESKTOP );
	expect( rule, `no rule found for ${ selector }` ).not.toBeNull();
	const body = rule![ 1 ];
	const width = /(?<!-)width\s*:\s*([\d.]+)px/.exec( body );
	const height = /(?<!-)height\s*:\s*([\d.]+)px/.exec( body );
	expect( width, `${ selector } declares no width` ).not.toBeNull();
	expect( height, `${ selector } declares no height` ).not.toBeNull();
	return { width: Number( width![ 1 ] ), height: Number( height![ 1 ] ) };
}

describe( 'widget chrome tap targets', () => {
	test.each( [
		'.os-widgets__card-redock',
		'.os-widgets__chrome .os-widgets__card-close',
		'.os-widgets__card-close',
	] )( '%s is at least 24x24', ( selector ) => {
		const { width, height } = boxOf( selector );
		expect( width ).toBeGreaterThanOrEqual( TARGET_MIN );
		expect( height ).toBeGreaterThanOrEqual( TARGET_MIN );
	} );

	test( 'the two chrome siblings stay clear of each other', () => {

		const chrome = /^\.os-widgets__chrome\s*\{([^}]*)\}/m.exec( DESKTOP );
		expect( chrome, 'no .os-widgets__chrome rule' ).not.toBeNull();
		const gap = /(?<!-)gap\s*:\s*([\d.]+)px/.exec( chrome![ 1 ] );
		expect( gap, '.os-widgets__chrome declares no gap' ).not.toBeNull();

		const redock = boxOf( '.os-widgets__card-redock' );
		const close = boxOf( '.os-widgets__chrome .os-widgets__card-close' );
		const centres = redock.width / 2 + Number( gap![ 1 ] ) + close.width / 2;

		expect( centres ).toBeGreaterThanOrEqual( TARGET_MIN );
	} );

	test( 'the reader can tell a short box from a tall one', () => {

		expect( boxOf( '.os-widgets__grip' ) ).toEqual( { width: 10, height: 16 } );
	} );
} );
