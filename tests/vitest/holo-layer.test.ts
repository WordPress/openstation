/**
 * The holographic layer, pinned.
 *
 * Three things here would break quietly, and each has cost time
 * somewhere in this repo before:
 *
 *   1. **The meshes are transcriptions, not inventions.** Every stop
 *      in `--os-mesh-*` came from a brand SVG. A hex typo is invisible
 *      in review and wrong forever, and nobody diffs a nine-layer
 *      gradient by eye.
 *   2. **A `:host` declaration of a public token kills the palette.**
 *      `src/ui/holo.ts` declares eleven aliases on `:host`, which is
 *      exactly the shape the reachability rule bans when the name is
 *      public. Every one of them has to start with `--_`.
 *   3. **Specificity.** `holoField` uses bare element selectors, so it
 *      is one careless `:not()` away from outranking every component's
 *      own error ring. The `:where()` wrapper is what keeps it at
 *      (0,1,1), and losing it turns an invalid field's red focus ring
 *      Pulse — a change no test that renders a valid form would see.
 *
 * Brand reference: https://nuriapenya.github.io/open-station-brand/
 */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	holoTokens,
	holoFill,
	holoSheen,
	holoEdge,
	holoField,
	holoCheck,
	holoDrift,
	holo,
} from '../../src/ui/holo';

const ROOT = resolve( __dirname, '../..' );
const CSS = readFileSync( resolve( ROOT, 'assets/css/variables.css' ), 'utf8' );

/** The value `variables.css` declares for a token, whitespace-flattened. */
function declared( token: string ): string | null {
	const match = new RegExp( `\\n\\t${ token }:\\s*([\\s\\S]*?);\\n` ).exec( CSS );
	return match ? match[ 1 ].replace( /\s+/g, ' ' ).trim() : null;
}

describe( 'the meshes are the brand’s own', () => {
	test( 'Holomesh carries its base linear and all eight glows', () => {
		const holomesh = declared( '--os-mesh-holo' ) ?? '';

		// The base, from holo_base in assets/holomesh.svg.
		expect( holomesh ).toContain( '#afa2e8' );
		expect( holomesh ).toContain( '#b7abea' );
		expect( holomesh ).toContain( '#c3b8ef' );

		// One radial per glow, holo_r0 … holo_r7.
		expect( holomesh.match( /radial-gradient/g ) ?? [] ).toHaveLength( 8 );

		// The glow colours, in the SVG's own order: white, cyan, pink,
		// warm, mint, white, pink, blue. Stated as rgb() because a
		// gradient stop needs an alpha and the hexes do not carry one.
		for ( const rgb of [
			'255, 253, 255', // #fffdff
			'125, 239, 245', // #7deff5
			'245, 159, 232', // #f59fe8
			'248, 242, 182', // #f8f2b6
			'147, 240, 198', // #93f0c6
			'243, 181, 236', // #f3b5ec
			'159, 214, 255', // #9fd6ff
		] ) {
			expect( holomesh ).toContain( rgb );
		}
	} );

	test( 'Pulsemesh, Auromesh, Starmesh and Miomesh are all declared', () => {
		expect( declared( '--os-mesh-pulse' ) ).toContain( '#8d9bf3' );
		expect( declared( '--os-mesh-pulse' ) ).toContain( '#c878f0' );
		expect( declared( '--os-mesh-auro' ) ).toContain( '#cefada' );
		expect( declared( '--os-mesh-star' ) ).toContain( '#fffbff' );
		// Miomesh belongs to the mascot; the sweep runs Pulse → deep blue.
		expect( declared( '--os-mesh-mio' ) ).toContain( '#f252fc' );
		expect( declared( '--os-mesh-mio' ) ).toContain( '#4b3eff' );
	} );

	test( 'the default holographic fill IS Holomesh, and its ink is Void', () => {
		expect( declared( '--os-ui-holo-fill' ) ).toBe( 'var(--os-mesh-holo)' );
		// Not Starlight. Every mesh in the brand is a light surface —
		// Holomesh's darkest stop still sits above 60% luminance — so
		// white glyphs on one are unreadable in a way that looks fine
		// in a screenshot.
		expect( declared( '--os-ui-holo-ink' ) ).toBe( '#0c0b0f' );
	} );

	test( 'the surfaces that took the mesh are the bounded ones', () => {
		// Retinted in the palette rather than in the components, which
		// is what keeps each component's own literal as the pre-brand
		// floor and keeps Legacy able to revert them.
		expect( declared( '--os-ui-progress-fill' ) ).toBe( 'var(--os-mesh-holo)' );
		expect( declared( '--os-ui-step-chip-bg' ) ).toBe( 'var(--os-mesh-holo)' );
	} );
} );

describe( 'the holo fragments keep the palette reachable', () => {
	test( 'every custom property declared on :host is private', () => {
		// The rule from AGENTS.md, applied to the one module that
		// declares eleven properties on a bare :host. A public name
		// here would be unreachable from the palette AND from every
		// desktop theme, silently, forever.
		const declarations =
			holoTokens.cssText.match( /--[a-z0-9_-]+\s*:/g ) ?? [];
		const publicNames = declarations
			.map( ( d ) => d.replace( /\s*:$/, '' ) )
			.filter( ( name ) => ! name.startsWith( '--_' ) );

		expect( publicNames ).toEqual( [] );
		expect( declarations.length ).toBeGreaterThan( 8 );
	} );

	test( 'every alias reads its public token with a literal fallback', () => {
		// The alias is only worth having if it resolves the inherited
		// value; a hardcoded right-hand side would be the blocked
		// declaration with extra steps. Whitespace-flattened because
		// several of these wrap across lines to stay inside the column
		// limit, and a line break inside var() is not a difference.
		const flat = holoTokens.cssText.replace( /\s+/g, ' ' );
		for ( const token of [
			'--os-ui-holo-fill',
			'--os-ui-holo-ink',
			'--os-ui-holo-sheen',
			'--os-ui-holo-edge',
			'--os-ui-holo-edge-quiet',
			'--os-ui-holo-glow',
			'--os-ui-holo-glow-strong',
			'--os-ui-holo-track',
			'--os-ui-focus-ring',
			'--os-ui-focus-ring-field',
			'--os-ui-holo-transition',
		] ) {
			expect( flat ).toContain( `var( ${ token },` );
		}
	} );

	test( 'the public tokens the aliases read are all declared in the palette', () => {
		for ( const token of [
			'--os-ui-holo-fill',
			'--os-ui-holo-ink',
			'--os-ui-holo-sheen',
			'--os-ui-holo-edge',
			'--os-ui-holo-edge-quiet',
			'--os-ui-holo-glow',
			'--os-ui-holo-glow-strong',
			'--os-ui-holo-track',
			'--os-ui-focus-ring',
			'--os-ui-focus-ring-field',
			'--os-ui-holo-transition',
		] ) {
			expect( declared( token ), `${ token } is missing from variables.css` )
				.not.toBeNull();
		}
	} );

	test( 'the palette is on body.os-active, never :root', () => {
		// variables.css is a dependency of chromeless.css, so it loads
		// inside every iframe window — a real wp-admin document. On
		// :root the meshes and the focus ring would reach in and
		// repaint WordPress's own UI.
		const holoBlock = CSS.slice( CSS.indexOf( '--os-mesh-holo' ) );
		expect( CSS ).toContain( 'body.os-active {' );
		expect( holoBlock.slice( 0, holoBlock.indexOf( '}' ) ) ).not.toContain(
			':root',
		);
	} );
} );

describe( 'the shared field chrome cannot outrank a component', () => {
	test( 'the type exclusions are wrapped in :where()', () => {
		// :not() carries its argument's specificity, so the honest
		// spelling weighs (0,3,1) — heavier than
		// input[aria-invalid='true']:focus at (0,2,1). An invalid field
		// would then focus in Pulse instead of red, and no test that
		// renders a valid form would ever notice.
		const bare = holoField.cssText.match(
			/input:not\(\s*\[\s*type='checkbox'/g,
		);
		expect( bare ).toBeNull();
		expect( holoField.cssText ).toContain(
			"input:where( :not( [ type='checkbox' ] ):not( [ type='radio' ] ) )",
		);
	} );

	test( 'checkboxes and radios are excluded from the field ring', () => {
		// They get the target ring from holoCheck instead — a checkbox
		// is a target sitting on an arbitrary background, not a field
		// with its own border to thicken.
		expect( holoCheck.cssText ).toContain( 'var( --_holo-focus )' );
		expect( holoField.cssText ).toContain( 'var( --_holo-focus-field )' );
	} );
} );

describe( 'motion is optional everywhere', () => {
	test.each( [
		[ 'holoFill', holoFill ],
		[ 'holoSheen', holoSheen ],
		[ 'holoEdge', holoEdge ],
		[ 'holoField', holoField ],
		[ 'holoCheck', holoCheck ],
		[ 'holoDrift', holoDrift ],
	] )( '%s honours prefers-reduced-motion', ( _name, fragment ) => {
		expect( fragment.cssText ).toContain( 'prefers-reduced-motion' );
	} );

	test( 'reduced motion stops the tilt without removing the fill', () => {
		// A control that lost its mesh under reduced motion would lose
		// its STATE, not just its animation — an "on" switch would go
		// back to looking off.
		const reduced = holoFill.cssText.slice(
			holoFill.cssText.indexOf( 'prefers-reduced-motion' ),
		);
		expect( reduced ).toContain( 'background-position: 22% 28%' );
		expect( reduced ).not.toContain( 'background-image: none' );
	} );
} );

describe( 'the barrel', () => {
	test( 'holo bundles every fragment', () => {
		for ( const fragment of [
			holoTokens,
			holoFill,
			holoSheen,
			holoEdge,
			holoField,
			holoCheck,
			holoDrift,
		] ) {
			// Compare on a distinctive slice rather than the whole text:
			// the barrel interpolates each fragment verbatim, so any
			// non-trivial run of it must survive.
			const probe = fragment.cssText.trim().slice( 0, 60 );
			expect( holo.cssText ).toContain( probe );
		}
	} );
} );
