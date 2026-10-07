import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { HOOKS, applyFilters, doAction } from '../../src/hooks';
import type { OsMode, OsModeApi, OsModeChange } from '../../src/mode';
import { installMobileConstraints, splitSessionForMobile } from '../../src/mobile/constraints';
import type { Session, SessionWindow } from '../../src/types';
import type { WindowManager } from '../../src/window-manager';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

function fakeMode( initial: OsMode ) {
	let mode = initial;
	const subs = new Set< ( c: OsModeChange ) => void >();
	const api: OsModeApi = {
		get: () => mode,
		getPreference: () => 'auto',
		getBreakpoints: () => ( { mobile: 767, tablet: 1024 } ),
		isMobile: () => mode === 'mobile',
		subscribe( cb ) {
			subs.add( cb );
			return () => subs.delete( cb );
		},
	};
	return {
		api,
		set( next: OsMode ) {
			const previous = mode;
			mode = next;
			for ( const cb of subs ) {
				cb( { mode: next, previous, preference: 'auto' } );
			}
		},
	};
}

interface FakeWin {
	id: string;
	config: { baseId?: string; desktopId?: string };
	minimized: boolean;
	maximized: boolean;
	isMinimized: () => boolean;
	isMaximized: () => boolean;
	isFullscreen: () => boolean;
	getSnapshot: () => { id: string; x: number; y: number; width: number; height: number; state: 'normal' | 'maximized' | 'minimized' };
	maximize: ReturnType< typeof vi.fn >;
	toggleMaximize: ReturnType< typeof vi.fn >;
	addExternalTab: ReturnType< typeof vi.fn >;
}

function fakeWin( id: string, over: Partial< FakeWin > = {} ): FakeWin {
	const w: FakeWin = {
		id,
		config: { baseId: id },
		minimized: false,
		maximized: false,
		isMinimized: () => w.minimized,
		isMaximized: () => w.maximized,
		isFullscreen: () => false,
		getSnapshot: () => ( { id, x: 10, y: 20, width: 300, height: 200, state: 'normal' } ),
		maximize: vi.fn( () => {
			w.maximized = true;
		} ),
		toggleMaximize: vi.fn( () => {
			w.maximized = ! w.maximized;
		} ),
		addExternalTab: vi.fn(),
		...over,
	};
	return w;
}

function fakeManager( wins: FakeWin[], desks: string[] = [ 'desktop-1' ] ) {
	const openNew = vi.fn( async ( cfg: { id: string; desktopId?: string } ) => {
		const w = fakeWin( cfg.id );
		w.config.desktopId = cfg.desktopId ?? 'desktop-1';
		wins.push( w );
		return w;
	} );

	const moveWindowToDesktop = vi.fn( ( id: string, desktopId: string ) => {
		const w = wins.find( ( x ) => x.id === id );
		if ( ! w || ! desks.includes( desktopId ) ) {
			return false;
		}
		w.config.desktopId = desktopId;
		return true;
	} );
	const focus = vi.fn();
	const manager = {
		getAll: () => wins.slice(),
		getById: ( id: string ) => wins.find( ( w ) => w.id === id ),
		getFocused: () => wins[ wins.length - 1 ],
		getActiveDesktopId: () => 'desktop-1',
		getDesktops: () => desks.map( ( id ) => ( { id, label: id } ) ),
		moveWindowToDesktop,
		focus,
		openNew,
	} as unknown as WindowManager;
	return { manager, openNew, moveWindowToDesktop, focus };
}

const sessionWin = ( id: string, over: Partial< SessionWindow > = {} ): SessionWindow => ( {
	id,
	url: `https://example.test/wp-admin/${ id }`,
	title: id,
	icon: 'dashicons-admin-generic',
	state: 'normal',
	x: 1,
	y: 2,
	width: 500,
	height: 400,
	...over,
} );

vi.mock( '../../src/work-area', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('../../src/work-area') >() ),
	workAreaRectOf: () => ( { x: 0, y: 0, width: 1400, height: 900 } ),
} ) );

describe( 'splitSessionForMobile', () => {
	test( 'keeps the focused window, parks the rest; nothing focused restores nothing', () => {
		const session: Session = {
			windows: [ sessionWin( 'a' ), sessionWin( 'b' ), sessionWin( 'c' ) ],
			desktops: [],
			activeDesktop: 'desktop-1',
			focused: 'b',
			updated: 1,
		};
		const split = splitSessionForMobile( session );
		expect( split.restore.map( ( w ) => w.id ) ).toEqual( [ 'b' ] );
		expect( split.recents.map( ( w ) => w.id ) ).toEqual( [ 'a', 'c' ] );
		expect( splitSessionForMobile( { ...session, focused: '' } ).restore ).toEqual( [] );
		expect( splitSessionForMobile( undefined ) ).toEqual( { restore: [], recents: [] } );
	} );
} );

describe( 'installMobileConstraints', () => {
	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
	} );

	const ctx = ( windowId: string ) => ( {
		windowId,
		baseId: windowId,
		hasSavedGeometry: false,
		callerPinned: false,
		desktopRect: { width: 390, height: 800 },
		workArea: { x: 0, y: 0, width: 390, height: 800 },
	} );

	test( 'forces maximized on a phone, keeps the displaced geometry, leaves the desktop alone', () => {
		const mode = fakeMode( 'mobile' );
		const { manager } = fakeManager( [] );
		const c = installMobileConstraints( { manager, mode: mode.api, openNative: () => false } );

		const geometry = { x: 40, y: 40, width: 900, height: 600, state: 'normal' as const };
		const out = applyFilters( HOOKS.WINDOW_GEOMETRY, geometry, ctx( 'w1' ) );
		expect( out ).toEqual( { ...geometry, state: 'maximized' } );
		expect( c.forcedIds() ).toEqual( [ 'w1' ] );

		const min = applyFilters( HOOKS.WINDOW_GEOMETRY, { ...geometry, state: 'minimized' }, ctx( 'w2' ) );
		expect( min.state ).toBe( 'minimized' );

		mode.set( 'desktop' );
		const untouched = applyFilters( HOOKS.WINDOW_GEOMETRY, geometry, ctx( 'w3' ) );
		expect( untouched ).toEqual( geometry );
		c.dispose();
	} );

	test( 'the session snapshot gets the desktop numbers back and carries the recents', () => {
		const mode = fakeMode( 'mobile' );
		const wins = [ fakeWin( 'b' ) ];
		const { manager } = fakeManager( wins );
		const c = installMobileConstraints( { manager, mode: mode.api, openNative: () => false } );

		const config = {
			session: {
				windows: [ sessionWin( 'a' ), sessionWin( 'b', { state: 'normal' } ) ],
				desktops: [],
				activeDesktop: 'desktop-1',
				focused: 'b',
				updated: 1,
			},
		} as never;
		const trimmed = c.trimSessionForMobile( config ) as { session: Session };
		expect( trimmed.session.windows.map( ( w ) => w.id ) ).toEqual( [ 'b' ] );
		expect( c.recents.list().map( ( w ) => w.id ) ).toEqual( [ 'a' ] );

		applyFilters(
			HOOKS.WINDOW_GEOMETRY,
			{ x: 1, y: 2, width: 500, height: 400, state: 'normal' },
			{ ...ctx( 'b' ), callerPinned: true },
		);

		const snapshot: Session = {
			windows: [ sessionWin( 'b', { state: 'minimized', x: 0, y: 0, width: 390, height: 800 } ) ],
			desktops: [],
			activeDesktop: 'desktop-1',
			focused: 'b',
			updated: 2,
		};
		const saved = applyFilters( HOOKS.SESSION_SNAPSHOT, snapshot );
		expect( saved.windows.map( ( w ) => w.id ) ).toEqual( [ 'b', 'a' ] );
		expect( saved.windows[ 0 ] ).toMatchObject( { state: 'normal', x: 1, y: 2, width: 500, height: 400 } );
		expect( saved.windows[ 0 ] ).not.toHaveProperty( 'unplaced' );
		expect( saved.windows[ 1 ] ).toEqual( sessionWin( 'a' ) );

		doAction( HOOKS.WINDOW_OPENED, { windowId: 'a' } );
		expect( c.recents.list() ).toEqual( [] );
		c.dispose();
	} );

	test( 'recents.open reopens an iframe window with its tabs, a native one through the registry', async () => {
		const mode = fakeMode( 'mobile' );
		const wins: FakeWin[] = [];
		const { manager, openNew } = fakeManager( wins );
		const openNative = vi.fn( () => true );
		const c = installMobileConstraints( { manager, mode: mode.api, openNative } );
		const notify = vi.fn();
		c.recents.subscribe( notify );

		c.trimSessionForMobile( {
			session: {
				windows: [
					sessionWin( 'a', { externalTabs: [ { url: 'https://example.test/wp-admin/x', label: 'X' } ] } ),
					sessionWin( 'n', { native: true, params: { post: 3 } } ),
				],
				desktops: [],
				activeDesktop: 'desktop-1',
				focused: '',
				updated: 1,
			},
		} as never );
		expect( notify ).toHaveBeenCalled();

		c.recents.open( c.recents.list()[ 0 ] );
		expect( openNew ).toHaveBeenCalledWith( expect.objectContaining( { id: 'a', url: 'https://example.test/wp-admin/a' } ) );
		await Promise.resolve();
		await Promise.resolve();
		expect( wins[ 0 ].addExternalTab ).toHaveBeenCalledWith( 'https://example.test/wp-admin/x', 'X' );
		expect( c.recents.list().map( ( r ) => r.id ) ).toEqual( [ 'n' ] );

		c.recents.open( c.recents.list()[ 0 ] );
		expect( openNative ).toHaveBeenCalledWith( 'n', 'n', {
			desktopId: undefined,
			params: { post: 3 },
		} );
		expect( c.recents.list() ).toEqual( [] );
		c.dispose();
	} );

	test( 'a window the phone opened is saved unplaced; leaving mobile gives it the desktop default', () => {
		const mode = fakeMode( 'mobile' );
		const fresh = fakeWin( 'p', { maximized: true } );
		const { manager } = fakeManager( [ fresh ] );
		const c = installMobileConstraints( { manager, mode: mode.api, openNative: () => false } );

		applyFilters(
			HOOKS.WINDOW_GEOMETRY,
			{ x: 58, y: 70, width: 320, height: 591, state: 'normal' },
			ctx( 'p' ),
		);
		const snapshot: Session = {
			windows: [ sessionWin( 'p', { state: 'minimized', x: 0, y: 0, width: 390, height: 800 } ) ],
			desktops: [],
			activeDesktop: 'desktop-1',
			focused: 'p',
			updated: 2,
		};
		const saved = applyFilters( HOOKS.SESSION_SNAPSHOT, snapshot );
		expect( saved.windows[ 0 ] ).toMatchObject( { state: 'normal', unplaced: true } );

		mode.set( 'desktop' );
		expect( fresh.toggleMaximize ).toHaveBeenCalledTimes( 1 );
		expect( ( fresh as unknown as { _savedGeometry?: unknown } )._savedGeometry ).toEqual( {
			x: 40,
			y: 40,
			width: 1120,
			height: 720,
		} );
		c.dispose();
	} );

	test( 'a window opened on another desk is folded onto the active one; the session records its own desk', () => {
		const mode = fakeMode( 'mobile' );

		const restored = fakeWin( 'r', { config: { baseId: 'r', desktopId: 'desktop-2' } } );
		const here = fakeWin( 'h', { config: { baseId: 'h', desktopId: 'desktop-1' } } );
		const wins = [ restored, here ];
		const { manager, moveWindowToDesktop } = fakeManager( wins, [ 'desktop-1', 'desktop-2' ] );
		const c = installMobileConstraints( { manager, mode: mode.api, openNative: () => false } );

		doAction( HOOKS.WINDOW_OPENED, { windowId: 'r' } );
		doAction( HOOKS.WINDOW_OPENED, { windowId: 'h' } );
		expect( moveWindowToDesktop ).toHaveBeenCalledTimes( 1 );
		expect( moveWindowToDesktop ).toHaveBeenCalledWith( 'r', 'desktop-1' );
		expect( restored.config.desktopId ).toBe( 'desktop-1' );
		expect( c.foldedIds() ).toEqual( [ 'r' ] );

		const snapshot: Session = {
			windows: [
				sessionWin( 'r', { desktopId: 'desktop-1', state: 'maximized' } ),
				sessionWin( 'h', { desktopId: 'desktop-1' } ),
			],
			desktops: [ { id: 'desktop-1', label: 'Desktop 1' }, { id: 'desktop-2', label: 'Desktop 2' } ],
			activeDesktop: 'desktop-1',
			focused: 'r',
			updated: 2,
		};
		const saved = applyFilters( HOOKS.SESSION_SNAPSHOT, snapshot );

		expect( saved.windows[ 0 ] ).toMatchObject( { id: 'r', desktopId: 'desktop-2', state: 'normal', x: 10, y: 20 } );

		expect( saved.windows[ 1 ] ).toMatchObject( { id: 'h', desktopId: 'desktop-1', x: 10, y: 20 } );

		doAction( HOOKS.WINDOW_CLOSED, { windowId: 'r' } );
		expect( c.foldedIds() ).toEqual( [] );

		mode.set( 'desktop' );
		const later = fakeWin( 'd', { config: { baseId: 'd', desktopId: 'desktop-2' } } );
		wins.push( later );
		doAction( HOOKS.WINDOW_OPENED, { windowId: 'd' } );
		expect( moveWindowToDesktop ).toHaveBeenCalledTimes( 1 );
		c.dispose();
	} );

	test( 'crossing into mobile folds every desk; crossing out hands each window back and repairs focus', () => {
		const mode = fakeMode( 'desktop' );
		const away = fakeWin( 'a', { config: { baseId: 'a', desktopId: 'desktop-2' } } );
		const gone = fakeWin( 'g', { config: { baseId: 'g', desktopId: 'desktop-3' } } );
		const here = fakeWin( 'h', { config: { baseId: 'h', desktopId: 'desktop-1' } } );

		const desks = [ 'desktop-1', 'desktop-2', 'desktop-3' ];
		const { manager, moveWindowToDesktop, focus } = fakeManager( [ here, gone, away ], desks );
		const c = installMobileConstraints( { manager, mode: mode.api, openNative: () => false } );

		mode.set( 'mobile' );

		expect( moveWindowToDesktop.mock.calls ).toEqual( [
			[ 'g', 'desktop-1' ],
			[ 'a', 'desktop-1' ],
		] );
		expect( c.foldedIds() ).toEqual( [ 'g', 'a' ] );
		expect( manager.getAll().every( ( w ) => w.config.desktopId === 'desktop-1' ) ).toBe( true );

		desks.splice( desks.indexOf( 'desktop-3' ), 1 );

		mode.set( 'desktop' );
		expect( away.config.desktopId ).toBe( 'desktop-2' );
		expect( gone.config.desktopId ).toBe( 'desktop-1' );
		expect( here.config.desktopId ).toBe( 'desktop-1' );
		expect( c.foldedIds() ).toEqual( [] );

		expect( focus ).toHaveBeenCalledTimes( 1 );
		expect( ( focus.mock.calls[ 0 ][ 0 ] as FakeWin ).id ).toBe( 'g' );
		c.dispose();
	} );

	test( 'crossing into mobile maximizes open windows; crossing out releases only the forced ones', () => {
		const mode = fakeMode( 'desktop' );
		const floating = fakeWin( 'f' );
		const alreadyMax = fakeWin( 'm', { maximized: true } );
		const { manager } = fakeManager( [ floating, alreadyMax ] );
		const c = installMobileConstraints( { manager, mode: mode.api, openNative: () => false } );

		mode.set( 'mobile' );
		expect( floating.maximize ).toHaveBeenCalledTimes( 1 );
		expect( alreadyMax.maximize ).not.toHaveBeenCalled();
		expect( c.forcedIds() ).toEqual( [ 'f' ] );

		floating.maximized = false;
		doAction( HOOKS.WINDOW_RESTORED, { windowId: 'f' } );
		expect( floating.maximize ).toHaveBeenCalledTimes( 2 );

		mode.set( 'desktop' );
		expect( floating.toggleMaximize ).toHaveBeenCalledTimes( 1 );
		expect( alreadyMax.toggleMaximize ).not.toHaveBeenCalled();
		expect( c.forcedIds() ).toEqual( [] );
		c.dispose();
	} );
} );
