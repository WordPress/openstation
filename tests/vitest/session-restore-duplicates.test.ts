/**
 * Session restore must recreate EVERY saved window, under the id it
 * was saved with.
 *
 * `restoreSession` used to replay each saved window through
 * `WindowManager.open()`, which matches on `baseId`. A session holding
 * two instances of the same page (`edit-php` + `edit-php-2`, both
 * baseId `edit-php`) therefore collapsed on reload: the second call
 * found the first instance, focused it, and returned it — one window
 * came back instead of two. When the two instances had been navigated
 * apart, the URL-aware reuse check then dragged the survivor to the
 * SECOND window's URL, so the first page was lost as well.
 *
 * Restore now goes through `openNew()`, which always constructs and
 * honours a free caller-supplied instance id verbatim.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { restoreSession } from '../../src/boot/session';
import { WindowManager } from '../../src/window-manager';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import type { DesktopConfig, Session, SessionWindow } from '../../src/types';

const ORIGIN = window.location.origin;
const POSTS_URL = `${ ORIGIN }/wp-admin/edit.php`;
const PAGES_URL = `${ ORIGIN }/wp-admin/edit.php?post_type=page`;

function sessionWindow( patch: Partial< SessionWindow > = {} ): SessionWindow {
	return {
		id: 'edit-php',
		baseId: 'edit-php',
		desktopId: 'desktop-1',
		url: POSTS_URL,
		title: 'Posts',
		icon: 'dashicons-admin-post',
		state: 'normal',
		x: 100,
		y: 80,
		width: 900,
		height: 600,
		...patch,
	};
}

function desktopConfig( windows: SessionWindow[] ): DesktopConfig {
	const session: Session = {
		windows,
		desktops: [ { id: 'desktop-1', label: 'Desktop 1' } ],
		activeDesktop: 'desktop-1',
		focused: '',
		updated: 123,
	};
	return {
		adminUrl: `${ ORIGIN }/wp-admin/`,
		currentPage: POSTS_URL,
		currentTitle: 'Posts',
		currentIcon: 'dashicons-admin-post',
		dockItems: [],
		session,
	} as unknown as DesktopConfig;
}

describe( 'restoreSession — duplicate instances', () => {
	let desktop: HTMLElement;
	let manager: WindowManager;

	beforeEach( () => {
		installHooksStub();
		desktop = document.createElement( 'div' );
		desktop.id = 'desktop-mode-area';
		Object.defineProperty( desktop, 'getBoundingClientRect', {
			value: () =>
				( {
					left: 0,
					top: 0,
					right: 1600,
					bottom: 900,
					width: 1600,
					height: 900,
					x: 0,
					y: 0,
					toJSON: () => ( {} ),
				} ) as DOMRect,
		} );
		Object.defineProperty( desktop, 'clientWidth', {
			value: 1600,
			configurable: true,
		} );
		Object.defineProperty( desktop, 'clientHeight', {
			value: 900,
			configurable: true,
		} );
		document.body.appendChild( desktop );
		manager = new WindowManager( desktop );
	} );

	afterEach( () => {
		for ( const win of manager.getAll() ) {
			win.destroy();
		}
		desktop.remove();
		clearHooksStub();
	} );

	test( 'restores both instances of a multi window under their saved ids', async () => {
		const config = desktopConfig( [
			sessionWindow( { id: 'edit-php', baseId: 'edit-php' } ),
			sessionWindow( {
				id: 'edit-php-2',
				baseId: 'edit-php',
				x: 260,
				y: 160,
			} ),
		] );

		await restoreSession( manager, config, desktop );

		expect( manager.getAll() ).toHaveLength( 2 );
		expect( manager.getAll().map( ( w ) => w.id ).sort() ).toEqual( [
			'edit-php',
			'edit-php-2',
		] );
		// Both share the grouping key, so the dock instance rail and
		// "Open another" still see them as one app.
		expect( manager.getAllByBaseId( 'edit-php' ) ).toHaveLength( 2 );
	} );

	test( 'does not navigate the first instance to the second instance URL', async () => {
		const config = desktopConfig( [
			sessionWindow( { id: 'edit-php', baseId: 'edit-php', url: POSTS_URL } ),
			sessionWindow( {
				id: 'edit-php-2',
				baseId: 'edit-php',
				url: PAGES_URL,
				title: 'Pages',
			} ),
		] );

		await restoreSession( manager, config, desktop );

		const first = manager.getById( 'edit-php' );
		const second = manager.getById( 'edit-php-2' );
		expect( first?.config.url ).toBe( POSTS_URL );
		expect( second?.config.url ).toBe( PAGES_URL );
		expect( first!.iframe!.src ).toContain( 'edit.php' );
		expect( first!.iframe!.src ).not.toContain( 'post_type=page' );
	} );

	test( 'restores the saved focused window when it is a suffixed instance', async () => {
		const config = desktopConfig( [
			sessionWindow( { id: 'edit-php', baseId: 'edit-php' } ),
			sessionWindow( { id: 'edit-php-2', baseId: 'edit-php' } ),
		] );
		config.session.focused = 'edit-php-2';

		await restoreSession( manager, config, desktop );

		expect( manager.getFocused()?.id ).toBe( 'edit-php-2' );
	} );

	test( 'single-instance sessions still restore under the plain id', async () => {
		const config = desktopConfig( [ sessionWindow() ] );

		await restoreSession( manager, config, desktop );

		expect( manager.getAll() ).toHaveLength( 1 );
		expect( manager.getAll()[ 0 ].id ).toBe( 'edit-php' );
	} );

	test( 'saved geometry survives — openNew defaults do not override it', async () => {
		const config = desktopConfig( [
			sessionWindow( { id: 'edit-php-2', baseId: 'edit-php', x: 260, y: 160 } ),
		] );

		await restoreSession( manager, config, desktop );

		const snap = manager.getById( 'edit-php-2' )!.getSnapshot();
		expect( snap.x ).toBe( 260 );
		expect( snap.y ).toBe( 160 );
		expect( snap.width ).toBe( 900 );
		expect( snap.height ).toBe( 600 );
	} );
} );

describe( 'WindowManager.openNew — instance id allocation', () => {
	let desktop: HTMLElement;
	let manager: WindowManager;

	beforeEach( () => {
		installHooksStub();
		desktop = document.createElement( 'div' );
		desktop.id = 'desktop-mode-area';
		Object.defineProperty( desktop, 'getBoundingClientRect', {
			value: () =>
				( {
					left: 0,
					top: 0,
					right: 1600,
					bottom: 900,
					width: 1600,
					height: 900,
					x: 0,
					y: 0,
					toJSON: () => ( {} ),
				} ) as DOMRect,
		} );
		document.body.appendChild( desktop );
		manager = new WindowManager( desktop );
	} );

	afterEach( () => {
		for ( const win of manager.getAll() ) {
			win.destroy();
		}
		desktop.remove();
		clearHooksStub();
	} );

	const cfg = ( id: string, baseId: string ) => ( {
		id,
		baseId,
		url: POSTS_URL,
		title: 'Posts',
		icon: 'dashicons-admin-post',
	} );

	test( 'honours a free caller-supplied instance id', async () => {
		const win = await manager.openNew( cfg( 'edit-php-7', 'edit-php' ) );
		expect( win.id ).toBe( 'edit-php-7' );
	} );

	test( 'falls back to the next free slot when the id is taken', async () => {
		await manager.openNew( cfg( 'edit-php-2', 'edit-php' ) );
		const second = await manager.openNew( cfg( 'edit-php-2', 'edit-php' ) );
		expect( second.id ).toBe( 'edit-php' );
		const third = await manager.openNew( cfg( 'edit-php-2', 'edit-php' ) );
		expect( third.id ).toBe( 'edit-php-3' );
	} );

	test( 'plain duplicate requests still get slot allocation', async () => {
		const first = await manager.openNew( cfg( 'edit-php', 'edit-php' ) );
		const second = await manager.openNew( cfg( 'edit-php', 'edit-php' ) );
		expect( first.id ).toBe( 'edit-php' );
		expect( second.id ).toBe( 'edit-php-2' );
	} );
} );
