/**
 * Dock glyph + focused title-bar control tokens.
 *
 * Two clusters of shell chrome painted themselves white with no name
 * a desktop theme could aim at: the dock glyphs (rest, hover, hover
 * wash, focus ring) and the focused window controls (the `--os-ui-btn-*`
 * bridge plus the screen-meta buttons beside it). Both sit on a
 * surface a theme CAN repaint — `--os-dock-bg`,
 * `--os-titlebar-bg-focused` — so a pale choice there left
 * the marks on top invisible.
 *
 * Three things have to stay true for the new tokens to be worth
 * having:
 *
 *   1. Every site reads its token FIRST, with the exact literal it
 *      used before as the fallback.
 *   2. No token is declared anywhere, so an unthemed shell resolves
 *      to precisely what it always did.
 *   3. `dock-peek.css` re-states the dock hover rule and wins on
 *      specificity — it must read the same two tokens, or a theme's
 *      colour vanishes the moment that sheet loads.
 *
 * Asserted against stylesheet text: these rules live in plain CSS
 * with no module to import, and jsdom will not resolve a nested
 * `var()` chain against undeclared properties, so a computed-style
 * assertion would prove nothing.
 */
import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CSS_DIR = resolve( __dirname, '../../assets/css' );

function readCss( file: string ): string {
	return readFileSync( resolve( CSS_DIR, file ), 'utf8' );
}

/** Collapse whitespace so multi-line `var()` chains compare cleanly. */
function flat( text: string ): string {
	return text.replace( /\s+/g, ' ' );
}

/**
 * Body of the rule whose head ends with `selector` and whose
 * declarations mention `marker`.
 *
 * The marker disambiguates: `.os-window--focused` heads two
 * separate rules in window-chrome.css (the frame, then the button
 * colour bridge), and a plain "first match" helper would read the
 * wrong one.
 */
function ruleBody( css: string, selector: string, marker: string ): string {
	const head = selector + ' {';
	let at = css.indexOf( head );

	while ( at > -1 ) {
		const open = css.indexOf( '{', at );
		const close = css.indexOf( '}', open );
		const body = flat( css.slice( open + 1, close ) );

		if ( body.includes( marker ) ) {
			return body;
		}

		at = css.indexOf( head, close );
	}

	throw new Error( `No rule "${ selector }" containing "${ marker }"` );
}

/* Every literal below is the value that site painted before the token
 * existed. Changing one is a default drift, and that is the point of
 * spelling them out here rather than reading them back off the file. */
const GLYPH_REST = 'rgba( 255, 255, 255, 0.7 )';
const GLYPH_HOVER = 'var( --os-ui-fg-on-accent, #fff )';
const TILE_WASH = 'rgba( 255, 255, 255, 0.15 )';

describe( 'dock glyph tokens', () => {
	test( 'the tile glyph reads --os-dock-icon-color at rest', () => {
		const body = ruleBody(
			readCss( 'dock.css' ),
			'.os-dock__item-primary',
			'--os-dock-icon-color'
		);

		expect( body ).toContain(
			`color: var( --os-dock-icon-color, ${ GLYPH_REST } );`
		);
	} );

	test( 'hover reads the glyph-hover and tile-wash tokens', () => {
		const body = ruleBody(
			readCss( 'dock.css' ),
			'.os-dock__item-primary:hover',
			'--os-dock-icon-color-hover'
		);

		expect( body ).toContain(
			`background-color: var( --os-dock-item-bg-hover, ${ TILE_WASH } );`
		);
		expect( body ).toContain(
			`color: var( --os-dock-icon-color-hover, ${ GLYPH_HOVER } );`
		);
	} );

	test( 'the focus ring reads --os-dock-item-outline', () => {
		const body = ruleBody(
			readCss( 'dock.css' ),
			'.os-dock__item-primary:focus-visible',
			'--os-dock-item-outline'
		);

		expect( body ).toContain(
			`outline: 2px solid var( --os-dock-item-outline, ${ GLYPH_REST } );`
		);
	} );

	test( 'the active-tile indicator family reads --os-dock-item-outline on all three placements', () => {
		// The status dot / pill under the running and focused tile,
		// plus the hollow ring under a tile whose windows are all
		// minimized, were painted from `--os-ui-surface` and a
		// hardcoded white — the dot resolved to the dock's own dark
		// glass once the brand palette declared it, and the ring
		// stayed unreachable by themes. Both now share the
		// focus-ring token, so the accent paints them on the station
		// and a theme's ring colour paints them everywhere else.
		const css = readCss( 'dock.css' );

		expect(
			css.match(
				/background: var\( --os-dock-item-outline, #fff \);/g
			)
		).toHaveLength( 3 );
		expect(
			css.match(
				/border: 1px solid var\( --os-dock-item-outline, rgba\( 255, 255, 255, 0\.85 \) \);/g
			)
		).toHaveLength( 3 );
	} );

	test( 'system tiles follow the same token, keeping their brighter literal', () => {
		const body = ruleBody(
			readCss( 'dock.css' ),
			'.os-dock__item--system .os-dock__item-primary',
			'--os-dock-icon-color'
		);

		// Same token as a menu tile — one colour covers the dock — but
		// the 0.8 fallback preserves the unthemed prominence notch.
		expect( body ).toContain(
			'color: var( --os-dock-icon-color, rgba( 255, 255, 255, 0.8 ) );'
		);
	} );

	test( 'dock-peek re-states hover with the same two tokens', () => {
		// This sheet is enqueued separately and outranks the base
		// hover rule. Without the tokens here, a themed dock reverts
		// to white glyphs on first hover.
		const body = ruleBody(
			readCss( 'dock-peek.css' ),
			'.os-dock__item[data-peek-active] .os-dock__item-primary',
			'--os-dock-icon-color-hover'
		);

		// `background-color`, not the `background` shorthand: the
		// shorthand also reset `background-image`, erasing a theme's
		// DOCK_ITEM tile texture from under the cursor.
		expect( body ).toContain(
			`background-color: var( --os-dock-item-bg-hover, ${ TILE_WASH } );`
		);
		expect( body ).not.toContain( 'background: ' );
		expect( body ).toContain(
			`color: var( --os-dock-icon-color-hover, ${ GLYPH_HOVER } );`
		);
	} );
} );

describe( 'focused title-bar control tokens', () => {
	test( 'the --os-ui-btn-* bridge reads the focused tokens', () => {
		const body = ruleBody(
			readCss( 'window-chrome.css' ),
			'.os-window--focused',
			'--os-ui-btn-color:'
		);

		expect( body ).toContain(
			`--os-ui-btn-color: var( --os-titlebar-btn-focused-color, ${ GLYPH_REST } );`
		);
		expect( body ).toContain(
			'--os-ui-btn-color-hover: var( --os-titlebar-btn-focused-color-hover, #fff );'
		);
		expect( body ).toContain(
			'--os-ui-btn-bg-hover: var( --os-titlebar-btn-focused-bg-hover, rgba( 255, 255, 255, 0.18 ) );'
		);
		expect( body ).toContain(
			'--os-ui-btn-bg-active: var( --os-titlebar-btn-focused-bg-active, rgba( 255, 255, 255, 0.25 ) );'
		);
		expect( body ).toContain(
			'--os-ui-btn-outline: var( --os-titlebar-btn-focused-outline, rgba( 255, 255, 255, 0.65 ) );'
		);
	} );

	test( 'close-button red stays semantic, in both focus states', () => {
		const css = readCss( 'window-chrome.css' );

		// Deliberately NOT a `-focused-` token: destructive red is
		// signal, not chrome. Both halves resolve it the same way.
		expect(
			css.match( /--os-ui-btn-danger-hover: var\( --os-ui-danger, #d63638 \);/g )
		).toHaveLength( 2 );
	} );

	test( 'every focused token mirrors an unfocused counterpart', () => {
		const css = readCss( 'window-chrome.css' );

		for ( const suffix of [
			'color',
			'color-hover',
			'bg-hover',
			'bg-active',
		] ) {
			expect(
				css.includes( `--os-titlebar-btn-${ suffix },` ),
				`unfocused --os-titlebar-btn-${ suffix } is unread`
			).toBe( true );
			expect(
				css.includes( `--os-titlebar-btn-focused-${ suffix },` ),
				`focused --os-titlebar-btn-focused-${ suffix } is unread`
			).toBe( true );
		}
	} );

	test.each( [
		[ 'rest', '.os-window--focused .os-window__meta-btn', '--os-titlebar-btn-focused-color,' ],
		[ 'hover', '.os-window--focused .os-window__meta-btn:hover', '--os-titlebar-btn-focused-bg-hover' ],
		[ 'focus ring', '.os-window--focused .os-window__meta-btn:focus-visible', '--os-titlebar-btn-focused-outline' ],
		[ 'active', '.os-window--focused .os-window__meta-btn--active', '--os-titlebar-btn-focused-bg-active' ],
	] )(
		'screen-meta buttons take the same tokens (%s)',
		( _label, selector, token ) => {
			// They are plain light-DOM buttons, so they paint
			// themselves instead of reading the `--os-ui-btn-*` bridge —
			// but they sit in the same bar, so they answer to the same
			// names. Otherwise one cluster goes legible and the other
			// stays white.
			const body = ruleBody(
				readCss( 'window-chrome.css' ),
				selector,
				token
			);

			expect( body ).toContain( token );
		}
	);
} );

describe( 'one palette owns them', () => {
	const TOKENS = [
		'--os-dock-icon-color',
		'--os-dock-icon-color-hover',
		'--os-dock-item-bg-hover',
		'--os-dock-item-outline',
		'--os-titlebar-btn-focused-color',
		'--os-titlebar-btn-focused-color-hover',
		'--os-titlebar-btn-focused-bg-hover',
		'--os-titlebar-btn-focused-bg-active',
		'--os-titlebar-btn-focused-outline',
	];

	test( 'only variables.css declares them', () => {
		// A declaration is `--name:`; a read is `var( --name,`. The
		// brand palette declares these once, in variables.css; a
		// second declaration in a consuming sheet would pin that one
		// surface and put it out of reach of the palette and of every
		// desktop theme (including Legacy, the way back to the
		// pre-brand look).
		const sheets = readdirSync( CSS_DIR ).filter(
			( f ) => f.endsWith( '.css' ) && f !== 'variables.css'
		);

		for ( const sheet of sheets ) {
			const css = readCss( sheet );

			for ( const token of TOKENS ) {
				expect(
					new RegExp( `${ token }\\s*:` ).test( css ),
					`${ sheet } declares ${ token }`
				).toBe( false );
			}
		}
	} );

	test( 'variables.css declares every one of them', () => {
		const css = readCss( 'variables.css' );

		for ( const token of TOKENS ) {
			expect(
				new RegExp( `\\n\\t${ token }:` ).test( css ),
				`${ token } is not declared in the palette`
			).toBe( true );
		}
	} );

	test( 'variables.css documents every one of them', () => {
		const css = readCss( 'variables.css' );

		for ( const token of TOKENS ) {
			expect( css, `${ token } is undocumented` ).toContain( token );
		}
	} );
} );
