import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	holoTokens,
	holoFill,
	holoSheen,
	holoEdge,
	holoGlint,
	holoRing,
	holoShimmer,
	holoEnter,
	holoField,
	holoCheck,
	holoDrift,
	holo,
} from '../../src/ui/holo';

const ROOT = resolve( __dirname, '../..' );
const CSS = readFileSync( resolve( ROOT, 'assets/css/variables.css' ), 'utf8' );

function declared( token: string ): string | null {
	const match = new RegExp( `\\n\\t${ token }:\\s*([\\s\\S]*?);\\n` ).exec( CSS );
	return match ? match[ 1 ].replace( /\s+/g, ' ' ).trim() : null;
}

describe( 'the meshes are the brand’s own', () => {
	test( 'Holomesh carries its base linear and all eight glows', () => {
		const holomesh = declared( '--os-mesh-holo' ) ?? '';

		expect( holomesh ).toContain( '#afa2e8' );
		expect( holomesh ).toContain( '#b7abea' );
		expect( holomesh ).toContain( '#c3b8ef' );

		expect( holomesh.match( /radial-gradient/g ) ?? [] ).toHaveLength( 8 );

		for ( const rgb of [
			'255, 253, 255',
			'125, 239, 245',
			'245, 159, 232',
			'248, 242, 182',
			'147, 240, 198',
			'243, 181, 236',
			'159, 214, 255',
		] ) {
			expect( holomesh ).toContain( rgb );
		}
	} );

	test( 'Pulsemesh, Auromesh, Starmesh and Miomesh are all declared', () => {
		expect( declared( '--os-mesh-pulse' ) ).toContain( '#8d9bf3' );
		expect( declared( '--os-mesh-pulse' ) ).toContain( '#c878f0' );
		expect( declared( '--os-mesh-auro' ) ).toContain( '#cefada' );
		expect( declared( '--os-mesh-star' ) ).toContain( '#fffbff' );

		expect( declared( '--os-mesh-mio' ) ).toContain( '#f252fc' );
		expect( declared( '--os-mesh-mio' ) ).toContain( '#4b3eff' );
	} );

	test( 'the default holographic fill IS Holomesh, and its ink is Void', () => {
		expect( declared( '--os-ui-holo-fill' ) ).toBe( 'var(--os-mesh-holo)' );

		expect( declared( '--os-ui-holo-ink' ) ).toBe( '#0c0b0f' );
	} );

	test( 'the surfaces that took the mesh are the bounded ones', () => {

		expect( declared( '--os-ui-progress-fill' ) ).toBe( 'var(--os-mesh-holo)' );
		expect( declared( '--os-ui-step-chip-bg' ) ).toBe( 'var(--os-mesh-holo)' );
	} );
} );

describe( 'the holo fragments keep the palette reachable', () => {
	test( 'every custom property declared on :host is private', () => {

		const declarations =
			holoTokens.cssText.match( /--[a-z0-9_-]+\s*:/g ) ?? [];
		const publicNames = declarations
			.map( ( d ) => d.replace( /\s*:$/, '' ) )
			.filter( ( name ) => ! name.startsWith( '--_' ) );

		expect( publicNames ).toEqual( [] );
		expect( declarations.length ).toBeGreaterThan( 8 );
	} );

	test( 'every alias reads its public token with a literal fallback', () => {

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
			'--os-ui-accent-dim',
			'--os-ui-focus-ring',
			'--os-ui-focus-ring-field',
			'--os-ui-holo-transition',
			'--os-ui-motion-fast',
			'--os-ui-motion-slow',
			'--os-ui-motion-ambient',
			'--os-ui-ease-spring',
			'--os-ui-ease-out',
			'--os-ui-ease-loop',
		] ) {
			expect( declared( token ), `${ token } is missing from variables.css` )
				.not.toBeNull();
		}
	} );

	test( 'the palette is on body.os-active, never :root', () => {

		const holoBlock = CSS.slice( CSS.indexOf( '--os-mesh-holo' ) );
		expect( CSS ).toContain( 'body.os-active {' );
		expect( holoBlock.slice( 0, holoBlock.indexOf( '}' ) ) ).not.toContain(
			':root',
		);
	} );
} );

describe( 'the shared field chrome cannot outrank a component', () => {
	test( 'the type exclusions are wrapped in :where()', () => {

		const bare = holoField.cssText.match(
			/input:not\(\s*\[\s*type='checkbox'/g,
		);
		expect( bare ).toBeNull();
		expect( holoField.cssText ).toContain(
			"input:where( :not( [ type='checkbox' ] ):not( [ type='radio' ] ) )",
		);
	} );

	test( 'checkboxes and radios are excluded from the field ring', () => {

		expect( holoCheck.cssText ).toContain( 'var( --_holo-focus )' );
		expect( holoField.cssText ).toContain( 'var( --_holo-focus-field )' );
	} );
} );

describe( 'Pulse is spent where it is stated, not where it is spread', () => {
	test( 'the identity colour is untouched and the dim is its neighbour', () => {

		expect( declared( '--os-ui-accent' ) ).toBe( '#f252fc' );
		expect( declared( '--os-ui-accent-dim' ) ).toBe( '#d92ee3' );
	} );

	test( 'every ambient use of Pulse resolves through the dim', () => {

		for ( const token of [
			'--os-ui-accent-soft',
			'--os-ui-holo-glow',
			'--os-ui-holo-glow-strong',
			'--os-ui-focus-ring-field',
		] ) {
			expect( declared( token ), token ).toContain( '--os-ui-accent-dim' );
		}
	} );

	test( 'the focus RING itself stays at full strength, with no bloom', () => {

		const ring = declared( '--os-ui-focus-ring' ) ?? '';
		expect( ring ).toContain( '0 0 0 4px var(--os-ui-accent, #f252fc)' );
		expect( ring ).not.toContain( '--os-ui-accent-dim' );
	} );
} );

describe( 'the unlit half is visible, and the selection is legible', () => {
	test( 'the off-state track is a LIFTED wash, not a sunken well', () => {

		const track = declared( '--os-ui-holo-track' ) ?? '';
		expect( track ).toContain( '255, 251, 255' );
		expect( track ).not.toContain( '12, 11, 15' );
	} );

	test( 'the track carries a 3:1 boundary of its own', () => {

		expect( declared( '--os-ui-holo-track-edge' ) ).toBe( '#66636b' );
		expect( holoTokens.cssText.replace( /\s+/g, ' ' ) ).toContain(
			'var( --os-ui-holo-track-edge,'
		);
	} );

	test( 'the selection sets BOTH halves, and keeps the text its own colour', () => {

		expect( declared( '--os-ui-selection-bg' ) ).toBe(
			'rgba(159, 152, 255, 0.6)'
		);

		expect( declared( '--os-ui-selection-fg' ) ).toBe( '#fffbff' );
	} );

	test( 'the selection reaches the shell AND every shadow root', () => {

		const shell = readFileSync(
			resolve( ROOT, 'assets/css/desktop.css' ),
			'utf8'
		);
		expect( shell ).toContain( 'body.os-active ::selection' );

		expect( shell ).toContain( 'body.os-active ::-moz-selection' );
		expect( shell ).toContain( '--os-ui-selection-bg' );
		expect( holoField.cssText ).toContain( '--os-ui-selection-bg' );
		expect( holoField.cssText ).toContain( '--os-ui-selection-fg' );
	} );

	test( 'the shell selection rule does NOT reach inside iframe windows', () => {

		const chromeless = readFileSync(
			resolve( ROOT, 'assets/css/chromeless.css' ),
			'utf8'
		);
		expect( chromeless ).not.toContain( '::selection' );
	} );
} );

describe( 'motion is optional everywhere', () => {
	test.each( [
		[ 'holoFill', holoFill ],
		[ 'holoSheen', holoSheen ],
		[ 'holoEdge', holoEdge ],
		[ 'holoGlint', holoGlint ],
		[ 'holoRing', holoRing ],
		[ 'holoShimmer', holoShimmer ],
		[ 'holoEnter', holoEnter ],
		[ 'holoField', holoField ],
		[ 'holoCheck', holoCheck ],
		[ 'holoDrift', holoDrift ],
	] )( '%s honours prefers-reduced-motion', ( _name, fragment ) => {
		expect( fragment.cssText ).toContain( 'prefers-reduced-motion' );
	} );

	test( 'every duration and curve comes from the shared scale', () => {

		for ( const fragment of [ holoGlint, holoRing, holoEnter ] ) {
			expect( fragment.cssText ).toMatch( /var\( --_holo-t/ );
			expect( fragment.cssText ).toMatch(
				/var\( --_holo-(ease|spring|loop) \)/
			);
		}
	} );

	test( 'the two motion fragments are element-based, not pseudo-based', () => {

		expect( holoGlint.cssText ).toContain( '.os-holo-glint {' );
		expect( holoRing.cssText ).toContain( '.os-holo-ring {' );
	} );

	test( 'both motions are driven by the CHILD combinator', () => {

		expect( holoRing.cssText ).toContain( '> .os-holo-ring' );
		expect( holoRing.cssText ).not.toMatch( /:active[^>{]*\s\.os-holo-ring/ );
		expect( holoGlint.cssText ).toContain( '> .os-holo-glint' );
	} );

	test( 'reduced motion stops the tilt without removing the fill', () => {

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
			holoGlint,
			holoRing,
			holoShimmer,
			holoEnter,
			holoField,
			holoCheck,
			holoDrift,
		] ) {

			const probe = fragment.cssText.trim().slice( 0, 60 );
			expect( holo.cssText ).toContain( probe );
		}
	} );
} );

describe( 'a mesh is reached through the kit’s name, never directly', () => {

	const sheets = readdirSync( resolve( ROOT, 'assets/css' ) ).filter(
		( name ) => name.endsWith( '.css' ) && 'variables.css' !== name
	);

	test.each( sheets )( '%s reads no --os-mesh-* directly', ( name ) => {
		const text = readFileSync(
			resolve( ROOT, 'assets/css', name ),
			'utf8'
		);
		expect( text ).not.toMatch( /var\(\s*--os-mesh-/ );
	} );

	test( 'Legacy suppresses the meshes but still answers the fill', () => {

		const legacy = JSON.parse(
			readFileSync(
				resolve( ROOT, 'assets/desktop-themes/legacy/theme.json' ),
				'utf8'
			)
		) as { tokens: Record< string, string > };

		for ( const token of Object.keys( legacy.tokens ) ) {
			if ( token.startsWith( '--os-mesh-' ) ) {
				expect( legacy.tokens[ token ] ).toBe( 'none' );
			}
		}
		expect( legacy.tokens[ '--os-ui-holo-fill' ] ).toMatch(
			/^linear-gradient\(/
		);

		expect( legacy.tokens[ '--os-ui-hero-mesh' ] ).toMatch(
			/^linear-gradient\(/
		);
		expect( legacy.tokens[ '--os-ui-hero-mesh' ] ).not.toBe(
			legacy.tokens[ '--os-ui-holo-fill' ]
		);
		expect( CSS ).toContain( '--os-ui-hero-mesh:' );
	} );
} );
