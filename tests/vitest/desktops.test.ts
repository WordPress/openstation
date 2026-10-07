import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { restoreSession } from '../../src/boot/session';
import { WindowManager } from '../../src/window-manager';
import { closeDesktop } from '../../src/window-manager/desktops';
import { HOOKS } from '../../src/hooks';
import type { DesktopConfig, Session } from '../../src/types';
import {
	clearHooksStub,
	installHooksStub,
	recordActions,
	type FakeWpHooks,
} from './helpers/hooks-stub';

const DESKTOP_HOOKS = [
	'os.os.created',
	'os.os.closed',
	'os.os.switched',
] as const;

function openConfig( id: string ) {
	return {
		id,
		url: `http://example.test/wp-admin/${ id }.php`,
		title: id,
		icon: 'dashicons-admin-generic',
	};
}

function dispatchOpacityTransitionEnd( el: HTMLElement ): void {
	const event = new Event( 'transitionend' ) as TransitionEvent;
	Object.defineProperty( event, 'propertyName', { value: 'opacity' } );
	el.dispatchEvent( event );
}

describe( 'WindowManager — virtual desktops', async () => {
	let hooks: FakeWpHooks;
	let desktopArea: HTMLElement;
	let manager: WindowManager;

	beforeEach( async () => {
		hooks = installHooksStub();
		desktopArea = document.createElement( 'div' );
		Object.defineProperty( desktopArea, 'getBoundingClientRect', {
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
		Object.defineProperty( desktopArea, 'clientWidth', { value: 1600, configurable: true } );
		Object.defineProperty( desktopArea, 'clientHeight', { value: 900, configurable: true } );
		document.body.appendChild( desktopArea );
		manager = new WindowManager( desktopArea );
	} );

	afterEach( async () => {

		manager.destroy();
		vi.useRealTimers();
		for ( const win of manager.getAll() ) {
			win.destroy();
		}
		desktopArea.remove();
		clearHooksStub();
	} );

	test( 'starts with a single default desktop named "Workspace 1"', async () => {
		const list = manager.getDesktops();
		expect( list ).toHaveLength( 1 );
		expect( list[ 0 ].id ).toBe( 'desktop-1' );
		expect( list[ 0 ].label ).toBe( 'Workspace 1' );
		expect( manager.getActiveDesktopId() ).toBe( 'desktop-1' );
	} );

	test( 'createDesktop appends + fires desktop.created with the new id', async () => {
		const log = recordActions( hooks, DESKTOP_HOOKS );

		const created = manager.createDesktop();

		expect( manager.getDesktops().map( ( d ) => d.id ) ).toEqual( [
			'desktop-1',
			created.id,
		] );
		expect( created.id ).toBe( 'desktop-2' );
		expect( created.label ).toBe( 'Workspace 2' );

		const evt = log.find( ( e ) => e.name === 'os.os.created' );
		expect( evt ).toBeDefined();
		expect(
			( evt!.args[ 0 ] as { desktopId: string } ).desktopId,
		).toBe( created.id );
	} );

	test( 'newly opened windows join the currently active desktop', async () => {
		const a = await manager.open( openConfig( 'a' ) );
		const second = manager.createDesktop();
		manager.switchDesktop( second.id );
		const b = await manager.open( openConfig( 'b' ) );

		expect( a.config.desktopId ).toBe( 'desktop-1' );
		expect( b.config.desktopId ).toBe( second.id );
	} );

	test( 'switchDesktop hides previous desktop windows + shows new ones', async () => {
		const a = await manager.open( openConfig( 'a' ) );
		const second = manager.createDesktop();
		manager.switchDesktop( second.id );
		const b = await manager.open( openConfig( 'b' ) );

		expect( a.element.style.display ).toBe( 'none' );
		expect( b.element.style.display ).toBe( '' );

		manager.switchDesktop( 'desktop-1' );

		expect( a.element.style.display ).toBe( '' );
		expect( b.element.style.display ).toBe( 'none' );
	} );

	test( 'moveWindowToDesktop re-homes one window, shows or hides it at once, fires window-moved', async () => {
		const a = await manager.open( openConfig( 'a' ) );
		const second = manager.createDesktop();
		const log = recordActions( hooks, [ 'os.os.window-moved' ] );

		expect( manager.moveWindowToDesktop( 'a', second.id ) ).toBe( true );
		expect( a.config.desktopId ).toBe( second.id );
		expect( a.element.style.display ).toBe( 'none' );
		expect( log ).toEqual( [
			{ name: 'os.os.window-moved', args: [ { windowId: 'a', from: 'desktop-1', to: second.id } ] },
		] );

		expect( manager.moveWindowToDesktop( 'a', 'desktop-1' ) ).toBe( true );
		expect( a.element.style.display ).toBe( '' );
		expect( log ).toHaveLength( 2 );

		expect( manager.moveWindowToDesktop( 'a', 'desktop-1' ) ).toBe( true );
		expect( log ).toHaveLength( 2 );

		expect( manager.moveWindowToDesktop( 'nope', second.id ) ).toBe( false );
		expect( manager.moveWindowToDesktop( 'a', 'desktop-99' ) ).toBe( false );
		expect( a.config.desktopId ).toBe( 'desktop-1' );
	} );

	test( 'switchDesktop fires desktop.switched with from + to ids', async () => {
		const second = manager.createDesktop();
		const log = recordActions( hooks, DESKTOP_HOOKS );

		manager.switchDesktop( second.id );

		const evt = log.find( ( e ) => e.name === 'os.os.switched' );
		expect( evt ).toBeDefined();
		const payload = evt!.args[ 0 ] as { from: string; to: string };
		expect( payload.from ).toBe( 'desktop-1' );
		expect( payload.to ).toBe( second.id );
	} );

	test( 'switchDesktop is a no-op when target is already active', async () => {
		const log = recordActions( hooks, DESKTOP_HOOKS );

		manager.switchDesktop( 'desktop-1' );

		expect(
			log.some( ( e ) => e.name === 'os.os.switched' ),
		).toBe( false );
	} );

	test( 'switchDesktop ignores unknown ids', async () => {
		const log = recordActions( hooks, DESKTOP_HOOKS );

		manager.switchDesktop( 'nope' );

		expect(
			log.some( ( e ) => e.name === 'os.os.switched' ),
		).toBe( false );
		expect( manager.getActiveDesktopId() ).toBe( 'desktop-1' );
	} );

	test( 'closeDesktop migrates windows to the left-neighbour and fires .closed', async () => {
		const a = await manager.open( openConfig( 'a' ) );
		const second = manager.createDesktop();
		manager.switchDesktop( second.id );
		const b = await manager.open( openConfig( 'b' ) );
		const log = recordActions( hooks, DESKTOP_HOOKS );

		manager.closeDesktop( second.id );

		expect( b.config.desktopId ).toBe( 'desktop-1' );
		expect( manager.getActiveDesktopId() ).toBe( 'desktop-1' );
		expect( a.element.style.display ).toBe( '' );
		expect( b.element.style.display ).toBe( '' );

		const evt = log.find( ( e ) => e.name === 'os.os.closed' );
		expect( evt ).toBeDefined();
		const payload = evt!.args[ 0 ] as { desktopId: string; migratedTo: string };
		expect( payload.desktopId ).toBe( second.id );
		expect( payload.migratedTo ).toBe( 'desktop-1' );

		expect( log.map( ( e ) => e.name ) ).toEqual( [
			'os.os.closed',
			'os.os.switched',
		] );
		expect( log[ 1 ].args[ 0 ] ).toEqual( {
			from: second.id,
			to: 'desktop-1',
		} );
	} );

	test( 'closing the leftmost desktop migrates to the right-neighbour', async () => {
		const second = manager.createDesktop();
		const a = await manager.open( openConfig( 'a' ) );
		manager.switchDesktop( second.id );

		manager.closeDesktop( 'desktop-1' );

		expect( a.config.desktopId ).toBe( second.id );
		expect( manager.getActiveDesktopId() ).toBe( second.id );
	} );

	test( 'cannot close the last remaining desktop', async () => {
		const log = recordActions( hooks, DESKTOP_HOOKS );

		manager.closeDesktop( 'desktop-1' );

		expect( manager.getDesktops() ).toHaveLength( 1 );
		expect(
			log.some( ( e ) => e.name === 'os.os.closed' ),
		).toBe( false );
	} );

	test( 'closing a non-active desktop does not change the active id', async () => {
		manager.createDesktop();
		const third = manager.createDesktop();

		const log = recordActions( hooks, DESKTOP_HOOKS );

		manager.closeDesktop( third.id );

		expect( manager.getActiveDesktopId() ).toBe( 'desktop-1' );
		expect(
			log.some( ( e ) => e.name === 'os.os.switched' ),
		).toBe( false );
		expect( manager.getDesktops().map( ( d ) => d.id ) ).toEqual( [
			'desktop-1',
			'desktop-2',
		] );
	} );

	test( 'closing the active desktop while in overview re-lays out the survivor', async () => {

		await manager.open( openConfig( 'a' ) );
		await manager.open( openConfig( 'b' ) );
		const second = manager.createDesktop();
		manager.switchDesktop( second.id );
		const c = await manager.open( openConfig( 'c' ) );
		manager.switchDesktop( 'desktop-1' );

		manager.enterOverview();
		const a = manager.getById( 'a' )!;
		const b = manager.getById( 'b' )!;
		expect( a.element.classList.contains( 'os-window--overview' ) ).toBe( true );
		expect( b.element.classList.contains( 'os-window--overview' ) ).toBe( true );

		expect( c.element.style.display ).toBe( 'none' );
		expect( c.element.classList.contains( 'os-window--overview' ) ).toBe( false );

		manager.closeDesktop( 'desktop-1' );

		expect( manager.getActiveDesktopId() ).toBe( second.id );
		expect( a.config.desktopId ).toBe( second.id );
		expect( b.config.desktopId ).toBe( second.id );

		expect( a.element.style.display ).toBe( '' );
		expect( b.element.style.display ).toBe( '' );
		expect( c.element.style.display ).toBe( '' );
		expect( a.element.classList.contains( 'os-window--overview' ) ).toBe( true );
		expect( b.element.classList.contains( 'os-window--overview' ) ).toBe( true );
		expect( c.element.classList.contains( 'os-window--overview' ) ).toBe( true );
	} );

	test( 'enterOverview shows minimized windows in grid without restoring them', async () => {

		const a = await manager.open( openConfig( 'a' ) );
		const b = await manager.open( openConfig( 'b' ) );
		a.minimize();
		b.minimize();
		expect( a.state ).toBe( 'minimized' );
		expect( b.state ).toBe( 'minimized' );

		manager.enterOverview();

		expect( a.state ).toBe( 'minimized' );
		expect( b.state ).toBe( 'minimized' );

		expect(
			a.element.classList.contains( 'os-window--overview' ),
		).toBe( true );
		expect(
			b.element.classList.contains( 'os-window--overview' ),
		).toBe( true );
	} );

	test( 'enterOverview makes completed-minimize windows renderable for thumbnails', async () => {

		const a = await manager.open( openConfig( 'a' ) );
		a.minimize();
		dispatchOpacityTransitionEnd( a.element );
		expect( a.element.style.getPropertyValue( 'content-visibility' ) ).toBe(
			'hidden',
		);
		if ( a.iframe ) {
			expect( a.iframe.style.visibility ).toBe( 'hidden' );
		}

		manager.enterOverview();

		expect( a.element.style.getPropertyValue( 'content-visibility' ) ).toBe(
			'',
		);
		if ( a.iframe ) {
			expect( a.iframe.style.visibility ).toBe( '' );
		}
		expect(
			a.element.classList.contains( 'os-window--overview' ),
		).toBe( true );
	} );

	test( 'pending minimize transition does not re-hide an overview thumbnail', async () => {

		const a = await manager.open( openConfig( 'a' ) );
		a.minimize();

		manager.enterOverview();
		dispatchOpacityTransitionEnd( a.element );

		expect( a.element.style.getPropertyValue( 'content-visibility' ) ).toBe(
			'',
		);
		if ( a.iframe ) {
			expect( a.iframe.style.visibility ).toBe( '' );
		}
		expect(
			a.element.classList.contains( 'os-window--overview' ),
		).toBe( true );
	} );

	test( 'selecting a minimized fullscreen thumbnail restores fullscreen class before restore', async () => {

		const a = await manager.open( openConfig( 'a' ) );
		a.toggleFullscreen();
		a.minimize();

		manager.enterOverview();
		expect( a.state ).toBe( 'minimized' );
		expect(
			a.element.classList.contains( 'os-window--fullscreen' ),
		).toBe( false );

		manager.exitOverview( a );

		expect( a.state ).toBe( 'fullscreen' );
		expect(
			a.element.classList.contains( 'os-window--fullscreen' ),
		).toBe( true );
		expect(
			document.body.classList.contains( 'os-has-fullscreen-window' ),
		).toBe( true );
		expect( a.element.dataset.osHadFullscreenBeforeOverview ).toBeUndefined();
	} );

	test( 'canceling overview preserves a visible fullscreen window', async () => {
		vi.useFakeTimers();
		const a = await manager.open( openConfig( 'a' ) );
		a.toggleFullscreen();
		const fullscreenActions = recordActions( hooks, [
			HOOKS.WINDOW_FULLSCREEN_ENTERED,
			HOOKS.WINDOW_FULLSCREEN_EXITED,
		] );

		manager.enterOverview();
		expect( a.state ).toBe( 'fullscreen' );
		expect(
			a.element.classList.contains( 'os-window--fullscreen' ),
		).toBe( false );
		expect(
			document.body.classList.contains( 'os-has-fullscreen-window' ),
		).toBe( false );
		expect( a.element.dataset.osHadFullscreenBeforeOverview ).toBe( 'true' );
		manager.exitOverview();

		expect( a.state ).toBe( 'fullscreen' );
		expect(
			a.element.classList.contains( 'os-window--fullscreen' ),
		).toBe( false );
		expect(
			document.body.classList.contains( 'os-has-fullscreen-window' ),
		).toBe( false );

		vi.advanceTimersByTime( 280 );

		expect(
			a.element.classList.contains( 'os-window--fullscreen' ),
		).toBe( true );
		expect(
			document.body.classList.contains( 'os-has-fullscreen-window' ),
		).toBe( true );
		expect( a.element.dataset.osHadFullscreenBeforeOverview ).toBeUndefined();
		expect( fullscreenActions ).toHaveLength( 0 );
	} );

	test( 'selecting a fullscreen thumbnail preserves fullscreen state', async () => {
		vi.useFakeTimers();
		const a = await manager.open( openConfig( 'a' ) );
		a.toggleFullscreen();

		manager.enterOverview();
		manager.exitOverview( a );

		expect( a.state ).toBe( 'fullscreen' );
		expect(
			a.element.classList.contains( 'os-window--fullscreen' ),
		).toBe( false );

		vi.advanceTimersByTime( 280 );

		expect(
			a.element.classList.contains( 'os-window--fullscreen' ),
		).toBe( true );
		expect(
			document.body.classList.contains( 'os-has-fullscreen-window' ),
		).toBe( true );
		expect( a.element.dataset.osHadFullscreenBeforeOverview ).toBeUndefined();
	} );

	test( 'selecting another window clears a stale fullscreen marker', async () => {
		vi.useFakeTimers();
		const a = await manager.open( openConfig( 'a' ) );
		const b = await manager.open( openConfig( 'b' ) );
		manager.focus( a );
		a.toggleFullscreen();

		manager.enterOverview();
		expect( a.state ).toBe( 'fullscreen' );
		expect(
			a.element.classList.contains( 'os-window--fullscreen' ),
		).toBe( false );

		manager.exitOverview( b );
		expect( a.state ).toBe( 'normal' );
		expect(
			a.element.classList.contains( 'os-window--fullscreen' ),
		).toBe( false );

		vi.advanceTimersByTime( 280 );

		expect( a.state ).toBe( 'normal' );
		expect(
			a.element.classList.contains( 'os-window--fullscreen' ),
		).toBe( false );
		expect(
			document.body.classList.contains( 'os-has-fullscreen-window' ),
		).toBe( false );
		expect( a.element.dataset.osHadFullscreenBeforeOverview ).toBeUndefined();
	} );

	test( 'fullscreen styling stays suspended on an inactive desktop after overview', async () => {
		vi.useFakeTimers();
		const a = await manager.open( openConfig( 'a' ) );
		const second = manager.createDesktop();
		a.toggleFullscreen();

		manager.enterOverview();
		manager.switchDesktop( second.id );
		manager.exitOverview();
		vi.advanceTimersByTime( 280 );

		expect( a.state ).toBe( 'fullscreen' );
		expect( a.element.style.display ).toBe( 'none' );
		expect(
			a.element.classList.contains( 'os-window--fullscreen' ),
		).toBe( false );
		expect(
			document.body.classList.contains( 'os-has-fullscreen-window' ),
		).toBe( false );
		expect( a.element.dataset.osHadFullscreenBeforeOverview ).toBe( 'true' );

		manager.switchDesktop( 'desktop-1' );

		expect( a.element.style.display ).toBe( '' );
		expect(
			a.element.classList.contains( 'os-window--fullscreen' ),
		).toBe( true );
		expect(
			document.body.classList.contains( 'os-has-fullscreen-window' ),
		).toBe( true );
		expect( a.element.dataset.osHadFullscreenBeforeOverview ).toBeUndefined();
	} );

	test( 're-entering overview mid-exit does not re-fullscreen a thumbnail', async () => {

		vi.useFakeTimers();
		const a = await manager.open( openConfig( 'a' ) );
		a.toggleFullscreen();

		manager.enterOverview();
		manager.exitOverview();
		vi.advanceTimersByTime( 100 );
		manager.enterOverview();

		expect( a.element.dataset.osHadFullscreenBeforeOverview ).toBe( 'true' );

		vi.advanceTimersByTime( 280 );

		expect( manager._overviewActive ).toBe( true );
		expect(
			a.element.classList.contains( 'os-window--fullscreen' ),
		).toBe( false );
		expect(
			document.body.classList.contains( 'os-has-fullscreen-window' ),
		).toBe( false );

		expect( a.element.classList.contains( 'os-window--overview' ) ).toBe(
			true,
		);

		manager.exitOverview();
		vi.advanceTimersByTime( 280 );

		expect(
			a.element.classList.contains( 'os-window--fullscreen' ),
		).toBe( true );
		expect( a.element.dataset.osHadFullscreenBeforeOverview ).toBeUndefined();
	} );

	test( 're-entering overview mid-exit settles the outgoing session first', async () => {
		vi.useFakeTimers();
		await manager.open( openConfig( 'a' ) );
		const log = recordActions( hooks, [
			HOOKS.OVERVIEW_EXITED,
			HOOKS.OVERVIEW_ENTERING,
		] );

		manager.enterOverview();
		const firstTopBar = manager._overviewTopBar;
		manager.exitOverview();
		vi.advanceTimersByTime( 100 );
		manager.enterOverview();

		expect( log.map( ( e ) => e.name ) ).toEqual( [
			HOOKS.OVERVIEW_ENTERING,
			HOOKS.OVERVIEW_EXITED,
			HOOKS.OVERVIEW_ENTERING,
		] );

		expect( firstTopBar?.isConnected ).toBe( false );
		expect(
			desktopArea.querySelectorAll( '.os-overview-top-bar' ),
		).toHaveLength( 1 );

		vi.advanceTimersByTime( 280 );
		expect( manager._overviewTopBar?.isConnected ).toBe( true );
	} );

	test( 'Enter key in overview exits without selecting a window', async () => {
		await manager.open( openConfig( 'a' ) );
		manager.enterOverview();
		expect( manager._overviewActive ).toBe( true );

		document.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Enter' } ),
		);

		expect( manager._overviewActive ).toBe( false );
	} );

	test( 'enterOverview includes minimized windows in the grid thumbnails', async () => {

		const a = await manager.open( openConfig( 'a' ) );
		const b = await manager.open( openConfig( 'b' ) );
		const c = await manager.open( openConfig( 'c' ) );
		a.minimize();
		expect( a.state ).toBe( 'minimized' );

		manager.enterOverview();

		expect( a.state ).toBe( 'minimized' );
		expect( b.state ).toBe( 'normal' );
		expect( c.state ).toBe( 'normal' );

		const gridTiles = manager._desktop.querySelectorAll< HTMLElement >(
			'.os-window--overview',
		);
		expect( gridTiles ).toHaveLength( 3 );

		const badge = manager._overviewTopBar!.querySelector(
			'.os-overview-top-bar__tile-count',
		);
		expect( badge ).not.toBeNull();
		expect( Number( badge!.textContent ) ).toBe( gridTiles.length );
	} );

	test( 'snapshot preserves geometry for windows on non-active desktops', async () => {

		const a = await manager.open( openConfig( 'a' ) );

		a.element.style.left = '180px';
		a.element.style.top = '120px';
		a.element.style.width = '640px';
		a.element.style.height = '480px';

		const second = manager.createDesktop();
		manager.switchDesktop( second.id );

		expect( a.element.style.display ).toBe( 'none' );

		const snap = manager.snapshot();
		const aEntry = snap.windows.find( ( w ) => w.id === 'a' )!;
		expect( aEntry.x ).toBe( 180 );
		expect( aEntry.y ).toBe( 120 );
		expect( aEntry.width ).toBe( 640 );
		expect( aEntry.height ).toBe( 480 );
	} );

	test( 'snapshot skips ephemeral windows — even when focused', async () => {
		await manager.open( openConfig( 'a' ) );
		const preview = await manager.open( {
			...openConfig( 'editor-preview-post-1' ),
			ephemeral: true,
		} );
		manager.focus( preview );

		const snap = manager.snapshot();

		expect(
			snap.windows.some( ( w ) => w.id === 'editor-preview-post-1' ),
		).toBe( false );
		expect( snap.windows.some( ( w ) => w.id === 'a' ) ).toBe( true );
		expect( snap.focused ).toBe( '' );
	} );

	test( 'snapshot stamps `updated` in epoch milliseconds', async () => {
		await manager.open( openConfig( 'a' ) );

		const before = Date.now();
		const snap = manager.snapshot();
		const after = Date.now();

		expect( snap.updated ).toBeGreaterThanOrEqual( before );
		expect( snap.updated ).toBeLessThanOrEqual( after );
	} );

	test( 'getAllByBaseIdOnActiveDesktop filters getAllByBaseId to the active desktop', async () => {
		const a = await manager.open( {
			id: 'multi-app',
			baseId: 'multi-app',
			url: 'http://example.test/wp-admin/multi-app.php',
			title: 'multi-app',
			icon: 'dashicons-admin-generic',
		} );
		const second = manager.createDesktop();
		manager.switchDesktop( second.id );
		const b = await manager.open( {
			id: 'multi-app',
			baseId: 'multi-app',
			url: 'http://example.test/wp-admin/multi-app.php',
			title: 'multi-app',
			icon: 'dashicons-admin-generic',
		} );

		expect( manager.getAllByBaseId( 'multi-app' ) ).toHaveLength( 2 );

		expect( manager.getAllByBaseIdOnActiveDesktop( 'multi-app' ) ).toEqual( [ b ] );

		manager.switchDesktop( 'desktop-1' );

		expect( manager.getAllByBaseIdOnActiveDesktop( 'multi-app' ) ).toEqual( [ a ] );
	} );

	test( 'isActive stops reporting true once its desktop is no longer active', async () => {

		const a = await manager.open( openConfig( 'a' ) );
		expect( manager.isActive( 'a' ) ).toBe( true );

		const second = manager.createDesktop();
		manager.switchDesktop( second.id );

		expect( manager.isActive( 'a' ) ).toBe( false );

		manager.switchDesktop( 'desktop-1' );

		expect( manager.isActive( 'a' ) ).toBe( true );
	} );

	test( 'isActiveByBaseId matches any instance of baseId, scoped to the active desktop', async () => {
		const multiConfig = () => ( {
			id: 'multi-app',
			baseId: 'multi-app',
			url: 'http://example.test/wp-admin/multi-app.php',
			title: 'multi-app',
			icon: 'dashicons-admin-generic',
		} );
		const a = await manager.open( multiConfig() );
		expect( manager.isActiveByBaseId( 'multi-app' ) ).toBe( true );

		const second = manager.createDesktop();
		manager.switchDesktop( second.id );
		expect( manager.isActiveByBaseId( 'multi-app' ) ).toBe( false );

		const b = await manager.open( multiConfig() );
		expect( b.id ).not.toBe( a.id );
		expect( manager.isActiveByBaseId( 'multi-app' ) ).toBe( true );
	} );

	test( 'minimizeAll only minimizes windows on the active desktop', async () => {
		const a = await manager.open( openConfig( 'a' ) );
		const second = manager.createDesktop();
		manager.switchDesktop( second.id );
		const b = await manager.open( openConfig( 'b' ) );

		const minimized = manager.minimizeAll();

		expect( minimized ).toEqual( [ b ] );
		expect( b.state ).toBe( 'minimized' );
		expect( a.state ).toBe( 'normal' );
	} );

	test( 'restoreFrom skips windows whose desktop is no longer active', async () => {
		const a = await manager.open( openConfig( 'a' ) );
		a.minimize();
		expect( a.state ).toBe( 'minimized' );

		const second = manager.createDesktop();
		manager.switchDesktop( second.id );

		manager.restoreFrom( [ a ] );
		expect( a.state ).toBe( 'minimized' );

		manager.switchDesktop( 'desktop-1' );
		manager.restoreFrom( [ a ] );
		expect( a.state ).toBe( 'normal' );
	} );

	test( 'toggleShowDesktop only affects windows on the active desktop', async () => {
		const a = await manager.open( openConfig( 'a' ) );
		const second = manager.createDesktop();
		manager.switchDesktop( second.id );
		const b = await manager.open( openConfig( 'b' ) );

		expect( manager.toggleShowDesktop() ).toBe( true );
		expect( b.state ).toBe( 'minimized' );
		expect( a.state ).toBe( 'normal' );

		expect( manager.toggleShowDesktop() ).toBe( false );
		expect( b.state ).toBe( 'normal' );
	} );

	describe( 'Overview inert + tile structure', () => {

		test( 'enterOverview inerts background chrome, exitOverview restores it', async () => {
			const toRemove: HTMLElement[] = [];

			try {
				const adminMenu = document.createElement( 'div' );
				adminMenu.id = 'adminmenumain';
				document.body.appendChild( adminMenu );
				toRemove.push( adminMenu );
				const adminBack = document.createElement( 'div' );
				adminBack.id = 'adminmenuback';
				document.body.appendChild( adminBack );
				toRemove.push( adminBack );
				const dock = document.createElement( 'div' );
				dock.id = 'os-dock';
				document.body.appendChild( dock );
				toRemove.push( dock );
				const sideDock = document.createElement( 'div' );
				sideDock.id = 'os-side-dock';
				document.body.appendChild( sideDock );
				toRemove.push( sideDock );
				const widgets = document.createElement( 'div' );
				widgets.id = 'os-widgets';
				document.body.appendChild( widgets );
				toRemove.push( widgets );

				const wpbody = document.createElement( 'div' );
				wpbody.id = 'wpbody-content';
				document.body.appendChild( wpbody );
				toRemove.push( wpbody );
				const notice = document.createElement( 'div' );
				notice.className = 'notice';
				wpbody.appendChild( notice );

				const a = await manager.open( openConfig( 'a' ) );
				const b = await manager.open( openConfig( 'b' ) );

				expect( a.element.inert ).toBeFalsy();

				manager.enterOverview();

				expect( adminMenu.inert ).toBe( true );
				expect( adminBack.inert ).toBe( true );
				expect( dock.inert ).toBe( true );
				expect( sideDock.inert ).toBe( true );
				expect( widgets.inert ).toBe( true );
				expect( notice.inert ).toBe( true );

				expect( a.element.inert ).toBeFalsy();
				expect( b.element.inert ).toBeFalsy();
				expect( ( a.element.children[ 0 ] as HTMLElement ).inert ).toBe( true );
				expect( ( b.element.children[ 0 ] as HTMLElement ).inert ).toBe( true );

				manager.exitOverview();

				expect( adminMenu.inert ).toBe( false );
				expect( adminBack.inert ).toBe( false );
				expect( dock.inert ).toBe( false );
				expect( sideDock.inert ).toBe( false );
				expect( widgets.inert ).toBe( false );
				expect( notice.inert ).toBe( false );
				expect( a.element.inert ).toBeFalsy();
				expect( b.element.inert ).toBeFalsy();
				expect( ( a.element.children[ 0 ] as HTMLElement ).inert ).toBe( false );
				expect( ( b.element.children[ 0 ] as HTMLElement ).inert ).toBe( false );
			} finally {
				for ( const el of toRemove ) {
					el.remove();
				}
			}
		} );

		test( 'clicking a window thumbnail in overview selects and focuses it without forcing maximize', async () => {
			const a = await manager.open( openConfig( 'a' ) );
			const b = await manager.open( openConfig( 'b' ) );
			expect( manager.getFocused() ).toBe( b );
			expect( a.state ).toBe( 'normal' );
			expect( b.state ).toBe( 'normal' );

			manager.enterOverview();
			expect( manager._overviewActive ).toBe( true );

			vi.spyOn( a.element, 'getBoundingClientRect' ).mockReturnValue(
				new DOMRect( 100, 100, 200, 150 ),
			);

			a.element.dispatchEvent(
				new MouseEvent( 'pointerdown', {
					bubbles: true,
					cancelable: true,
					button: 0,
					clientX: 150,
					clientY: 150,
				} ),
			);
			a.element.dispatchEvent(
				new MouseEvent( 'pointerup', {
					bubbles: true,
					cancelable: true,
					button: 0,
					clientX: 150,
					clientY: 150,
				} ),
			);

			expect( manager._overviewActive ).toBe( false );
			expect( manager.getFocused() ).toBe( a );
			expect( a.state ).toBe( 'normal' );
		} );

		test( 'each desktop tile has a wrapper with three sibling buttons', async () => {
			const extraDesktops = [ manager.createDesktop(), manager.createDesktop() ];
			try {
				await manager.open( openConfig( 'a' ) );
				manager.enterOverview();

				const wrappers = Array.from(
					manager._overviewTopBar!.querySelectorAll(
						'.os-overview-top-bar__tile-wrapper',
					),
				);

				expect( wrappers ).toHaveLength( 4 );

				const deskWrappers = wrappers.filter(
					( w ) =>
						! w.classList.contains(
							'os-overview-top-bar__tile-wrapper--add',
						),
				);
				expect( deskWrappers ).toHaveLength( 3 );

				for ( const wrapper of deskWrappers ) {
					expect(
						Array.from( wrapper.querySelectorAll( 'button' ) ).map(
							( b ) => b.classList[ 0 ],
						),
					).toEqual( [
						'os-overview-top-bar__tile',
						'os-overview-top-bar__tile-edit',
						'os-overview-top-bar__tile-close',
					] );
				}

				const addWrapper = wrappers.find( ( w ) =>
					w.classList.contains(
						'os-overview-top-bar__tile-wrapper--add',
					),
				)!;
				expect(
					Array.from( addWrapper.querySelectorAll( 'button' ) ).map(
						( b ) => b.classList[ 1 ],
					),
				).toEqual( [ 'os-overview-top-bar__tile--add' ] );
			} finally {
				for ( const d of extraDesktops ) {
					closeDesktop( manager, d.id );
				}
			}
		} );

		test( 'Enter on a focused button does not exit overview', async () => {
			await manager.open( openConfig( 'a' ) );
			manager.enterOverview();

			const closeBtn = manager._overviewTopBar!.querySelector< HTMLElement >(
				'.os-overview-top-bar__tile-close',
			)!;
			closeBtn.focus();
			expect( document.activeElement ).toBe( closeBtn );

			document.dispatchEvent(
				new KeyboardEvent( 'keydown', { key: 'Enter' } ),
			);

			expect( manager._overviewActive ).toBe( true );
			manager.exitOverview();
		} );

		test( 'enterOverview tolerates missing wpbody-content', async () => {
			await manager.open( openConfig( 'a' ) );
			expect( () => manager.enterOverview() ).not.toThrow();
			manager.exitOverview();
		} );
	} );
} );

describe( 'WindowManager — destroy()', async () => {
	let hooks: FakeWpHooks;
	let desktopArea: HTMLElement;
	let manager: WindowManager;

	beforeEach( async () => {
		hooks = installHooksStub();
		desktopArea = document.createElement( 'div' );
		Object.defineProperty( desktopArea, 'getBoundingClientRect', {
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
		Object.defineProperty( desktopArea, 'clientWidth', { value: 1600, configurable: true } );
		Object.defineProperty( desktopArea, 'clientHeight', { value: 900, configurable: true } );
		document.body.appendChild( desktopArea );
		manager = new WindowManager( desktopArea );
	} );

	afterEach( async () => {
		vi.useRealTimers();
		for ( const win of manager.getAll() ) {
			win.destroy();
		}
		desktopArea.remove();
		clearHooksStub();
	} );

	test( 'cancels the pending "entered" timer left by an un-exited enterOverview()', async () => {
		vi.useFakeTimers();
		manager.enterOverview();
		expect( manager._overviewEnterTimeoutId ).not.toBeNull();

		manager.destroy();
		expect( manager._overviewEnterTimeoutId ).toBeNull();

		clearHooksStub();
		vi.advanceTimersByTime( 1000 );
	} );

	test( 'cancels the pending "exited" timer left by an un-awaited exitOverview()', async () => {
		vi.useFakeTimers();
		manager.enterOverview();
		vi.advanceTimersByTime( 1000 );
		manager.exitOverview();
		expect( manager._overviewExitTimeoutId ).not.toBeNull();

		manager.destroy();
		expect( manager._overviewExitTimeoutId ).toBeNull();

		clearHooksStub();
		vi.advanceTimersByTime( 1000 );
	} );

	test( 'synchronously exits overview when destroyed mid-session', async () => {
		manager.enterOverview();
		expect( manager._overviewActive ).toBe( true );

		manager.destroy();

		expect( manager._overviewActive ).toBe( false );
		expect( hooks.didAction( 'os.overview.exiting' ) ).toBe( 1 );
	} );

	test( 'is a no-op when overview was never entered', async () => {
		expect( () => manager.destroy() ).not.toThrow();
		expect( manager._overviewActive ).toBe( false );
	} );
} );

describe( 'WindowManager — cross-desktop window focus', () => {
	let hooks: FakeWpHooks;
	let desktopArea: HTMLElement;
	let manager: WindowManager;

	beforeEach( async () => {
		hooks = installHooksStub();
		desktopArea = document.createElement( 'div' );
		Object.defineProperty( desktopArea, 'getBoundingClientRect', {
			value: () => ( {
				left: 0,
				top: 0,
				right: 1600,
				bottom: 900,
				width: 1600,
				height: 900,
			} ),
		} );
		Object.defineProperty( desktopArea, 'clientWidth', { value: 1600 } );
		Object.defineProperty( desktopArea, 'clientHeight', { value: 900 } );
		document.body.appendChild( desktopArea );
		manager = new WindowManager( desktopArea );
	} );

	afterEach( () => {
		manager.destroy();
		desktopArea.remove();
		clearHooksStub();
	} );

	test( 'focusing a window on an inactive desktop switches to that desktop and focuses it', async () => {
		const win1 = await manager.open( openConfig( 'win1' ) );
		expect( manager.getActiveDesktopId() ).toBe( 'desktop-1' );
		expect( win1.isFocused() ).toBe( true );

		const second = manager.createDesktop();
		manager.switchDesktop( second.id );

		const win2 = await manager.open( openConfig( 'win2' ) );
		expect( manager.getActiveDesktopId() ).toBe( second.id );
		expect( win2.isFocused() ).toBe( true );
		expect( win2.element.style.display ).toBe( '' );

		manager.switchDesktop( 'desktop-1' );
		expect( manager.getActiveDesktopId() ).toBe( 'desktop-1' );
		expect( win1.element.style.display ).toBe( '' );
		expect( win2.element.style.display ).toBe( 'none' );

		manager.focus( win2 );

		expect( manager.getActiveDesktopId() ).toBe( second.id );
		expect( win2.isFocused() ).toBe( true );
		expect( win2.element.style.display ).toBe( '' );
		expect( win1.element.style.display ).toBe( 'none' );
		expect( win1.isFocused() ).toBe( false );
	} );

	test( 'minimizing the last window on the active desktop does NOT switch to another desktop', async () => {
		const second = manager.createDesktop();
		manager.switchDesktop( second.id );
		const win2 = await manager.open( openConfig( 'win2' ) );

		manager.switchDesktop( 'desktop-1' );
		const win1 = await manager.open( openConfig( 'win1' ) );
		expect( manager.getActiveDesktopId() ).toBe( 'desktop-1' );

		win1.minimize();

		expect( manager.getActiveDesktopId() ).toBe( 'desktop-1' );
		expect( win1.state ).toBe( 'minimized' );
		expect( win2.element.style.display ).toBe( 'none' );
	} );

	test( 'focusing a window on another desktop while overview is active updates active desktop in overview', async () => {
		const second = manager.createDesktop();
		manager.switchDesktop( second.id );
		const win2 = await manager.open( openConfig( 'win2' ) );

		manager.switchDesktop( 'desktop-1' );
		await manager.open( openConfig( 'win1' ) );

		manager.enterOverview();
		expect( manager._overviewActive ).toBe( true );
		expect( manager.getActiveDesktopId() ).toBe( 'desktop-1' );

		manager.focus( win2 );

		expect( manager.getActiveDesktopId() ).toBe( second.id );
		expect( manager._overviewActive ).toBe( true );
		expect( win2.isFocused() ).toBe( true );
	} );

	test( 'session restore stays on the saved active desktop', async () => {

		const session: Session = {
			windows: [
				{
					id: 'pages',
					baseId: 'pages',
					desktopId: 'desktop-2',
					url: 'http://example.test/wp-admin/edit.php?post_type=page',
					title: 'Pages',
					icon: 'dashicons-admin-page',
					state: 'normal',
					x: 100,
					y: 80,
					width: 900,
					height: 600,
				},
			],
			desktops: [
				{ id: 'desktop-1', label: 'Desktop 1' },
				{ id: 'desktop-2', label: 'Desktop 2' },
			],
			activeDesktop: 'desktop-1',
			focused: 'pages',
			updated: 123,
		};
		const switched = recordActions( hooks, [ HOOKS.DESKTOP_SWITCHED ] );

		await restoreSession(
			manager,
			{ adminUrl: 'http://example.test/wp-admin/', dockItems: [], session } as unknown as DesktopConfig,
			desktopArea,
		);

		expect( manager.getActiveDesktopId() ).toBe( 'desktop-1' );
		expect( manager.getById( 'pages' )?.element.style.display ).toBe( 'none' );
		expect( switched ).toHaveLength( 0 );
	} );

	test( 'a window opened onto another desktop does not take focus', async () => {
		const second = manager.createDesktop();
		const win1 = await manager.open( openConfig( 'win1' ) );

		const far = await manager.open( { ...openConfig( 'far' ), desktopId: second.id } );

		expect( manager.getActiveDesktopId() ).toBe( 'desktop-1' );
		expect( manager.getFocused() ).toBe( win1 );
		expect( win1.isFocused() ).toBe( true );
		expect( far.isFocused() ).toBe( false );
	} );
} );
