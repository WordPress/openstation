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
import type { NativeWindowRestoreState } from '../../src/native-windows';
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
		desktop.id = 'os-area';
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
		desktop.id = 'os-area';
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
			url: '#os-settings',
			title: 'OS Settings',
			icon: 'dashicons-desktop',
			...patch,
		} );

	/**
	 * Stand-in for the shell's `openNativeWindowById` — same contract:
	 * resolve the saved instance through a known base id, return false
	 * for anything the registry no longer knows about.
	 */
	const opener = ( known: string[] ) => (
		id: string,
		baseId = id,
		state: NativeWindowRestoreState = {},
	) => {
		if ( ! known.includes( baseId ) ) {
			return false;
		}
		void manager.openNew( {
			id,
			baseId,
			native: true,
			url: `#${ baseId }`,
			title: 'OS Settings',
			icon: 'dashicons-desktop',
			render: ( body: HTMLElement ) => {
				body.textContent = id;
			},
			...state,
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

	test( 'restores multiple native instances through one registered base id', async () => {
		const config = desktopConfig( [
			nativeEntry( {
				id: 'fleet-site',
				baseId: 'fleet-site',
				params: { site: 'alpha' },
			} ),
			nativeEntry( {
				id: 'fleet-site-4',
				baseId: 'fleet-site',
				params: { site: 'bravo' },
			} ),
		] );

		await restoreSession(
			manager,
			config,
			desktop,
			opener( [ 'fleet-site' ] ),
		);

		expect( manager.getAll().map( ( win ) => win.id ).sort() ).toEqual( [
			'fleet-site',
			'fleet-site-4',
		] );
		expect( manager.getById( 'fleet-site' )?.config.params ).toEqual( {
			site: 'alpha',
		} );
		expect( manager.getById( 'fleet-site-4' )?.config.params ).toEqual( {
			site: 'bravo',
		} );
	} );

	test( 'a fresh native instance opened during restore keeps its requested params', async () => {
		const config = desktopConfig( [
			nativeEntry( {
				id: 'fleet-site',
				baseId: 'fleet-site',
				params: { site: 'alpha' },
			} ),
			nativeEntry( {
				id: 'fleet-site-2',
				baseId: 'fleet-site',
				params: { site: 'bravo' },
			} ),
		] );

		const restoring = restoreSession(
			manager,
			config,
			desktop,
			opener( [ 'fleet-site' ] ),
		);
		const fresh = await manager.openNew( {
			id: 'fleet-site',
			baseId: 'fleet-site',
			native: true,
			url: '#fleet-site',
			title: 'Fleet site',
			icon: 'dashicons-admin-site',
			params: { site: 'charlie' },
			render: () => undefined,
		} );
		await restoring;

		expect( fresh.id ).toBe( 'fleet-site-3' );
		expect( fresh.config.params ).toEqual( { site: 'charlie' } );
		expect( manager.getById( 'fleet-site-2' )?.config.params ).toEqual( {
			site: 'bravo',
		} );
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

	test( 'a skipped native restore cannot retarget a later reused instance id', async () => {
		const config = desktopConfig( [
			nativeEntry( {
				id: 'gone-plugin-panel-2',
				baseId: 'gone-plugin-panel',
				params: { site: 'saved-destination' },
			} ),
		] );

		await restoreSession( manager, config, desktop, opener( [] ) );
		await manager.openNew( {
			id: 'gone-plugin-panel',
			baseId: 'gone-plugin-panel',
			native: true,
			url: '#gone-plugin-panel',
			title: 'Panel',
			icon: 'dashicons-admin-generic',
			params: { site: 'first-fresh-destination' },
			render: () => undefined,
		} );
		const reused = await manager.openNew( {
			id: 'gone-plugin-panel',
			baseId: 'gone-plugin-panel',
			native: true,
			url: '#gone-plugin-panel',
			title: 'Panel',
			icon: 'dashicons-admin-generic',
			params: { site: 'second-fresh-destination' },
			render: () => undefined,
		} );

		expect( reused.id ).toBe( 'gone-plugin-panel-2' );
		expect( reused.config.params ).toEqual( {
			site: 'second-fresh-destination',
		} );
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
		desktop.id = 'os-area';
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
		desktop.id = 'os-area';
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

	test( 'concurrent opens reserve ids before lazy bundles settle', async () => {
		const first = manager.openNew( cfg( 'edit-php', 'edit-php' ) );
		const second = manager.openNew( cfg( 'edit-php', 'edit-php' ) );
		const windows = await Promise.all( [ first, second ] );

		expect( windows.map( ( win ) => win.id ) ).toEqual( [
			'edit-php',
			'edit-php-2',
		] );
	} );
} );
