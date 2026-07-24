/**
 * Unit tests for `src/admin-bar-updates.ts`.
 *
 * The live menu-refresh payload carries `updateCounts` (aggregate
 * pending-update numbers built by `desktop_mode_build_menu_payload()`)
 * and `applyAdminBarUpdates()` mirrors them onto Core's
 * `#wp-admin-bar-updates` node — the top-left circle-arrows notifier
 * that otherwise shows its boot-time count until a hard refresh
 * (GH#296).
 */
import { afterEach, describe, expect, test } from 'vitest';
import {
	applyAdminBarUpdates,
	parseUpdateCounts,
} from '../../src/admin-bar-updates';

const UPDATE_CORE_URL = 'https://example.test/wp-admin/update-core.php';

function counts( total: number ): unknown {
	return {
		total,
		formatted: String( total ),
		text:
			total === 1
				? '1 update available'
				: `${ total } updates available`,
		url: UPDATE_CORE_URL,
	};
}

/** Server-rendered admin bar with the updates node present (count 3). */
function mountBarWithUpdatesNode(): void {
	document.body.innerHTML = `
		<div id="wpadminbar">
			<ul id="wp-admin-bar-root-default">
				<li id="wp-admin-bar-site-name"><a class="ab-item" href="#">Site</a></li>
				<li id="wp-admin-bar-updates">
					<a class="ab-item" href="${ UPDATE_CORE_URL }">
						<span class="ab-icon" aria-hidden="true"></span>
						<span class="ab-label" aria-hidden="true">3</span>
						<span class="screen-reader-text updates-available-text">3 updates available</span>
					</a>
				</li>
				<li id="wp-admin-bar-comments"><a class="ab-item" href="#">Comments</a></li>
			</ul>
		</div>
	`;
}

/** Server-rendered admin bar with NO updates node (booted at zero). */
function mountBarWithoutUpdatesNode(): void {
	document.body.innerHTML = `
		<div id="wpadminbar">
			<ul id="wp-admin-bar-root-default">
				<li id="wp-admin-bar-site-name"><a class="ab-item" href="#">Site</a></li>
				<li id="wp-admin-bar-comments"><a class="ab-item" href="#">Comments</a></li>
			</ul>
		</div>
	`;
}

afterEach( () => {
	document.body.innerHTML = '';
} );

describe( 'parseUpdateCounts', () => {
	test( 'rejects non-objects and missing totals', () => {
		expect( parseUpdateCounts( undefined ) ).toBeNull();
		expect( parseUpdateCounts( null ) ).toBeNull();
		expect( parseUpdateCounts( 'nope' ) ).toBeNull();
		expect( parseUpdateCounts( {} ) ).toBeNull();
		expect( parseUpdateCounts( { total: 'three' } ) ).toBeNull();
		expect( parseUpdateCounts( { total: NaN } ) ).toBeNull();
	} );

	test( 'normalizes totals and fills string fallbacks', () => {
		expect( parseUpdateCounts( { total: 2.9 } ) ).toEqual( {
			total: 2,
			formatted: '2.9',
			text: '',
			url: '',
		} );
		expect( parseUpdateCounts( { total: -4 } )?.total ).toBe( 0 );
	} );
} );

describe( 'applyAdminBarUpdates', () => {
	test( 'updates label and screen-reader text on the existing node', () => {
		mountBarWithUpdatesNode();
		applyAdminBarUpdates( counts( 1 ) );

		const node = document.getElementById( 'wp-admin-bar-updates' )!;
		expect( node.style.display ).toBe( '' );
		expect( node.querySelector( '.ab-label' )?.textContent ).toBe( '1' );
		expect(
			node.querySelector( '.updates-available-text' )?.textContent,
		).toBe( '1 update available' );
	} );

	test( 'hides the node when the count drops to zero', () => {
		mountBarWithUpdatesNode();
		applyAdminBarUpdates( counts( 0 ) );

		const node = document.getElementById( 'wp-admin-bar-updates' )!;
		expect( node.style.display ).toBe( 'none' );
	} );

	test( 'zero → N → zero round-trips through the same node', () => {
		mountBarWithUpdatesNode();
		applyAdminBarUpdates( counts( 0 ) );
		applyAdminBarUpdates( counts( 5 ) );

		const node = document.getElementById( 'wp-admin-bar-updates' )!;
		expect( node.style.display ).toBe( '' );
		expect( node.querySelector( '.ab-label' )?.textContent ).toBe( '5' );

		applyAdminBarUpdates( counts( 0 ) );
		expect( node.style.display ).toBe( 'none' );
	} );

	test( 'creates the node in Core slot order when the shell booted at zero', () => {
		mountBarWithoutUpdatesNode();
		applyAdminBarUpdates( counts( 2 ) );

		const node = document.getElementById( 'wp-admin-bar-updates' );
		expect( node ).not.toBeNull();
		// Core order: site-name (30) → updates (50) → comments (60).
		expect( node!.nextElementSibling?.id ).toBe( 'wp-admin-bar-comments' );
		const anchor = node!.querySelector( 'a.ab-item' ) as HTMLAnchorElement;
		expect( anchor.href ).toBe( UPDATE_CORE_URL );
		expect( node!.querySelector( '.ab-label' )?.textContent ).toBe( '2' );
		expect(
			node!.querySelector( '.updates-available-text' )?.textContent,
		).toBe( '2 updates available' );
		expect(
			node!.querySelector( '.ab-icon' )?.getAttribute( 'aria-hidden' ),
		).toBe( 'true' );
	} );

	test( 'does not create a node for a zero count', () => {
		mountBarWithoutUpdatesNode();
		applyAdminBarUpdates( counts( 0 ) );
		expect( document.getElementById( 'wp-admin-bar-updates' ) ).toBeNull();
	} );

	test( 'does not create a dead-link node when the payload has no URL', () => {
		mountBarWithoutUpdatesNode();
		applyAdminBarUpdates( { total: 2, formatted: '2', text: '', url: '' } );
		expect( document.getElementById( 'wp-admin-bar-updates' ) ).toBeNull();
	} );

	test( 'is a no-op without an admin bar in the DOM', () => {
		document.body.innerHTML = '<div id="desktop-mode-area"></div>';
		expect( () => applyAdminBarUpdates( counts( 3 ) ) ).not.toThrow();
	} );

	test( 'ignores payloads without the key (older bridge)', () => {
		mountBarWithUpdatesNode();
		applyAdminBarUpdates( undefined );
		const node = document.getElementById( 'wp-admin-bar-updates' )!;
		expect( node.querySelector( '.ab-label' )?.textContent ).toBe( '3' );
		expect( node.style.display ).toBe( '' );
	} );
} );
