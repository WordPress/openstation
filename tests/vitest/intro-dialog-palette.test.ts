/**
 * The four native-window intro dialogs must reach the palette.
 *
 * Every native window ships a first-open intro, and each one is
 * appended to `document.body` rather than into a window body. That
 * placement is what makes them a distinct hazard, and it is the
 * source of both bugs this test pins:
 *
 * 1. **Undeclared tokens.** These dialogs used to read
 *    `--wp-admin-theme-bg`, `--wp-admin-theme-fg`,
 *    `--wp-admin-theme-fg-muted` and `--wp-admin-theme-border`. None
 *    of those four names is declared anywhere in the plugin, so every
 *    one silently resolved to its pre-brand literal and the dialogs
 *    rendered as white cards that neither the palette nor any desktop
 *    theme could reach. A `var()` on a name nobody declares fails
 *    open, which is exactly why nothing caught it.
 *
 * 2. **The accent used as a scrim.** The backdrops were
 *    `color-mix( … var( --wp-admin-theme-color, #1d2327 ) 60% … )`.
 *    That token IS declared — the palette sets it to Pulse — so the
 *    neutral `#1d2327` fallback never applied and the scrim came out
 *    60% pink over the whole desktop. An accent colour is not a scrim
 *    colour.
 *
 * The third guard covers the heading collision. Core's `common.css`
 * ships a bare `h2, h3 { color: #1d2327 }`, and a declaration
 * matching the element always beats a value the element would
 * otherwise inherit from the dialog — so a title rule that sets size
 * and weight but no `color` computes to near-black on the palette's
 * dark surface. `window-chrome.css` already neutralises this, but
 * only under `:where( .os-window__body )`, which a body-level
 * backdrop never matches.
 */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve( __dirname, '../..' );

/**
 * The three inline-styled dialogs. The Posts one is styled from
 * `posts-window.css` instead and is checked separately below.
 */
const INLINE_DIALOGS = [
	'src/posts-window/pages-intro-dialog.ts',
	'src/posts-window/users-intro-dialog.ts',
	'src/plugins-window/intro-dialog.ts',
] as const;

/** Names no stylesheet in the plugin declares. */
const UNDECLARED = [
	'--wp-admin-theme-bg',
	'--wp-admin-theme-fg',
	'--wp-admin-theme-fg-muted',
	'--wp-admin-theme-border',
] as const;

const read = ( rel: string ): string =>
	readFileSync( resolve( ROOT, rel ), 'utf8' );

describe( 'native-window intro dialogs', () => {
	test.each( INLINE_DIALOGS )( '%s reads only declared tokens', ( rel ) => {
		const src = read( rel );

		for ( const name of UNDECLARED ) {
			// Word-boundary the name so `--wp-admin-theme-fg` does not
			// also match `--wp-admin-theme-fg-muted`.
			expect(
				new RegExp( `${ name }(?![\\w-])` ).test( src ),
				`${ rel } reads ${ name }, which nothing declares — it will fall back to its pre-brand literal and the palette can never reach it. Use the --os-ui-* equivalent.`
			).toBe( false );
		}
	} );

	test.each( INLINE_DIALOGS )( '%s uses a neutral scrim', ( rel ) => {
		const src = read( rel );

		expect(
			/color-mix\([^)]*--wp-admin-theme-color/.test( src ),
			`${ rel } derives its backdrop from the admin accent. The palette sets that token to Pulse, so the neutral fallback never applies and the scrim renders 60% pink over the desktop. Use a neutral scrim.`
		).toBe( false );
	} );

	test.each( INLINE_DIALOGS )( '%s gives its heading a colour', ( rel ) => {
		const src = read( rel );
		const heading = /\.os-[a-z-]+-intro h2 \{([^}]*)\}/.exec( src );

		expect( heading, `${ rel } has no intro heading rule` ).not.toBeNull();
		expect(
			/(^|\W)color:/.test( heading![ 1 ] ),
			`${ rel } styles its intro h2 without a color. Core's bare "h2, h3 { color: #1d2327 }" beats the value inherited from the dialog, so the title renders near-black on the dark surface.`
		).toBe( true );
	} );

	test( 'the Posts intro title declares a colour', () => {
		const css = read( 'assets/css/posts-window.css' );
		const rule = /\.os-intro__title \{([^}]*)\}/.exec( css );

		expect( rule, 'no .os-intro__title rule in posts-window.css' ).not.toBeNull();
		expect(
			/(^|\W)color:/.test( rule![ 1 ] ),
			'.os-intro__title sets no color, so core\'s bare "h2, h3 { color: #1d2327 }" wins over the value inherited from .os-intro and the heading renders near-black on the dark dialog. The window-chrome.css fix is scoped to :where( .os-window__body ) and this backdrop is appended to document.body, so it never reaches here.'
		).toBe( true );
	} );
} );
