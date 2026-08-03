/**
 * Tooltip theming tokens.
 *
 * Every tooltip in the shell used to borrow its two colours from
 * unrelated token families — `--wpd-scrim` (an overlay BACKDROP) or
 * `--wpd-surface-elevated` for the surface, `--wpd-fg-on-accent` for
 * the text. Those pairings hold for the default look and come apart
 * under a custom desktop theme, and a theme author had no name to aim
 * at that would fix the tooltip without also moving the modal
 * backdrop or the text on accent-filled buttons.
 *
 * `--desktop-mode-tooltip-bg` / `--desktop-mode-tooltip-fg` are that
 * name. Two things have to stay true for them to be worth having:
 *
 *   1. Every tooltip surface reads the dedicated token FIRST, with
 *      its old chain as the fallback.
 *   2. The tokens are declared in exactly ONE place — `variables.css`,
 *      where the brand palette lives. A second declaration in a
 *      feature stylesheet would pin the tooltip for that one surface
 *      and put it out of reach of the palette and of every theme.
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
		selector: '.desktop-mode-dock__tooltip',
		bgFallback: 'var( --wpd-scrim, rgba( 0, 0, 0, 0.85 ) )',
		fgFallback: 'var( --wpd-fg-on-accent, #fff )',
	},
	{
		label: 'content-graph satellite tooltip',
		file: 'content-graph.css',
		selector: '.desktop-mode-content-graph__tooltip',
		bgFallback: 'var( --wpd-surface-elevated, #1a1f2b )',
		fgFallback: 'var( --wpd-fg-on-accent, #fff )',
	},
	{
		label: 'My WordPress entity hover card',
		file: 'my-wordpress.css',
		selector: '.desktop-mode-my-wordpress__tooltip',
		bgFallback: 'var( --desktop-mode-surface, var( --wpd-surface, #fff ) )',
		fgFallback: 'var( --desktop-mode-fg, #1d2327 )',
	},
];

describe( 'tooltip tokens', () => {
	test.each( TOOLTIPS )(
		'$label reads the dedicated tokens first',
		( { file, selector, bgFallback, fgFallback } ) => {
			const body = flat( ruleBody( readCss( file ), selector ) );

			expect( body ).toContain(
				`background: var( --desktop-mode-tooltip-bg, ${ bgFallback } )`
			);
			expect( body ).toContain(
				`color: var( --desktop-mode-tooltip-fg, ${ fgFallback } )`
			);
		}
	);

	test( 'only variables.css declares them, so one palette owns the look', () => {
		// A declaration is `--name:`; a read is `var( --name,`. A
		// declaration in a consuming sheet would pin that one tooltip
		// and defeat both the palette and every desktop theme.
		for ( const file of TOOLTIPS.map( ( t ) => t.file ) ) {
			const css = readCss( file );

			expect(
				/--desktop-mode-tooltip-(?:bg|fg)\s*:/.test( css ),
				`${ file } declares a tooltip token`
			).toBe( false );
		}

		const vars = readCss( 'variables.css' );
		expect( vars ).toMatch( /--desktop-mode-tooltip-bg:\s*#33303a/ );
		expect( vars ).toMatch( /--desktop-mode-tooltip-fg:\s*#fffbff/ );
	} );

	test( 'variables.css documents both tokens', () => {
		const css = readCss( 'variables.css' );

		expect( css ).toContain( '--desktop-mode-tooltip-bg' );
		expect( css ).toContain( '--desktop-mode-tooltip-fg' );
	} );
} );
