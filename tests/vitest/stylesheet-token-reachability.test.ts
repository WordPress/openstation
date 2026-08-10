/**
 * Feature stylesheets must not pin a palette token to a bare colour
 * literal.
 *
 * The light-DOM counterpart of `component-token-reachability.test.ts`.
 * That one guards `:host` in web components; this one guards the same
 * mistake one layer out, in `assets/css/*.css`.
 *
 * `variables.css` declares the palette on `body.os-active`. A feature
 * stylesheet that redeclares one of those names as a literal:
 *
 *     .my-surface { --os-tile-fg-muted: rgba( 0, 0, 0, 0.55 ); }
 *
 * wins for everything inside it, because a declaration on a nearer
 * ancestor beats an inherited one. The palette's value is then dead in
 * that subtree, and so is every desktop theme's — including Legacy.
 *
 * That is not hypothetical: this exact declaration painted the user
 * tiles' secondary line near-black inside My WordPress. On the brand's
 * dark surface it measured 1.11:1 against the background — invisible —
 * while the label directly beside it followed the theme correctly,
 * because IT chained through the palette. Reading the public token into
 * the chain instead restored it to 8.18:1.
 *
 * The fix is always the same shape: keep the pre-brand literal as the
 * final fallback and read the palette on the way to it.
 *
 *     --os-tile-fg-muted: var(
 *         --my-surface-fg-muted,
 *         var( --os-ui-fg-muted, rgba( 0, 0, 0, 0.55 ) )
 *     );
 */
import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CSS_DIR = join( __dirname, '../../assets/css' );

/**
 * Declarations that are deliberately a fixed colour, with the reason.
 *
 * A surface may opt out of a palette VALUE — what it must not do is opt
 * out of REACHABILITY for names it does not own. Anything added here
 * needs the same justification.
 */
const ALLOWED = new Map( [
	[
		'desktop.css:--os-ui-fg',
		'Sticky-note paper is its own surface: a fixed dark-olive ink on note yellow, which must not follow the station palette or the note becomes unreadable.',
	],
	[
		'desktop.css:--os-ui-fg-muted',
		'Same note-paper surface as --os-ui-fg above.',
	],
	[
		'desktop.css:--os-ui-btn-bg-active',
		'Same note-paper surface — the pressed wash is mixed against the note, not the station.',
	],
	[
		'desktop-files.css:--os-tile-hover-bg',
		'Pre-brand hover wash on the folder-window tile canvas. Flagged, not fixed: changing a hover wash is a visual decision, not a bug fix.',
	],
	[
		'desktop-files.css:--os-tile-selected-bg',
		'As above — the selection wash on the same canvas.',
	],
] );

/** Every custom property `variables.css` declares. */
function paletteTokens(): Set< string > {
	const src = readFileSync( join( CSS_DIR, 'variables.css' ), 'utf8' );
	return new Set(
		[ ...src.matchAll( /^\s*(--os-[a-z0-9-]+)\s*:/gm ) ].map( ( m ) => m[ 1 ] ),
	);
}

const isColourLiteral = ( value: string ): boolean =>
	/^\s*(#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|color-mix\()/i.test( value );

describe( 'palette token reachability in feature stylesheets', () => {
	test( 'no stylesheet pins a palette token to a bare colour literal', () => {
		const palette = paletteTokens();
		const offenders: string[] = [];

		for ( const file of readdirSync( CSS_DIR ) ) {
			if ( ! file.endsWith( '.css' ) || file === 'variables.css' ) {
				continue;
			}
			const src = readFileSync( join( CSS_DIR, file ), 'utf8' );
			for ( const m of src.matchAll( /^\s*(--os-[a-z0-9-]+)\s*:\s*([^;]+);/gm ) ) {
				const [ , name, rawValue ] = m;
				const value = rawValue.trim();
				if ( ! palette.has( name ) ) {
					continue;
				}
				// A `var()` anywhere in the value means the palette is
				// still on the resolution path.
				if ( /\bvar\(/.test( value ) || ! isColourLiteral( value ) ) {
					continue;
				}
				const key = `${ file }:${ name }`;
				if ( ALLOWED.has( key ) ) {
					continue;
				}
				offenders.push(
					`${ key } = ${ value }\n` +
						`    ${ name } is declared by variables.css, so this literal makes ` +
						`the palette and every desktop theme unreachable inside that rule.\n` +
						`    Chain through it instead: var( --local-name, var( ${ name }, ${ value } ) )\n` +
						`    — or add the key to ALLOWED in this test with the reason it is deliberate.`,
				);
			}
		}

		expect( offenders.join( '\n\n' ) ).toBe( '' );
	} );

	test( 'the allowlist has no stale entries', () => {
		const palette = paletteTokens();
		const live = new Set< string >();
		for ( const file of readdirSync( CSS_DIR ) ) {
			if ( ! file.endsWith( '.css' ) || file === 'variables.css' ) {
				continue;
			}
			const src = readFileSync( join( CSS_DIR, file ), 'utf8' );
			for ( const m of src.matchAll( /^\s*(--os-[a-z0-9-]+)\s*:\s*([^;]+);/gm ) ) {
				const [ , name, rawValue ] = m;
				const value = rawValue.trim();
				if (
					palette.has( name ) &&
					! /\bvar\(/.test( value ) &&
					isColourLiteral( value )
				) {
					live.add( `${ file }:${ name }` );
				}
			}
		}
		const stale = [ ...ALLOWED.keys() ].filter( ( k ) => ! live.has( k ) );
		expect( stale ).toEqual( [] );
	} );
} );
