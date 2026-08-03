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

describe( 'Pulse is spent where it is stated, not where it is spread', () => {
	test( 'the identity colour is untouched and the dim is its neighbour', () => {
		// The designer's note was about how loud the station reads, and
		// the answer is not to move Pulse — #f252fc is the brand's, it
		// is what the guidelines name, and at 6.2:1 on Obsidian it is
		// not a contrast problem. What comes down is everything AMBIENT
		// derived from it.
		expect( declared( '--os-ui-accent' ) ).toBe( '#f252fc' );
		expect( declared( '--os-ui-accent-dim' ) ).toBe( '#d92ee3' );
	} );

	test( 'every ambient use of Pulse resolves through the dim', () => {
		// One knob. If a glow, a wash or a bloom stops reading through
		// --os-ui-accent-dim, turning the station down stops being one
		// edit and starts being an audit.
		for ( const token of [
			'--os-ui-accent-soft',
			'--os-ui-holo-glow',
			'--os-ui-holo-glow-strong',
			'--os-ui-focus-ring-field',
		] ) {
			expect( declared( token ), token ).toContain( '--os-ui-accent-dim' );
		}
	} );

	test( 'the focus RING itself stays full Pulse', () => {
		// Only the bloom behind it dims. A focus indicator is the last
		// place to trade legibility for calm — it is the one thing on
		// screen saying where the keyboard is.
		const ring = declared( '--os-ui-focus-ring' ) ?? '';
		expect( ring ).toContain( '0 0 0 4px #f252fc' );
		expect( ring ).toContain( '--os-ui-accent-dim' );
	} );
} );

describe( 'the unlit half is visible, and the selection is legible', () => {
	test( 'the off-state track is a LIFTED wash, not a sunken well', () => {
		// It used to be rgba( 12, 11, 15, 0.55 ), which composites to
		// #121017 on an Obsidian panel: 1.07:1. An off switch was, to a
		// good approximation, not drawn. On a dark UI the visible thing
		// is the lighter one — which is what every dark OS does with
		// its switches, for this reason.
		const track = declared( '--os-ui-holo-track' ) ?? '';
		expect( track ).toContain( '255, 251, 255' );
		expect( track ).not.toContain( '12, 11, 15' );
	} );

	test( 'the track carries a 3:1 boundary of its own', () => {
		// Pewter. The first step on the Shade ramp that reaches 3.00:1
		// against Obsidian — Silver manages 2.03 and Astro 1.37 — which
		// is what WCAG 1.4.11 asks of a control boundary. The fill
		// alone is ~1.6:1 and is a look, not a boundary.
		expect( declared( '--os-ui-holo-track-edge' ) ).toBe( '#66636b' );
		expect( holoTokens.cssText.replace( /\s+/g, ' ' ) ).toContain(
			'var( --os-ui-holo-track-edge,'
		);
	} );

	test( 'the selection sets BOTH halves, and keeps the text its own colour', () => {
		// Setting only `background` is the common half-fix: the UA then
		// keeps its own selected-text colour, which is often forced to
		// black and lands on this violet at ~2:1.
		expect( declared( '--os-ui-selection-bg' ) ).toBe(
			'rgba(159, 152, 255, 0.6)'
		);
		// Starlight — the colour body text already is. A selection that
		// RECOLOURS text destroys every distinction the text carried:
		// syntax highlighting, a red error, a muted timestamp.
		expect( declared( '--os-ui-selection-fg' ) ).toBe( '#fffbff' );
	} );

	test( 'the selection reaches the shell AND every shadow root', () => {
		// A shadow root does not inherit the document's ::selection
		// rule, so the shell-wide one in desktop.css cannot reach into
		// a component. Both have to exist, and both have to read the
		// same tokens or they drift.
		const shell = readFileSync(
			resolve( ROOT, 'assets/css/desktop.css' ),
			'utf8'
		);
		expect( shell ).toContain( 'body.os-active ::selection' );
		// Prefixed Firefox spelling as its OWN rule: an unrecognised
		// pseudo-element invalidates the whole selector list, so
		// pairing them would leave Chrome unstyled too.
		expect( shell ).toContain( 'body.os-active ::-moz-selection' );
		expect( shell ).toContain( '--os-ui-selection-bg' );
		expect( holoField.cssText ).toContain( '--os-ui-selection-bg' );
		expect( holoField.cssText ).toContain( '--os-ui-selection-fg' );
	} );

	test( 'the shell selection rule does NOT reach inside iframe windows', () => {
		// variables.css is a dependency of chromeless.css and so loads
		// in every iframe; desktop.css is not. A wp-admin page in a
		// window keeps the selection it has outside one — the same
		// promise the palette makes about everything else.
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
		// A panel where the switch settles in 220ms, the segmented
		// thumb in 300 and the tab underline in 150 does not read as
		// three well-tuned controls. It reads as one surface that
		// cannot keep time.
		for ( const fragment of [ holoGlint, holoRing, holoEnter ] ) {
			expect( fragment.cssText ).toMatch( /var\( --_holo-t/ );
			expect( fragment.cssText ).toMatch(
				/var\( --_holo-(ease|spring|loop) \)/
			);
		}
	} );

	test( 'the two motion fragments are element-based, not pseudo-based', () => {
		// The sheen owns ::before and the edge owns ::after, so a
		// control wearing both has spent its whole pseudo-element
		// budget. Glint and ring are stamped as spans for that reason;
		// moving either onto a pseudo would silently disable one of
		// the other two on <os-button>.
		expect( holoGlint.cssText ).toContain( '.os-holo-glint {' );
		expect( holoRing.cssText ).toContain( '.os-holo-ring {' );
	} );

	test( 'both motions are driven by the CHILD combinator', () => {
		// `:active` matches the activated element AND every ancestor of
		// it, so a descendant selector here would fire every ring on
		// the page the moment anything inside the panel was pressed.
		expect( holoRing.cssText ).toContain( '> .os-holo-ring' );
		expect( holoRing.cssText ).not.toMatch( /:active[^>{]*\s\.os-holo-ring/ );
		expect( holoGlint.cssText ).toContain( '> .os-holo-glint' );
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
			holoGlint,
			holoRing,
			holoShimmer,
			holoEnter,
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
