/**
 * OpenStation — phone layer: window constraints and the session diet.
 *
 * Ships in the main bundle (it has to be in place before the first
 * `open()`, which session restore fires long before the lazy phone
 * layer could arrive). Two jobs:
 *
 * 1. **Every window is full-screen on a phone.** One
 *    `os.window.geometry` filter forces `state: 'maximized'` on
 *    open, restore, prewarm and child open alike, and keeps the
 *    geometry it displaced so the desktop gets it back. Belt and
 *    braces on the actions: a window restored from minimize or
 *    un-maximized by a plugin is re-maximized while the mode is
 *    `mobile`; a mode change re-maximizes or releases in bulk.
 *
 * 2. **A phone boot restores one window.** `trimSessionForMobile()`
 *    keeps only the focused session window; the rest become
 *    *recents* — cold cards in the switcher — and the
 *    `os.session.snapshot` filter folds them back into every save
 *    with their desktop geometry intact, so a desktop reload after a
 *    phone visit finds exactly what it left.
 *
 * Nothing here lays anything out; `assets/css/mobile.css` hides the
 * chrome and the phone layer paints its own.
 */
import { findMenuEntryForUrl } from '../desktop-files/menu-entry';
import { HOOKS, addAction, addFilter } from '../hooks';
import type { OsModeApi, OsModeChange } from '../mode';
import type { DesktopConfig, Session, SessionWindow, WindowState } from '../types';
import type {
	ResolvedWindowGeometry,
	WindowGeometryContext,
	WindowManager,
} from '../window-manager';
import type { MobileRecents } from './types';

const NS = 'openstation/mobile';

type RecentsListener = () => void;

/** The geometry a window had before the phone forced it full-screen. */
interface DisplacedGeometry {
	x: number;
	y: number;
	width: number;
	height: number;
	state: WindowState;
}

export interface MobileConstraintsDeps {
	manager: WindowManager;
	mode: OsModeApi;
	/** Opens a native window by id; `false` when nothing answers. */
	openNative: ( id: string ) => boolean;
}

export interface MobileConstraints {
	recents: MobileRecents;
	/**
	 * Keep only the focused session window for a phone boot; the
	 * rest are parked as recents. Returns the config to restore from.
	 */
	trimSessionForMobile( config: DesktopConfig ): DesktopConfig;
	/** Ids the filter has forced full-screen (test seam). */
	forcedIds(): string[];
	dispose(): void;
}

/**
 * Pure: split a session into the one window to restore and the rest.
 * The focused window wins; with no focused id nothing is restored
 * and the phone boots to its home screen.
 */
export function splitSessionForMobile( session: Session | undefined ): {
	restore: SessionWindow[];
	recents: SessionWindow[];
} {
	const windows = Array.isArray( session?.windows ) ? session.windows : [];
	const focusedId = session?.focused ?? '';
	const focused = windows.find( ( w ) => w.id === focusedId );
	return {
		restore: focused ? [ focused ] : [],
		recents: windows.filter( ( w ) => w !== focused ),
	};
}

export function installMobileConstraints( deps: MobileConstraintsDeps ): MobileConstraints {
	const { manager, mode } = deps;
	const displaced = new Map< string, DisplacedGeometry >();
	let recents: SessionWindow[] = [];
	const recentListeners = new Set< RecentsListener >();
	const notifyRecents = (): void => {
		for ( const cb of recentListeners ) {
			cb();
		}
	};

	const maximizeIfNeeded = ( windowId: string ): void => {
		if ( ! mode.isMobile() ) {
			return;
		}
		const win = manager.getById( windowId );
		if ( ! win || win.isMinimized() || win.isMaximized() || win.isFullscreen() ) {
			return;
		}
		if ( ! displaced.has( win.id ) ) {
			const snap = win.getSnapshot();
			displaced.set( win.id, {
				x: snap.x,
				y: snap.y,
				width: snap.width,
				height: snap.height,
				state: snap.state,
			} );
		}
		win.maximize();
	};

	// 1. The filter — the whole placement policy in one place.
	addFilter< ResolvedWindowGeometry, [ WindowGeometryContext ] >(
		HOOKS.WINDOW_GEOMETRY,
		NS,
		( geometry, ctx ) => {
			if ( ! mode.isMobile() ) {
				return geometry;
			}
			// A window restored minimized stays minimized — that is
			// the phone's "home". Its first restore re-maximizes it
			// through the action below.
			if ( geometry.state === 'minimized' ) {
				return geometry;
			}
			displaced.set( ctx.windowId, {
				x: geometry.x,
				y: geometry.y,
				width: geometry.width,
				height: geometry.height,
				state: geometry.state ?? 'normal',
			} );
			// Keep the desktop's x/y/width/height: `maximize()` reads
			// them into the window's saved geometry, which is what an
			// un-maximize on the desktop restores.
			return { ...geometry, state: 'maximized' };
		},
	);

	// Belt and braces: anything that lands un-maximized while the
	// phone layer is up goes full-screen again.
	const onWindowState = ( payload: unknown ): void => {
		const id = ( payload as { windowId?: string } | null )?.windowId;
		if ( id ) {
			maximizeIfNeeded( id );
		}
	};
	addAction( HOOKS.WINDOW_RESTORED, NS, onWindowState );
	addAction( HOOKS.WINDOW_UNMAXIMIZED, NS, onWindowState );
	addAction( HOOKS.WINDOW_OPENED, NS, onWindowState );
	addAction( HOOKS.WINDOW_CLOSED, NS, ( payload: unknown ) => {
		const id = ( payload as { windowId?: string } | null )?.windowId;
		if ( id ) {
			displaced.delete( id );
		}
	} );

	// A mode change is a bulk re-state: into `mobile`, every open
	// window goes full-screen; out of it, every window the phone
	// forced (and only those) floats again where it was.
	const unsubscribeMode = mode.subscribe( ( change: OsModeChange ) => {
		if ( change.mode === 'mobile' ) {
			for ( const win of manager.getAll() ) {
				maximizeIfNeeded( win.id );
			}
			return;
		}
		if ( change.previous !== 'mobile' ) {
			return;
		}
		for ( const win of manager.getAll() ) {
			if ( displaced.has( win.id ) && win.isMaximized() ) {
				win.toggleMaximize();
			}
		}
		displaced.clear();
	} );

	// 2. The session: hand the desktop its own numbers back, and
	// keep carrying what this phone chose not to open.
	addFilter< Session >( HOOKS.SESSION_SNAPSHOT, NS, ( session ) => {
		const openIds = new Set( session.windows.map( ( w ) => w.id ) );
		const windows = session.windows.map( ( w ) => {
			const before = displaced.get( w.id );
			if ( ! before || ! mode.isMobile() ) {
				return w;
			}
			return {
				...w,
				x: before.x,
				y: before.y,
				width: before.width,
				height: before.height,
				// "Home" on a phone is every window minimized; the
				// desktop should not wake up to that, so the state
				// written is the one the window had before the phone.
				state: before.state,
			};
		} );
		const parked = recents.filter( ( r ) => ! openIds.has( r.id ) );
		return parked.length ? { ...session, windows: [ ...windows, ...parked ] } : { ...session, windows };
	} );

	const recentsApi: MobileRecents = {
		list: () => recents.slice(),
		forget( id ) {
			const next = recents.filter( ( r ) => r.id !== id );
			if ( next.length !== recents.length ) {
				recents = next;
				notifyRecents();
			}
		},
		open( win ) {
			recentsApi.forget( win.id );
			if ( win.native ) {
				manager.seedWindowRestoreState( {
					[ win.id ]: {
						desktopId: win.desktopId,
						...( win.params ? { params: win.params } : {} ),
					},
				} );
				if ( ! deps.openNative( win.id ) ) {
					return;
				}
				return;
			}
			// Same enrichment as session restore: the parent menu's
			// landing page and submenu give the window its tab strip.
			const menuEntry = findMenuEntryForUrl( win.url );
			void manager
				.openNew( {
					id: win.id,
					baseId: win.baseId || win.id,
					url: win.url,
					parentUrl: menuEntry?.url ?? win.url,
					title: win.title,
					icon: win.icon || 'dashicons-admin-generic',
					desktopId: win.desktopId,
					submenu: menuEntry?.submenu,
					selfLabel: menuEntry?.selfLabel,
					multi: !! menuEntry?.multi,
				} )
				.then( ( opened ) => {
					for ( const tab of win.externalTabs ?? [] ) {
						opened.addExternalTab( tab.url, tab.label );
					}
				} )
				.catch( ( err ) => {
					console.error( '[openstation] could not reopen a recent window:', err );
				} );
		},
		subscribe( cb ) {
			recentListeners.add( cb );
			return () => {
				recentListeners.delete( cb );
			};
		},
	};

	// A recent that gets opened by any other route (a home tile, a
	// deep link) stops being a recent.
	addAction( HOOKS.WINDOW_OPENED, NS, ( payload: unknown ) => {
		const id = ( payload as { windowId?: string } | null )?.windowId;
		if ( id ) {
			recentsApi.forget( id );
		}
	} );

	return {
		recents: recentsApi,
		trimSessionForMobile( config ) {
			const { restore, recents: parked } = splitSessionForMobile( config.session );
			recents = parked;
			notifyRecents();
			return {
				...config,
				session: { ...config.session, windows: restore },
			};
		},
		forcedIds: () => Array.from( displaced.keys() ),
		dispose() {
			unsubscribeMode();
			recentListeners.clear();
		},
	};
}
