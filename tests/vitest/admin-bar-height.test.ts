/**
 * The shell starts where the admin bar ENDS, not where Core says it
 * should.
 *
 * `--wp-admin--admin-bar--height` is Core's promise about Core's bar:
 * 32px, 46px under 783px. The bar is the one piece of chrome the
 * shell does not own, and a host can make it taller, give it a
 * border or push it down under a fixed strip of its own —
 * WordPress.com's staff debug chrome adds a strip above the bar, and
 * the shell then started 4px under it, with the bar painted over the
 * top of every title bar. `src/admin-bar-height.ts` measures the
 * bar's real bottom edge and publishes it as `--os-admin-bar-height`;
 * every consumer reads that first and falls back to Core's token.
 *
 * Pinned here:
 *
 * - the value is the bar's bottom edge in viewport px — height AND
 *   offset — so a pushed-down bar and a taller bar both land right;
 * - a bar with no box at the top edge publishes nothing: hidden by a
 *   mode or a viewport, or parked above the viewport by the dynamic
 *   mode, so those modes keep resolving Core's token as before;
 * - every consumer in the stylesheets reads the measured token with
 *   Core's token as the fallback, so the first paint is unchanged.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	ADMIN_BAR_HEIGHT_PROP,
	installAdminBarHeight,
	measureAdminBarBottom,
	type AdminBarHeightController,
} from '../../src/admin-bar-height';
import { containerStyles } from '../../src/ui/components/os-toast/os-toast.styles';

const ROOT = resolve( __dirname, '../..' );

function rect( top: number, height: number ): () => DOMRect {
	return () =>
		( {
			top,
			height,
			bottom: top + height,
			left: 0,
			right: 1024,
			width: 1024,
			x: 0,
			y: top,
			toJSON: () => ( {} ),
		} ) as DOMRect;
}

function makeBar( top: number, height: number ): HTMLElement {
	const bar = document.createElement( 'div' );
	bar.id = 'wpadminbar';
	bar.getBoundingClientRect = rect( top, height );
	document.body.appendChild( bar );
	return bar;
}

const controllers: AdminBarHeightController[] = [];
function install( bar: HTMLElement ): AdminBarHeightController {
	const ctl = installAdminBarHeight( { bar } );
	controllers.push( ctl );
	return ctl;
}

function published(): string {
	return document.documentElement.style.getPropertyValue(
		ADMIN_BAR_HEIGHT_PROP,
	);
}

afterEach( () => {
	while ( controllers.length ) {
		controllers.pop()!.destroy();
	}
	document.body.innerHTML = '';
	document.documentElement.style.removeProperty( ADMIN_BAR_HEIGHT_PROP );
	vi.restoreAllMocks();
} );

describe( 'measureAdminBarBottom', () => {
	test( 'is the bottom edge: a bar pushed down 4px under a host strip ends at 36', () => {
		expect( measureAdminBarBottom( makeBar( 4, 32 ) ) ).toBe( 36 );
	} );

	test( 'a taller bar ends where it ends', () => {
		expect( measureAdminBarBottom( makeBar( 0, 46 ) ) ).toBe( 46 );
	} );

	test( 'a bar with no box (display: none) is null', () => {
		expect( measureAdminBarBottom( makeBar( 0, 0 ) ) ).toBeNull();
	} );

	test( 'a bar parked above the viewport (dynamic mode) is null, not its peek strip', () => {
		expect( measureAdminBarBottom( makeBar( -28, 32 ) ) ).toBeNull();
	} );

	test( 'keeps two decimals of a fractional edge rather than rounding to a hairline gap', () => {
		expect( measureAdminBarBottom( makeBar( 0, 32.456 ) ) ).toBe( 32.46 );
	} );
} );

describe( 'installAdminBarHeight', () => {
	test( 'writes the measured edge on <html> at install', () => {
		install( makeBar( 4, 32 ) );
		expect( published() ).toBe( '36px' );
	} );

	test( 'publishes nothing for a bar that has no box, and removes a stale value on refresh', () => {
		const bar = makeBar( 0, 32 );
		const ctl = install( bar );
		expect( published() ).toBe( '32px' );
		bar.getBoundingClientRect = rect( 0, 0 );
		ctl.refresh();
		expect( published() ).toBe( '' );
	} );

	test( 'follows the bar when it moves or grows', () => {
		const bar = makeBar( 0, 32 );
		const ctl = install( bar );
		bar.getBoundingClientRect = rect( 0, 64 );
		ctl.refresh();
		expect( published() ).toBe( '64px' );
		bar.getBoundingClientRect = rect( 4, 32 );
		ctl.refresh();
		expect( published() ).toBe( '36px' );
	} );

	test( 'a same-edge refresh does not rewrite the property', () => {
		const bar = makeBar( 0, 32 );
		const ctl = install( bar );
		const set = vi.spyOn( document.documentElement.style, 'setProperty' );
		ctl.refresh();
		ctl.refresh();
		expect( set ).not.toHaveBeenCalled();
	} );

	test( 're-measures on a viewport resize', () => {
		const bar = makeBar( 0, 32 );
		install( bar );
		bar.getBoundingClientRect = rect( 0, 46 );
		window.dispatchEvent( new Event( 'resize' ) );
		expect( published() ).toBe( '46px' );
	} );

	test( 're-measures when a body class flips (the admin-bar modes, fullscreen)', async () => {
		const bar = makeBar( 0, 32 );
		install( bar );
		bar.getBoundingClientRect = rect( 0, 0 );
		document.body.classList.add( 'os-has-fullscreen-window' );
		// MutationObserver delivers on a microtask.
		await Promise.resolve();
		expect( published() ).toBe( '' );
	} );

	test( 'destroy removes the property and stops listening', () => {
		const bar = makeBar( 0, 32 );
		const ctl = install( bar );
		ctl.destroy();
		expect( published() ).toBe( '' );
		bar.getBoundingClientRect = rect( 0, 46 );
		window.dispatchEvent( new Event( 'resize' ) );
		expect( published() ).toBe( '' );
	} );

	test( 'is a no-op without a bar', () => {
		const ctl = installAdminBarHeight( { bar: null } );
		ctl.refresh();
		ctl.destroy();
		expect( published() ).toBe( '' );
	} );
} );

describe( 'every consumer reads the measured edge with Core’s token behind it', () => {
	const CHAIN =
		/var\(\s*--os-admin-bar-height\s*,\s*var\(\s*--wp-admin--admin-bar--height\s*,\s*(32|46)px\s*\)\s*\)/;

	function css( file: string ): string {
		return readFileSync( resolve( ROOT, 'assets/css', file ), 'utf8' ).replace(
			/\/\*[\s\S]*?\*\//g,
			'',
		);
	}

	test( '.os-shell starts at the measured edge, at every breakpoint', () => {
		const rules = css( 'desktop.css' ).match( /\.os-shell\s*\{[^}]*\}/g ) ?? [];
		const insets = rules.filter( ( r ) => /inset-block-start:\s*var/.test( r ) );
		expect( insets.length ).toBeGreaterThanOrEqual( 2 );
		for ( const rule of insets ) {
			expect( rule ).toMatch( CHAIN );
		}
	} );

	test( 'no top-level admin-bar item may be taller than the bar', () => {
		// A host that lays a group out as a flex row (WordPress.com's
		// Debug Bar) stretches every item to the tallest one and paints
		// the group's background under the title bars; the cap is the
		// bar's own height token so the 46px mobile bar keeps it too.
		const rule = css( 'desktop.css' ).match(
			/body\.os-active #wpadminbar \.ab-top-menu > li\s*\{([^}]*)\}/,
		);
		expect( rule ).toBeTruthy();
		expect( rule![ 1 ] ).toMatch(
			/max-height:\s*var\(\s*--wp-admin--admin-bar--height\s*,\s*32px\s*\)/,
		);
	} );

	test( 'the toast container hangs off the measured edge', () => {
		expect( containerStyles.cssText ).toMatch( CHAIN );
	} );

	test( 'the release card hangs off the measured edge', () => {
		const src = readFileSync( resolve( ROOT, 'src/release-card.ts' ), 'utf8' );
		expect( src ).toMatch( /--os-admin-bar-height,var\(--wp-admin--admin-bar--height,32px\)/ );
	} );
} );
