/**
 * Dock glyph + focused title-bar control tokens.
 *
 * Two clusters of shell chrome painted themselves white with no name
 * a desktop theme could aim at: the dock glyphs (rest, hover, hover
 * wash, focus ring) and the focused window controls (the `--wpd-btn-*`
 * bridge plus the screen-meta buttons beside it). Both sit on a
 * surface a theme CAN repaint — `--desktop-mode-dock-bg`,
 * `--desktop-mode-titlebar-bg-focused` — so a pale choice there left
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
 * The marker disambiguates: `.desktop-mode-window--focused` heads two
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
const GLYPH_HOVER = 'var( --wpd-fg-on-accent, #fff )';
const TILE_WASH = 'rgba( 255, 255, 255, 0.15 )';

describe( 'dock glyph tokens', () => {
	test( 'the tile glyph reads --desktop-mode-dock-icon-color at rest', () => {
		const body = ruleBody(
			readCss( 'dock.css' ),
			'.desktop-mode-dock__item-primary',
			'--desktop-mode-dock-icon-color'
		);

		expect( body ).toContain(
			`color: var( --desktop-mode-dock-icon-color, ${ GLYPH_REST } );`
		);
	} );

	test( 'hover reads the glyph-hover and tile-wash tokens', () => {
		const body = ruleBody(
			readCss( 'dock.css' ),
			'.desktop-mode-dock__item-primary:hover',
			'--desktop-mode-dock-icon-color-hover'
		);

		expect( body ).toContain(
			`background-color: var( --desktop-mode-dock-item-bg-hover, ${ TILE_WASH } );`
		);
		expect( body ).toContain(
			`color: var( --desktop-mode-dock-icon-color-hover, ${ GLYPH_HOVER } );`
		);
	} );

	test( 'the focus ring reads --desktop-mode-dock-item-outline', () => {
		const body = ruleBody(
			readCss( 'dock.css' ),
			'.desktop-mode-dock__item-primary:focus-visible',
			'--desktop-mode-dock-item-outline'
		);

		expect( body ).toContain(
			`outline: 2px solid var( --desktop-mode-dock-item-outline, ${ GLYPH_REST } );`
		);
	} );

	test( 'system tiles follow the same token, keeping their brighter literal', () => {
		const body = ruleBody(
			readCss( 'dock.css' ),
			'.desktop-mode-dock__item--system .desktop-mode-dock__item-primary',
			'--desktop-mode-dock-icon-color'
		);

		// Same token as a menu tile — one colour covers the dock — but
		// the 0.8 fallback preserves the unthemed prominence notch.
		expect( body ).toContain(
			'color: var( --desktop-mode-dock-icon-color, rgba( 255, 255, 255, 0.8 ) );'
		);
	} );

	test( 'dock-peek re-states hover with the same two tokens', () => {
		// This sheet is enqueued separately and outranks the base
		// hover rule. Without the tokens here, a themed dock reverts
		// to white glyphs on first hover.
		const body = ruleBody(
			readCss( 'dock-peek.css' ),
			'.desktop-mode-dock__item[data-peek-active] .desktop-mode-dock__item-primary',
			'--desktop-mode-dock-icon-color-hover'
		);

		// `background-color`, not the `background` shorthand: the
		// shorthand also reset `background-image`, erasing a theme's
		// DOCK_ITEM tile texture from under the cursor.
		expect( body ).toContain(
			`background-color: var( --desktop-mode-dock-item-bg-hover, ${ TILE_WASH } );`
		);
		expect( body ).not.toContain( 'background: ' );
		expect( body ).toContain(
			`color: var( --desktop-mode-dock-icon-color-hover, ${ GLYPH_HOVER } );`
		);
	} );
} );

describe( 'focused title-bar control tokens', () => {
	test( 'the --wpd-btn-* bridge reads the focused tokens', () => {
		const body = ruleBody(
			readCss( 'window-chrome.css' ),
			'.desktop-mode-window--focused',
			'--wpd-btn-color:'
		);

		expect( body ).toContain(
			`--wpd-btn-color: var( --desktop-mode-titlebar-btn-focused-color, ${ GLYPH_REST } );`
		);
		expect( body ).toContain(
			'--wpd-btn-color-hover: var( --desktop-mode-titlebar-btn-focused-color-hover, #fff );'
		);
		expect( body ).toContain(
			'--wpd-btn-bg-hover: var( --desktop-mode-titlebar-btn-focused-bg-hover, rgba( 255, 255, 255, 0.18 ) );'
		);
		expect( body ).toContain(
			'--wpd-btn-bg-active: var( --desktop-mode-titlebar-btn-focused-bg-active, rgba( 255, 255, 255, 0.25 ) );'
		);
		expect( body ).toContain(
			'--wpd-btn-outline: var( --desktop-mode-titlebar-btn-focused-outline, rgba( 255, 255, 255, 0.65 ) );'
		);
	} );

	test( 'close-button red stays semantic, in both focus states', () => {
		const css = readCss( 'window-chrome.css' );

		// Deliberately NOT a `-focused-` token: destructive red is
		// signal, not chrome. Both halves resolve it the same way.
		expect(
			css.match( /--wpd-btn-danger-hover: var\( --wpd-danger, #d63638 \);/g )
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
				css.includes( `--desktop-mode-titlebar-btn-${ suffix },` ),
				`unfocused --desktop-mode-titlebar-btn-${ suffix } is unread`
			).toBe( true );
			expect(
				css.includes( `--desktop-mode-titlebar-btn-focused-${ suffix },` ),
				`focused --desktop-mode-titlebar-btn-focused-${ suffix } is unread`
			).toBe( true );
		}
	} );

	test.each( [
		[ 'rest', '.desktop-mode-window--focused .desktop-mode-window__meta-btn', '--desktop-mode-titlebar-btn-focused-color,' ],
		[ 'hover', '.desktop-mode-window--focused .desktop-mode-window__meta-btn:hover', '--desktop-mode-titlebar-btn-focused-bg-hover' ],
		[ 'focus ring', '.desktop-mode-window--focused .desktop-mode-window__meta-btn:focus-visible', '--desktop-mode-titlebar-btn-focused-outline' ],
		[ 'active', '.desktop-mode-window--focused .desktop-mode-window__meta-btn--active', '--desktop-mode-titlebar-btn-focused-bg-active' ],
	] )(
		'screen-meta buttons take the same tokens (%s)',
		( _label, selector, token ) => {
			// They are plain light-DOM buttons, so they paint
			// themselves instead of reading the `--wpd-btn-*` bridge —
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

describe( 'no default drift', () => {
	const TOKENS = [
		'--desktop-mode-dock-icon-color',
		'--desktop-mode-dock-icon-color-hover',
		'--desktop-mode-dock-item-bg-hover',
		'--desktop-mode-dock-item-outline',
		'--desktop-mode-titlebar-btn-focused-color',
		'--desktop-mode-titlebar-btn-focused-color-hover',
		'--desktop-mode-titlebar-btn-focused-bg-hover',
		'--desktop-mode-titlebar-btn-focused-bg-active',
		'--desktop-mode-titlebar-btn-focused-outline',
	];

	test( 'none of the tokens is declared in any shell stylesheet', () => {
		// A declaration is `--name:`; a read is `var( --name,`. Only
		// the former would pin a value and defeat the fallbacks above.
		const sheets = readdirSync( CSS_DIR ).filter( ( f ) =>
			f.endsWith( '.css' )
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

	test( 'variables.css documents every one of them', () => {
		const css = readCss( 'variables.css' );

		for ( const token of TOKENS ) {
			expect( css, `${ token } is undocumented` ).toContain( token );
		}
	} );
} );
