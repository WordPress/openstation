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

describe( 'restoreSession — native windows', () => {
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

	const nativeEntry = ( patch: Partial< SessionWindow > = {} ) =>
		sessionWindow( {
			id: 'desktop-mode-os-settings',
			baseId: 'desktop-mode-os-settings',
			native: true,
			url: '#desktop-mode-os-settings',
			title: 'OS Settings',
			icon: 'dashicons-desktop',
			...patch,
		} );

	/**
	 * Stand-in for the shell's `openNativeWindowById` — same contract:
	 * open the window for known ids, return false for anything the
	 * registry no longer knows about.
	 */
	const opener = ( known: string[] ) => ( id: string ) => {
		if ( ! known.includes( id ) ) {
			return false;
		}
		void manager.open( {
			id,
			baseId: id,
			native: true,
			url: `#${ id }`,
			title: 'OS Settings',
			icon: 'dashicons-desktop',
			render: ( body: HTMLElement ) => {
				body.textContent = id;
			},
		} );
		return true;
	};

	test( 'reopens a saved native window through the opener', async () => {
		const config = desktopConfig( [ nativeEntry() ] );

		await restoreSession(
			manager,
			config,
			desktop,
			opener( [ 'desktop-mode-os-settings' ] ),
		);

		const win = manager.getById( 'desktop-mode-os-settings' );
		expect( win ).toBeDefined();
		expect( win!.config.native ).toBe( true );
	} );

	test( 'applies the saved geometry the opener never passes', async () => {
		const config = desktopConfig( [
			nativeEntry( { x: 240, y: 150, width: 640, height: 520 } ),
		] );

		await restoreSession(
			manager,
			config,
			desktop,
			opener( [ 'desktop-mode-os-settings' ] ),
		);

		const snap = manager.getById( 'desktop-mode-os-settings' )!.getSnapshot();
		expect( snap.x ).toBe( 240 );
		expect( snap.y ).toBe( 150 );
		expect( snap.width ).toBe( 640 );
		expect( snap.height ).toBe( 520 );
	} );

	test( 'restores a native window that was left maximized', async () => {
		const config = desktopConfig( [ nativeEntry( { state: 'maximized' } ) ] );

		await restoreSession(
			manager,
			config,
			desktop,
			opener( [ 'desktop-mode-os-settings' ] ),
		);
		// `applyInitialState` defers a frame so the opening transition
		// doesn't animate from the un-maximized bounds.
		await new Promise< void >( ( resolve ) =>
			requestAnimationFrame( () => resolve() ),
		);

		expect( manager.getById( 'desktop-mode-os-settings' )!.state ).toBe(
			'maximized',
		);
	} );

	test( 'skips a native window whose owner is gone, keeping the rest', async () => {
		const config = desktopConfig( [
			nativeEntry( { id: 'gone-plugin-panel', baseId: 'gone-plugin-panel' } ),
			sessionWindow( { id: 'edit-php', baseId: 'edit-php' } ),
		] );

		await restoreSession(
			manager,
			config,
			desktop,
			opener( [ 'desktop-mode-os-settings' ] ),
		);

		expect( manager.getById( 'gone-plugin-panel' ) ).toBeUndefined();
		expect( manager.getById( 'edit-php' ) ).toBeDefined();
	} );

	test( 'restores native and iframe windows side by side, focus included', async () => {
		const config = desktopConfig( [
			sessionWindow( { id: 'edit-php', baseId: 'edit-php' } ),
			nativeEntry(),
		] );
		config.session.focused = 'desktop-mode-os-settings';

		await restoreSession(
			manager,
			config,
			desktop,
			opener( [ 'desktop-mode-os-settings' ] ),
		);

		expect( manager.getAll() ).toHaveLength( 2 );
		expect( manager.getFocused()?.id ).toBe( 'desktop-mode-os-settings' );
	} );

	test( 'without an opener, native entries are skipped rather than iframed', async () => {
		const config = desktopConfig( [ nativeEntry() ] );

		await restoreSession( manager, config, desktop );

		expect( manager.getAll() ).toHaveLength( 0 );
	} );
} );

describe( 'WindowManager.snapshot — native windows', () => {
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

	test( 'persists a native window with the native marker', async () => {
		await manager.open( {
			id: 'desktop-mode-os-settings',
			baseId: 'desktop-mode-os-settings',
			native: true,
			url: '#os-settings',
			title: 'OS Settings',
			icon: 'dashicons-desktop',
			render: () => undefined,
		} );

		const snap = manager.snapshot();

		expect( snap.windows ).toHaveLength( 1 );
		expect( snap.windows[ 0 ].native ).toBe( true );
		expect( snap.windows[ 0 ].id ).toBe( 'desktop-mode-os-settings' );
		expect( snap.focused ).toBe( 'desktop-mode-os-settings' );
	} );

	test( 'still skips ephemeral windows', async () => {
		await manager.open( {
			id: 'editor-preview-1',
			baseId: 'editor-preview-1',
			ephemeral: true,
			url: `${ ORIGIN }/?p=1&preview=true`,
			title: 'Preview',
			icon: 'dashicons-visibility',
		} );

		const snap = manager.snapshot();

		expect( snap.windows ).toHaveLength( 0 );
		expect( snap.focused ).toBe( '' );
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
