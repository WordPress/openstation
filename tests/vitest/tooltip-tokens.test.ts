/**
 * Tooltip theming tokens.
 *
 * Every tooltip in the shell used to borrow its two colours from
 * unrelated token families — `--os-ui-scrim` (an overlay BACKDROP) or
 * `--os-ui-surface-elevated` for the surface, `--os-ui-fg-on-accent` for
 * the text. Those pairings hold for the default look and come apart
 * under a custom desktop theme, and a theme author had no name to aim
 * at that would fix the tooltip without also moving the modal
 * backdrop or the text on accent-filled buttons.
 *
 * `--os-tooltip-bg` / `--os-tooltip-fg` are that
 * name. Two things have to stay true for them to be worth having:
 *
 *   1. Every tooltip surface reads the dedicated token FIRST, with
 *      its old chain as the fallback.
 *   2. The tokens are declared in exactly ONE place — `variables.css`,
 *      where the brand palette lives. A second declaration in a
 *      feature stylesheet would pin the tooltip for that one surface
 *      and put it out of reach of the palette and of every theme.
 *
 * A chip is deliberately the same dark lozenge under every desktop
 * theme — one line of text pinned to a control, always the same
 * object. That is wrong for a rich card, and the My WordPress entity
 * hover card used to be painted as one: Obsidian, over a white Legacy
 * window, with a border and an excerpt that followed the window
 * instead. It has its own derived family now and is covered by the
 * second describe below.
 *
 * These are asserted against the stylesheet text because the rules
 * live in plain CSS with no module to import — jsdom does not resolve
 * a nested `var()` chain against undeclared properties, so a computed
 * -style assertion would prove nothing.
 */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CSS_DIR = resolve( __dirname, '../../assets/css' );

function readCss( file: string ): string {
	return readFileSync( resolve( CSS_DIR, file ), 'utf8' );
}

/**
 * Extract a single rule body by selector. Deliberately naive — these
 * selectors each appear once as a rule head in their sheet.
 */
function ruleBody( css: string, selector: string ): string {
	const at = css.indexOf( selector + ' {' );
	expect( at, `${ selector } not found` ).toBeGreaterThan( -1 );
	const open = css.indexOf( '{', at );
	const close = css.indexOf( '}', open );
	return css.slice( open + 1, close );
}

/** Collapse whitespace so multi-line `var()` chains compare cleanly. */
function flat( text: string ): string {
	return text.replace( /\s+/g, ' ' );
}

const TOOLTIPS: Array< {
	label: string;
	file: string;
	selector: string;
	/** The chain each site fell back to before the tokens existed. */
	bgFallback: string;
	fgFallback: string;
} > = [
	{
		label: 'dock tile tooltip',
		file: 'dock.css',
		selector: '.os-dock__tooltip',
		bgFallback: 'var( --os-ui-scrim, rgba( 0, 0, 0, 0.85 ) )',
		fgFallback: 'var( --os-ui-fg-on-accent, #fff )',
	},
	{
		label: 'content-graph satellite tooltip',
		file: 'content-graph.css',
		selector: '.os-content-graph__tooltip',
		bgFallback: 'var( --os-ui-surface-elevated, #1a1f2b )',
		fgFallback: 'var( --os-ui-fg-on-accent, #fff )',
	},
];

describe( 'tooltip tokens', () => {
	test.each( TOOLTIPS )(
		'$label reads the dedicated tokens first',
		( { file, selector, bgFallback, fgFallback } ) => {
			const body = flat( ruleBody( readCss( file ), selector ) );

			expect( body ).toContain(
				`background: var( --os-tooltip-bg, ${ bgFallback } )`
			);
			expect( body ).toContain(
				`color: var( --os-tooltip-fg, ${ fgFallback } )`
			);
		}
	);

	test( 'only variables.css declares them, so one palette owns the look', () => {
		// A declaration is `--name:`; a read is `var( --name,`. A
		// declaration in a consuming sheet would pin that one tooltip
		// and defeat both the palette and every desktop theme.
		// `my-wordpress.css` no longer paints a chip, but it still
		// names both tokens as its last fallback, so it stays covered.
		const consumers = [
			...TOOLTIPS.map( ( t ) => t.file ),
			'my-wordpress.css',
		];
		for ( const file of consumers ) {
			const css = readCss( file );

			expect(
				/--os-tooltip-(?:bg|fg)\s*:/.test( css ),
				`${ file } declares a tooltip token`
			).toBe( false );
		}

		const vars = readCss( 'variables.css' );
		expect( vars ).toMatch( /--os-tooltip-bg:\s*#33303a/ );
		expect( vars ).toMatch( /--os-tooltip-fg:\s*#fffbff/ );
	} );

	test( 'variables.css documents both tokens', () => {
		const css = readCss( 'variables.css' );

		expect( css ).toContain( '--os-tooltip-bg' );
		expect( css ).toContain( '--os-tooltip-fg' );
	} );
} );

/**
 * The My WordPress entity hover card.
 *
 * A card is not a chip. It carries a title, a featured image and an
 * excerpt, it is summoned from a tile inside a window, and it reads as
 * that window's furniture — so it follows the desktop theme the window
 * follows. Painting it with `--os-tooltip-bg` made it the one surface
 * in the shell that ignored the active theme: Obsidian, floating over
 * a white window, under Legacy.
 *
 * What makes "follows the theme" true is that every value in the family
 * is DERIVED. A theme only has to name the tokens it already knows —
 * Legacy names `--os-my-wordpress-bg` (`#fff`) and `--os-ui-border`
 * (`#dcdcde`) — and the card moves with the window for free. Declare
 * any of these flat and the card is stranded on the palette's value
 * again, which is the exact bug this file exists to prevent, one
 * family over.
 *
 * The shadow is the deliberate exception: a drop shadow is cast light,
 * dark under a light theme and dark under a dark one, so there is no
 * window token for it to follow.
 */
describe( 'My WordPress hover card tokens', () => {
	/** Card token → the window/palette token it must resolve through. */
	const DERIVED: Array< [ string, string ] > = [
		[ '--os-my-wordpress-card-bg', '--os-my-wordpress-bg' ],
		[ '--os-my-wordpress-card-fg', '--os-my-wordpress-fg' ],
		[ '--os-my-wordpress-card-fg-muted', '--os-ui-fg-muted' ],
		[ '--os-my-wordpress-card-border', '--os-ui-border' ],
		[ '--os-my-wordpress-card-thumb-bg', '--os-media-tile-bg' ],
		[ '--os-my-wordpress-card-lock-bg', '--os-ui-badge-danger-bg' ],
	];

	test.each( DERIVED )(
		'%s is derived from %s, so a theme moves it',
		( token, source ) => {
			const vars = flat( readCss( 'variables.css' ) );

			expect( vars ).toMatch(
				new RegExp( `${ token }:\\s*var\\( ?${ source }[,)]` )
			);
		}
	);

	test( 'the card does not read the chip tokens first', () => {
		const body = flat(
			ruleBody( readCss( 'my-wordpress.css' ), '.os-my-wordpress__tooltip' )
		);

		expect( body ).toContain( 'background: var( --os-my-wordpress-card-bg,' );
		expect( body ).toContain( 'color: var( --os-my-wordpress-card-fg,' );
		// The chip tokens survive as the fallback, so a theme that only
		// knows the old names still lands somewhere sensible.
		expect( body ).toContain( '--os-tooltip-bg' );
		expect( body ).toContain( '--os-tooltip-fg' );
	} );

	test( 'the border and the shadow are what lift the card off the window', () => {
		// The card's background IS the window's background. Lose either
		// of these and it stops reading as a separate object — which is
		// what happened when the border resolved to `--os-ui-border`
		// (#33303a) against a `--os-tooltip-bg` (#33303a) card.
		const body = flat(
			ruleBody( readCss( 'my-wordpress.css' ), '.os-my-wordpress__tooltip' )
		);

		expect( body ).toContain( 'var( --os-my-wordpress-card-border,' );
		expect( body ).toContain( 'var( --os-my-wordpress-card-shadow,' );

		const vars = flat( readCss( 'variables.css' ) );
		const bg = vars.match( /--os-my-wordpress-card-bg:\s*var\( ?([^,)]+)/ );
		const border = vars.match(
			/--os-my-wordpress-card-border:\s*var\( ?([^,)]+)/
		);
		expect( bg?.[ 1 ] ).not.toBe( border?.[ 1 ] );
	} );

	test( 'no feature stylesheet declares a card token', () => {
		// Same rule as the chip: one declaration, in the palette. A
		// declaration in `my-wordpress.css` would sit on an ancestor of
		// nothing useful anyway — the card is appended to
		// `document.body`, outside `.desktop-mode-my-wordpress`.
		for ( const file of [ 'my-wordpress.css', 'desktop-files.css' ] ) {
			expect(
				/--os-my-wordpress-card-[a-z-]+\s*:/.test( readCss( file ) ),
				`${ file } declares a card token`
			).toBe( false );
		}
	} );
} );
