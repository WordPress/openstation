/**
 * Tests for `src/mobile/constraints.ts` — every window full-screen on
 * a phone, and the session diet.
 *
 * Pins:
 * - the geometry filter forces `state: 'maximized'` only while the
 *   mode is `mobile`, keeps the displaced x/y/width/height, and
 *   leaves a minimized restore alone;
 * - `os.session.snapshot` writes the displaced geometry back and
 *   folds the parked recents in until they are opened;
 * - `splitSessionForMobile` restores the focused window only;
 * - a crossing out of `mobile` un-maximizes exactly the windows the
 *   phone forced;
 * - a window on another desk is folded onto the active one as it
 *   opens and on the crossing in, the session records the desk it
 *   came from, and the crossing out hands it back.
 */
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
	const seedWindowRestoreState = vi.fn();
	// The manager's own rule: a move re-homes the window and nothing
	// else; the stack order stands for focus order, last is in front.
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
		seedWindowRestoreState,
	} as unknown as WindowManager;
	return { manager, openNew, seedWindowRestoreState, moveWindowToDesktop, focus };
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

// The desktop default a phone-born window gets when the viewport
// widens is measured against the work area; give it one to measure.
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

		// A window restored minimized stays minimized (that is home).
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

		// The filter runs for `b` as restore opens it (a restore pins
		// the saved geometry, so nothing about it is a phone default).
		applyFilters(
			HOOKS.WINDOW_GEOMETRY,
			{ x: 1, y: 2, width: 500, height: 400, state: 'normal' },
			{ ...ctx( 'b' ), callerPinned: true },
		);

		// The phone is at home: `b` is minimized, full-screen sized.
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

		// Opening `a` by any route drops it from the recents.
		doAction( HOOKS.WINDOW_OPENED, { windowId: 'a' } );
		expect( c.recents.list() ).toEqual( [] );
		c.dispose();
	} );

	test( 'recents.open reopens an iframe window with its tabs, a native one through the registry', async () => {
		const mode = fakeMode( 'mobile' );
		const wins: FakeWin[] = [];
		const { manager, openNew, seedWindowRestoreState } = fakeManager( wins );
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
		expect( seedWindowRestoreState ).toHaveBeenCalledWith( { n: expect.objectContaining( { params: { post: 3 } } ) } );
		expect( openNative ).toHaveBeenCalledWith( 'n' );
		expect( c.recents.list() ).toEqual( [] );
		c.dispose();
	} );

	test( 'a window the phone opened is saved unplaced; leaving mobile gives it the desktop default', () => {
		const mode = fakeMode( 'mobile' );
		const fresh = fakeWin( 'p', { maximized: true } );
		const { manager } = fakeManager( [ fresh ] );
		const c = installMobileConstraints( { manager, mode: mode.api, openNative: () => false } );

		// A tap on a home tile: nothing saved, nothing pinned, and the
		// defaults the manager computed are sized for 390px.
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

		// Widened past the breakpoint, the window floats at the
		// desktop's own default (80% of the mocked 1400×900 work area,
		// cascaded from 40,40), not at 320×591.
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
		// The session's focused window, restored on the desk it was on.
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

		// Every save writes the desk the window came from, not the
		// phone's; a window that was already here is untouched.
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
		// The desk it came from, with the geometry the full-screen
		// belt-and-braces displaced (its snapshot said `normal`).
		expect( saved.windows[ 0 ] ).toMatchObject( { id: 'r', desktopId: 'desktop-2', state: 'normal', x: 10, y: 20 } );
		// A window that was already on this desk keeps its desk; only
		// its geometry is handed back.
		expect( saved.windows[ 1 ] ).toMatchObject( { id: 'h', desktopId: 'desktop-1', x: 10, y: 20 } );

		// Closed on the phone: nothing left to hand back.
		doAction( HOOKS.WINDOW_CLOSED, { windowId: 'r' } );
		expect( c.foldedIds() ).toEqual( [] );

		// Not on a phone, the desk a window opens on is its own.
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
		// `away` last: it is the window in front when the phone leaves.
		const desks = [ 'desktop-1', 'desktop-2', 'desktop-3' ];
		const { manager, moveWindowToDesktop, focus } = fakeManager( [ here, gone, away ], desks );
		const c = installMobileConstraints( { manager, mode: mode.api, openNative: () => false } );

		mode.set( 'mobile' );
		// `h` is already on the active desk and is left alone.
		expect( moveWindowToDesktop.mock.calls ).toEqual( [
			[ 'g', 'desktop-1' ],
			[ 'a', 'desktop-1' ],
		] );
		expect( c.foldedIds() ).toEqual( [ 'g', 'a' ] );
		expect( manager.getAll().every( ( w ) => w.config.desktopId === 'desktop-1' ) ).toBe( true );

		// A desk closed while the phone had its window: the window
		// stays where the desktop would have migrated it anyway.
		desks.splice( desks.indexOf( 'desktop-3' ), 1 );

		mode.set( 'desktop' );
		expect( away.config.desktopId ).toBe( 'desktop-2' );
		expect( gone.config.desktopId ).toBe( 'desktop-1' );
		expect( here.config.desktopId ).toBe( 'desktop-1' );
		expect( c.foldedIds() ).toEqual( [] );
		// The window in front went back to desktop-2, so the topmost
		// window still on the active desk takes the focus — as a
		// desktop switch would have done.
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

		// A restore while on the phone goes full-screen again.
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
