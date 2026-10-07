import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
	GRID_CELL_H,
	GRID_CELL_H_LARGE,
	GRID_CELL_W,
	GRID_CELL_W_LARGE,
	GRID_GAP_X,
	GRID_GAP_Y,
	GRID_METRICS,
	GRID_METRICS_LARGE,
	GRID_PADDING,
	TILE_H,
	TILE_H_LARGE,
	TILE_W,
	TILE_W_LARGE,
} from '../../src/desktop-files/grid';

const ROOT = resolve( __dirname, '../..' );

function css( file: string ): string {
	return readFileSync( resolve( ROOT, file ), 'utf8' );
}

function token( source: string, name: string ): number {
	const match = new RegExp(
		`--${ name }:\\s*(-?[0-9.]+)px\\s*;`,
	).exec( source );
	if ( ! match ) {
		throw new Error(
			`variables.css declares no --${ name }. The grid tokens are ` +
				'the source of truth for src/desktop-files/grid.ts; if you ' +
				'removed one, remove its TS mirror too.',
		);
	}
	return Number( match[ 1 ] );
}

describe( 'icon grid metrics', () => {
	const variables = css( 'assets/css/variables.css' );

	test( 'the TS mirror matches the CSS declaration', () => {
		expect( TILE_W ).toBe( token( variables, 'os-tile-w' ) );
		expect( TILE_H ).toBe( token( variables, 'os-tile-h' ) );
		expect( GRID_GAP_X ).toBe( token( variables, 'os-grid-gap-x' ) );
		expect( GRID_GAP_Y ).toBe( token( variables, 'os-grid-gap-y' ) );
		expect( GRID_PADDING ).toBe( token( variables, 'os-grid-padding' ) );
		expect( TILE_W_LARGE ).toBe( token( variables, 'os-tile-w-large' ) );
		expect( TILE_H_LARGE ).toBe( token( variables, 'os-tile-h-large' ) );
	} );

	test( 'the cell is derived from tile + gap, never declared', () => {
		expect( GRID_CELL_W ).toBe( TILE_W + GRID_GAP_X );
		expect( GRID_CELL_H ).toBe( TILE_H + GRID_GAP_Y );
		expect( GRID_CELL_W_LARGE ).toBe( TILE_W_LARGE + GRID_GAP_X );
		expect( GRID_CELL_H_LARGE ).toBe( TILE_H_LARGE + GRID_GAP_Y );
	} );

	test( 'every canvas lays out on the same pitch', () => {

		expect( GRID_METRICS ).toEqual( {
			w: GRID_CELL_W,
			h: GRID_CELL_H,
			pad: GRID_PADDING,
		} );
		expect( GRID_METRICS_LARGE ).toEqual( {
			w: GRID_CELL_W_LARGE,
			h: GRID_CELL_H_LARGE,
			pad: GRID_PADDING,
		} );
	} );

	test( 'there is a visible gap between neighbouring tiles', () => {

		expect( GRID_GAP_X ).toBeGreaterThanOrEqual( 12 );
		expect( GRID_GAP_Y ).toBeGreaterThanOrEqual( 12 );
	} );

	test( 'the tile is sized from the tokens, and sized inside its box', () => {
		const files = css( 'assets/css/desktop-files.css' );
		const rule = /\.os-file-tile \{([\s\S]*?)\n\}/.exec( files );
		expect( rule ).not.toBeNull();
		const body = rule![ 1 ];

		expect( body ).toMatch( /box-sizing:\s*border-box/ );
		expect( body ).toMatch( /width:\s*var\(\s*--os-tile-w/ );

		expect( body ).toMatch( /\n\theight:\s*var\(\s*--os-tile-h/ );
		expect( body ).not.toMatch( /min-height:\s*var\(\s*--os-tile-h/ );
	} );

	test( 'the fixed height fits the tallest a tile can be', () => {

		const files = css( 'assets/css/desktop-files.css' );
		const label = /\.os-file-tile__label \{([\s\S]*?)\n\}/.exec( files );
		const fontSize = Number(
			/font-size:\s*([0-9.]+)px/.exec( label![ 1 ] )![ 1 ],
		);
		const lineHeight = Number(
			/line-height:\s*([0-9.]+)/.exec( label![ 1 ] )![ 1 ],
		);
		const lines = Number(
			/-webkit-line-clamp:\s*([0-9]+)/.exec( label![ 1 ] )![ 1 ],
		);
		const needed = 8 + 48 + 6 + fontSize * lineHeight * lines + 8;
		expect( TILE_H ).toBeGreaterThanOrEqual( needed );
	} );

	test( 'flow-laid tiles opt OUT of the fixed height', () => {

		const mw = css( 'assets/css/my-wordpress.css' );
		const rule = /\.os-my-wordpress__media-tile \{([\s\S]*?)\n\}/.exec( mw );
		expect( rule ).not.toBeNull();
		expect( rule![ 1 ] ).toMatch( /height:\s*auto/ );
	} );

	test( 'image-led sections re-point the tokens instead of overriding width', () => {

		const mw = css( 'assets/css/my-wordpress.css' );
		const rule = /\.os-my-wordpress__tiles--large \{([\s\S]*?)\n\}/.exec( mw );
		expect( rule ).not.toBeNull();
		expect( rule![ 1 ] ).toMatch( /--os-tile-w:\s*var\(\s*--os-tile-w-large/ );
		expect( rule![ 1 ] ).toMatch( /--os-tile-h:\s*var\(\s*--os-tile-h-large/ );
	} );

	test( 'flow-laid canvases use the same gaps as the absolute ones', () => {

		const mw = css( 'assets/css/my-wordpress.css' );
		for ( const selector of [
			'os-my-wordpress__media-grid',
			'os-my-wordpress__usage-grid',
		] ) {
			const rule = new RegExp( `\\.${ selector } \\{([\\s\\S]*?)\\n\\}` ).exec(
				mw,
			);
			expect( rule, selector ).not.toBeNull();
			expect( rule![ 1 ], selector ).toMatch(
				/gap:\s*var\(\s*--os-grid-gap-y[^;]*var\(\s*--os-grid-gap-x/,
			);
			expect( rule![ 1 ], selector ).toMatch(
				/padding:\s*var\(\s*--os-grid-padding/,
			);
		}
	} );

	test( 'the grid tokens are scoped to the shell, not :root', () => {

		const shellScope = variables.slice(
			variables.indexOf( 'body.os-active {' ),
		);
		expect( shellScope ).toContain( '--os-tile-w:' );
		const beforeShell = variables.slice(
			0,
			variables.indexOf( 'body.os-active {' ),
		);
		expect( beforeShell ).not.toContain( '--os-tile-w:' );
	} );
} );
