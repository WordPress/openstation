/**
 * Tests for the wallpaper-icon badge surface
 * (`wp.os.icons.setBadge` / `clearBadge` / `getBadge`).
 *
 * The icon rail is the third badge surface, alongside the dock and
 * taskbar — every event-driven contract that holds for the others
 * must hold here too. We exercise the public surface (no DOM
 * scraping in the tests, mirroring how plugin authors are expected
 * to use it) and assert on:
 *
 *   - idempotency,
 *   - silent no-op when the id isn't on the rail,
 *   - activity-bus emission with `rail: 'icon'`,
 *   - hook-bus emission with `previousCount`,
 *   - badges surviving a full grid rebuild.
 *
 * @group icons
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	_resetIconBadgesForTests,
	clearIconBadge,
	getIconBadge,
	renderDesktopIcons,
	setIconBadge,
} from '../../src/desktop-icons';
import { activity } from '../../src/activity';
import { addAction, HOOKS, removeAction } from '../../src/hooks';
import type { DesktopIconServerEntry } from '../../src/types';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';

function makeIcon( overrides: Partial< DesktopIconServerEntry > = {} ): DesktopIconServerEntry {
	return {
		id: 'os-messages',
		title: 'Messages',
		icon: 'dashicons-email',
		window: 'os-messages',
		url: '',
		position: 10,
		...overrides,
	};
}

function mountGrid( icons: DesktopIconServerEntry[] ): HTMLElement {
	const host = document.createElement( 'section' );
	document.body.appendChild( host );
	const stubManager = {} as ConstructorParameters< typeof renderDesktopIcons >[ 2 ][ 'manager' ];
	renderDesktopIcons( host, icons, {
		openWindow: () => true,
		manager: stubManager,
	} );
	return host;
}

function badgeNode( host: HTMLElement, iconId: string ): HTMLElement | null {
	return host.querySelector< HTMLElement >(
		`[data-icon-id="${ iconId }"] > .os-icon__badge`,
	);
}

describe( 'wp.os.icons.setBadge', () => {
	beforeEach( () => {
		installHooksStub();
		_resetIconBadgesForTests();
	} );
	afterEach( () => {
		clearHooksStub();
		_resetIconBadgesForTests();
		document.body.innerHTML = '';
	} );

	test( 'paints a badge on the matching tile', () => {
		const host = mountGrid( [ makeIcon() ] );
		setIconBadge( 'os-messages', 3 );
		const badge = badgeNode( host, 'os-messages' );
		expect( badge ).not.toBeNull();
		expect( badge?.textContent ).toBe( '3' );
	} );

	test( 'is idempotent — same count does not emit twice', () => {
		mountGrid( [ makeIcon() ] );
		const cb = vi.fn();
		const off = activity.subscribe( 'os/badge-changed', cb );
		setIconBadge( 'os-messages', 5 );
		setIconBadge( 'os-messages', 5 );
		expect( cb ).toHaveBeenCalledTimes( 1 );
		off();
	} );

	test( '0 clears the badge node', () => {
		const host = mountGrid( [ makeIcon() ] );
		setIconBadge( 'os-messages', 4 );
		expect( badgeNode( host, 'os-messages' ) ).not.toBeNull();
		clearIconBadge( 'os-messages' );
		expect( badgeNode( host, 'os-messages' ) ).toBeNull();
	} );

	test( '>99 renders as 99+', () => {
		const host = mountGrid( [ makeIcon() ] );
		setIconBadge( 'os-messages', 137 );
		expect( badgeNode( host, 'os-messages' )?.textContent ).toBe( '99+' );
	} );

	test( 'silent no-op when the id is not on the rail', () => {
		mountGrid( [ makeIcon() ] );
		const cb = vi.fn();
		const off = activity.subscribe( 'os/badge-changed', cb );
		setIconBadge( 'never-registered', 5 );
		expect( cb ).not.toHaveBeenCalled();
		expect( getIconBadge( 'never-registered' ) ).toBe( 0 );
		off();
	} );

	test( 'publishes os/badge-changed with rail: "icon"', () => {
		mountGrid( [ makeIcon() ] );
		const cb = vi.fn();
		const off = activity.subscribe( 'os/badge-changed', cb );
		setIconBadge( 'os-messages', 7 );
		expect( cb ).toHaveBeenCalledWith( {
			itemId: 'os-messages',
			count: 7,
			rail: 'icon',
		} );
		off();
	} );

	test( 'fires HOOKS.ICON_BADGE_CHANGED with previousCount', () => {
		mountGrid( [ makeIcon() ] );
		const cb = vi.fn();
		const ns = 'os-tests/icon-badge';
		addAction( HOOKS.ICON_BADGE_CHANGED, ns, cb );
		setIconBadge( 'os-messages', 4 );
		setIconBadge( 'os-messages', 9 );
		expect( cb ).toHaveBeenNthCalledWith( 1, {
			iconId: 'os-messages',
			count: 4,
			previousCount: 0,
		} );
		expect( cb ).toHaveBeenNthCalledWith( 2, {
			iconId: 'os-messages',
			count: 9,
			previousCount: 4,
		} );
		removeAction( HOOKS.ICON_BADGE_CHANGED, ns );
	} );

	test( 'getBadge returns the current count and 0 for unset ids', () => {
		mountGrid( [ makeIcon() ] );
		setIconBadge( 'os-messages', 11 );
		expect( getIconBadge( 'os-messages' ) ).toBe( 11 );
		expect( getIconBadge( 'never-set' ) ).toBe( 0 );
	} );

	test( 'badge survives a full grid rebuild', () => {
		const host = mountGrid( [ makeIcon() ] );
		setIconBadge( 'os-messages', 6 );
		expect( badgeNode( host, 'os-messages' )?.textContent ).toBe( '6' );

		// Plugin activation lands a different icon list — the
		// fingerprint changes, the renderer rebuilds. Without the
		// badge persistence baked into the renderer this would
		// drop the badge to nothing.
		const stubManager = {} as ConstructorParameters< typeof renderDesktopIcons >[ 2 ][ 'manager' ];
		renderDesktopIcons(
			host,
			[ makeIcon(), makeIcon( { id: 'other-plugin', title: 'Other' } ) ],
			{ openWindow: () => true, manager: stubManager },
		);
		const survived = badgeNode( host, 'os-messages' );
		expect( survived ).not.toBeNull();
		expect( survived?.textContent ).toBe( '6' );
	} );

	test( 'rebuild does not paint a badge for icons that never had one', () => {
		const host = mountGrid( [ makeIcon() ] );
		setIconBadge( 'os-messages', 2 );
		const stubManager = {} as ConstructorParameters< typeof renderDesktopIcons >[ 2 ][ 'manager' ];
		renderDesktopIcons(
			host,
			[ makeIcon(), makeIcon( { id: 'no-badge', title: 'No badge' } ) ],
			{ openWindow: () => true, manager: stubManager },
		);
		expect( badgeNode( host, 'no-badge' ) ).toBeNull();
		expect( badgeNode( host, 'os-messages' )?.textContent ).toBe( '2' );
	} );

	test( 'negative + fractional counts are clamped to 0 and floored', () => {
		const host = mountGrid( [ makeIcon() ] );
		setIconBadge( 'os-messages', 5 );
		setIconBadge( 'os-messages', -3 );
		expect( badgeNode( host, 'os-messages' ) ).toBeNull();
		setIconBadge( 'os-messages', 4.7 );
		expect( badgeNode( host, 'os-messages' )?.textContent ).toBe( '4' );
	} );
} );
