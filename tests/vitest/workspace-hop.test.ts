/**
 * The workspace hop: the gesture split in `hopToAdmin()`, and the
 * cross-document view-transition block in the SHELL stylesheet.
 *
 * The CSS pins matter because the whole feature degrades silently: a
 * deleted opt-in, or one that migrated into a sheet chromeless iframes
 * load, would not fail anything — hops would just hard-cut (or, worse,
 * iframe navigations would start transitioning). Reduced motion must
 * keep the hop and drop only the animation.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { hopToAdmin, wantsBrowserTab } from '../../src/multisite/hop';

const ROOT = resolve( __dirname, '../..' );
const URL = 'http://example.test/site2/wp-admin/';

describe( 'hopToAdmin', () => {
	const realLocation = window.location;
	let assign: ReturnType< typeof vi.fn >;

	beforeEach( () => {
		assign = vi.fn();
		Object.defineProperty( window, 'location', {
			value: { ...realLocation, assign },
			configurable: true,
		} );
	} );

	afterEach( () => {
		Object.defineProperty( window, 'location', {
			value: realLocation,
			configurable: true,
		} );
	} );

	test( 'a plain activation navigates this tab', () => {
		hopToAdmin( URL );
		hopToAdmin( URL, new MouseEvent( 'click' ) );
		expect( assign.mock.calls ).toEqual( [ [ URL ], [ URL ] ] );
	} );

	test( 'every browser-tab gesture opens a tab instead', () => {
		const open = vi.spyOn( window, 'open' ).mockReturnValue( null );
		try {
			for ( const init of [
				{ metaKey: true },
				{ ctrlKey: true },
				{ shiftKey: true },
				{ button: 1 },
			] as MouseEventInit[] ) {
				expect( wantsBrowserTab( new MouseEvent( 'click', init ) ) ).toBe(
					true,
				);
				hopToAdmin( URL, new MouseEvent( 'click', init ) );
			}
			expect( open ).toHaveBeenCalledTimes( 4 );
			expect( assign ).not.toHaveBeenCalled();
		} finally {
			open.mockRestore();
		}
	} );
} );

describe( 'the view-transition opt-in', () => {
	const shell = readFileSync(
		resolve( ROOT, 'assets/css/desktop.css' ),
		'utf8',
	);

	test( 'the shell opts into cross-document transitions', () => {
		expect( shell ).toMatch( /@view-transition\s*\{\s*navigation:\s*auto;/ );
		// Both halves of the crossfade are declared — a missing side
		// leaves the UA default on one and the custom curve on the
		// other, a mismatched blink.
		expect( shell ).toContain( '::view-transition-old(root)' );
		expect( shell ).toContain( '::view-transition-new(root)' );
	} );

	test( 'reduced motion drops the animation, never the hop', () => {
		const reduced = shell.slice(
			shell.indexOf( '@media ( prefers-reduced-motion: reduce )', shell.indexOf( '@view-transition' ) ),
		);
		expect( reduced ).toMatch( /@view-transition\s*\{\s*navigation:\s*none;/ );
	} );

	test( 'chromeless iframes never opt in', () => {
		// The opt-in in a sheet iframes load would make ordinary
		// in-window navigations transition. `variables.css` is the
		// chromeless dependency; `chromeless.css` is the iframe skin.
		for ( const sheet of [ 'assets/css/variables.css', 'assets/css/chromeless.css' ] ) {
			expect( readFileSync( resolve( ROOT, sheet ), 'utf8' ) ).not.toContain(
				'@view-transition',
			);
		}
	} );
} );
