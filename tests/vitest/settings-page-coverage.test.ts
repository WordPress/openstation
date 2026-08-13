/**
 * Every setting belongs to exactly one page.
 *
 * The Reset bar resets the page it names and nothing else, which only
 * works if the page-to-settings map in `panel.ts` covers the whole of
 * `OsSettingsState`. A key nobody claims is a setting with no way back
 * to its default on any page, and a key two pages claim is one page
 * silently resetting another page's control.
 *
 * Neither failure shows up in the UI: the button still looks right and
 * still does something. So the map is checked against `DEFAULTS`,
 * which is the actual shape of the saved state, rather than against a
 * second list that could drift the same way.
 *
 * The map is read out of the module source instead of imported.
 * `panel.ts` pulls in the whole panel (every section builder, the Pixi
 * About scene, the component reference) as a side effect of being
 * loaded, and none of that is what this test is about.
 */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULTS } from '../../src/settings/constants';

const SOURCE = readFileSync(
	resolve( __dirname, '../../src/settings/panel.ts' ),
	'utf8'
);

/**
 * The keys each page claims, parsed out of the `PAGE_SETTINGS`
 * literal, plus the `NEVER_RESET` list.
 */
function parseList( name: string ): string[] {
	const start = SOURCE.indexOf( `const ${ name }` );
	expect(
		start,
		`${ name } is gone from panel.ts. If it was renamed, rename it here too; ` +
			'if the per-page reset was removed, this test should go with it.'
	).toBeGreaterThan( -1 );
	// Walk to the semicolon that ends the declaration, tracking bracket
	// depth so the object's own braces and the arrays inside it don't
	// end it early. A fixed terminator does not work for both shapes:
	// PAGE_SETTINGS closes on `};` and NEVER_RESET on `];`, and taking
	// the wrong one silently swallows the rest of the file.
	let depth = 0;
	let end = SOURCE.length;
	for ( let i = SOURCE.indexOf( '=', start ); i < SOURCE.length; i++ ) {
		const c = SOURCE[ i ];
		if ( c === '{' || c === '[' ) {
			depth++;
		} else if ( c === '}' || c === ']' ) {
			depth--;
		} else if ( c === ';' && depth === 0 ) {
			end = i;
			break;
		}
	}
	const body = SOURCE.slice( start, end );
	return Array.from( body.matchAll( /'([a-zA-Z][a-zA-Z0-9-]*)'/g ) ).map(
		( m ) => m[ 1 ]
	);
}

const STATE_KEYS = Object.keys( DEFAULTS );
// Page ids appear in the same quoted form as the keys, so drop the
// ones that name a page rather than a setting.
const PAGE_IDS = [
	'appearance',
	'themes',
	'windows',
	'apps-icons',
	'features',
];
const claimed = parseList( 'PAGE_SETTINGS' ).filter(
	( token ) => ! PAGE_IDS.includes( token )
);
const neverReset = parseList( 'NEVER_RESET' );

describe( 'per-page reset covers the settings state', () => {
	test( 'the parse found a map to check', () => {
		// Guards the guard: a refactor that changed the literal's shape
		// would otherwise turn every assertion below into a silent pass.
		expect( claimed.length ).toBeGreaterThan( 30 );
		expect( STATE_KEYS.length ).toBeGreaterThan( 30 );
	} );

	test( 'every setting is claimed by a page', () => {
		const unclaimed = STATE_KEYS.filter(
			( key ) => ! claimed.includes( key ) && ! neverReset.includes( key )
		);
		expect(
			unclaimed,
			`These settings belong to no page, so no Reset button can put ` +
				`them back: ${ unclaimed.join( ', ' ) }. Add each one to the ` +
				'page that owns its control in PAGE_SETTINGS (or to ' +
				'NEVER_RESET, with a reason).'
		).toEqual( [] );
	} );

	test( 'no page claims a setting that does not exist', () => {
		const unknown = claimed.filter( ( key ) => ! STATE_KEYS.includes( key ) );
		expect(
			unknown,
			`PAGE_SETTINGS lists keys that are not in the settings state: ` +
				`${ unknown.join( ', ' ) }. A renamed setting leaves its old ` +
				'name behind here, where it resets nothing.'
		).toEqual( [] );
	} );

	test( 'no setting is claimed twice', () => {
		const seen = new Set< string >();
		const duplicated = claimed.filter( ( key ) => {
			if ( seen.has( key ) ) {
				return true;
			}
			seen.add( key );
			return false;
		} );
		expect(
			duplicated,
			`These settings are claimed by more than one page: ` +
				`${ duplicated.join( ', ' ) }. Resetting either page would ` +
				"reach into the other page's controls."
		).toEqual( [] );
	} );

	test( 'the never-reset list stays deliberate', () => {
		// Not a value assertion for its own sake: this list is the one
		// hole in the coverage above, so it should be short enough that
		// growing it is a decision somebody makes on purpose.
		expect( neverReset ).toEqual( [ 'customImage' ] );
	} );
} );
