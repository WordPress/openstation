import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join( __dirname, '../..' );
const css = readFileSync( join( root, 'apps/os-settings/os-settings.css' ), 'utf8' );
const entry = readFileSync( join( root, 'apps/os-settings/os-settings.os.ts' ), 'utf8' );

function appliedClasses(): string[] {
	return Array.from(
		entry.matchAll( /<div class="([\w-]+)">\s*\n\s*<div class="os-settings__search">/g ),
		( m ) => m[ 1 ],
	);
}

describe( 'OS Settings root class', () => {
	test( 'the app applies a class, and the stylesheet uses it', () => {
		const applied = appliedClasses();
		expect( applied ).toEqual( [ 'os-settings' ] );

		for ( const cls of applied ) {
			const used = new RegExp( `\\.${ cls }(?![\\w-])` ).test( css );
			expect(
				used,
				`the app's root wears ".${ cls }" but os-settings.css never selects it`,
			).toBe( true );
		}
	} );

	test( 'the stylesheet has no orphaned root scope of its own', () => {

		const roots = new Set(
			Array.from(
				css.matchAll( /^\.(os-settings|desktop-mode-os-settings)(?![\w-])/gm ),
				( m ) => m[ 1 ],
			),
		);
		const applied = new Set( appliedClasses() );
		for ( const r of roots ) {
			expect(
				applied.has( r ),
				`os-settings.css scopes rules under ".${ r }" but nothing applies it`,
			).toBe( true );
		}
	} );

	test( "the About tab's height chain is scoped under a live class", () => {
		const applied = appliedClasses();
		const chain = css.match( /\.[\w-]+\s*>\s*os-tabpanel\[\s*for='about'\s*\]/g );
		expect( chain, 'the About tabpanel height rules are still here' ).not.toBeNull();
		for ( const selector of chain ?? [] ) {
			const scope = /^\.([\w-]+)/.exec( selector )?.[ 1 ] ?? '';
			expect( applied ).toContain( scope );
		}
	} );

	test( 'the sheet rides the app, not a shell enqueue', () => {

		const assets = readFileSync( join( root, 'includes/assets.php' ), 'utf8' );
		expect( assets ).not.toMatch( /wp_register_style\(\s*'os-settings'/ );
	} );
} );
