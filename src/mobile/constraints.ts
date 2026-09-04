/**
 * OpenStation — phone layer: window constraints and the session diet.
 *
 * Ships in the main bundle (it has to be in place before the first
 * `open()`, which session restore fires long before the lazy phone
 * layer could arrive). Three jobs:
 *
 * 1. **Every window is full-screen on a phone.** One
 *    `os.window.geometry` filter forces `state: 'maximized'` on
 *    open, restore, prewarm and child open alike, and keeps the
 *    geometry it displaced so the desktop gets it back. Belt and
 *    braces on the actions: a window restored from minimize or
 *    un-maximized by a plugin is re-maximized while the mode is
 *    `mobile`; a mode change re-maximizes or releases in bulk.
 *
 * 2. **A phone has one desk.** A window on any other desktop is
 *    folded onto the active one as it opens (a session restore
 *    carries the desk a window was on; so does a parked recent), and
 *    everything already open is folded on the crossing into
 *    `mobile`. The desk each window came from is remembered, written
 *    back into every session save, and handed back on the crossing
 *    out — so the desktop finds its desks exactly as it left them.
 *    Without this the phone restored a window `display: none` on a
 *    desk it never shows, and a tap on its tile focused it invisibly.
 *
 * 3. **A phone boot restores one window.** `trimSessionForMobile()`
 *    keeps only the focused session window; the rest are parked (the
 *    phone does not list them) and the `os.session.snapshot` filter
 *    folds them back into every save with their desktop geometry
 *    intact, so a desktop reload after a phone visit finds exactly
 *    what it left. A window the phone opened itself has no desktop
 *    geometry to keep: it is saved as `unplaced`, and the desktop
 *    places it as a fresh open.
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
import { workAreaRectOf } from '../work-area';
import type { OpenNativeWindow } from '../boot/session';
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
	/** No desktop ever placed this window: the numbers are a phone's defaults. */
	unplaced: boolean;
}

export interface MobileConstraintsDeps {
	manager: WindowManager;
	mode: OsModeApi;
	/** Opens or restores a native window; `false` when nothing answers. */
	openNative: OpenNativeWindow;
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
	/** Ids folded onto the active desk from another one (test seam). */
	foldedIds(): string[];
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
	/** The desktop a folded window belongs to, by window id. */
	const folded = new Map< string, string >();
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
				unplaced: false,
			} );
		}
		win.maximize();
	};

	/**
	 * Bring a window on another desktop onto the active one, keeping
	 * the desk it came from. The first fold wins: a window folded, then
	 * moved by a plugin, then folded again still goes back to the desk
	 * the desktop knew.
	 */
	const foldIfNeeded = ( windowId: string ): void => {
		if ( ! mode.isMobile() ) {
			return;
		}
		const win = manager.getById( windowId );
		if ( ! win ) {
			return;
		}
		const active = manager.getActiveDesktopId();
		const own = win.config.desktopId || active;
		if ( own === active ) {
			return;
		}
		if ( ! folded.has( windowId ) ) {
			folded.set( windowId, own );
		}
		manager.moveWindowToDesktop( windowId, active );
	};

	/**
	 * Hand every folded window back to its desk. A desk closed in the
	 * meantime (a plugin, another tab's session) keeps the window on
	 * the active one, as `closeDesktop` would have. Focus is repaired
	 * the way `switchDesktop` repairs it: if the window in front just
	 * left the desk, the topmost one still on it takes over.
	 */
	const unfoldAll = (): void => {
		if ( folded.size === 0 ) {
			return;
		}
		const desks = new Set( manager.getDesktops().map( ( d ) => d.id ) );
		for ( const [ windowId, desktopId ] of folded ) {
			if ( desks.has( desktopId ) ) {
				manager.moveWindowToDesktop( windowId, desktopId );
			}
		}
		folded.clear();
		const active = manager.getActiveDesktopId();
		const focused = manager.getFocused();
		if ( focused && ( focused.config.desktopId || active ) !== active ) {
			const topOnActive = [ ...manager.getAll() ]
				.reverse()
				.find(
					( w ) =>
						( w.config.desktopId || active ) === active && ! w.isMinimized(),
				);
			if ( topOnActive ) {
				manager.focus( topOnActive );
			}
		}
	};

	/**
	 * The desktop's default for a window nobody placed: the rule
	 * `WindowManager` applies to a fresh open (80% of the work area,
	 * capped at 1200×800, cascaded), repeated here for a window the
	 * phone opened and a widened viewport is now seeing for the first
	 * time. `null` before the work area exists.
	 */
	const desktopDefaultGeometry = (
		index: number,
	): { x: number; y: number; width: number; height: number } | null => {
		const area = workAreaRectOf();
		if ( area.width <= 0 || area.height <= 0 ) {
			return null;
		}
		const margin = 12;
		const width = Math.min( Math.round( area.width * 0.8 ), 1200 );
		const height = Math.min( Math.round( area.height * 0.8 ), 800 );
		const step = 40 + ( index % 8 ) * 30;
		return {
			x: Math.max( area.x + margin, Math.min( area.x + step, area.x + area.width - width - margin ) ),
			y: Math.max( area.y + margin, Math.min( area.y + step, area.y + area.height - height - margin ) ),
			width,
			height,
		};
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
				// A fresh open on a phone (a home tile, a tab) arrives
				// with defaults sized for 390px. Nothing about them is
				// the desktop's, so they are marked and never handed
				// back as if they were.
				unplaced: ! ctx.hasSavedGeometry && ! ctx.callerPinned,
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
	// An open lands on the active desk first, then goes full-screen:
	// a restore or a parked recent arrives carrying the desk it was on.
	addAction( HOOKS.WINDOW_OPENED, NS, ( payload: unknown ) => {
		const id = ( payload as { windowId?: string } | null )?.windowId;
		if ( id ) {
			foldIfNeeded( id );
			maximizeIfNeeded( id );
		}
	} );
	addAction( HOOKS.WINDOW_CLOSED, NS, ( payload: unknown ) => {
		const id = ( payload as { windowId?: string } | null )?.windowId;
		if ( id ) {
			displaced.delete( id );
			folded.delete( id );
		}
	} );

	// A mode change is a bulk re-state: into `mobile`, every open
	// window comes onto the one desk and goes full-screen; out of it,
	// every window the phone forced (and only those) floats again
	// where it was, on the desk it was on.
	const unsubscribeMode = mode.subscribe( ( change: OsModeChange ) => {
		if ( change.mode === 'mobile' ) {
			for ( const win of manager.getAll() ) {
				foldIfNeeded( win.id );
				maximizeIfNeeded( win.id );
			}
			return;
		}
		if ( change.previous !== 'mobile' ) {
			return;
		}
		unfoldAll();
		let cascade = 0;
		for ( const win of manager.getAll() ) {
			const before = displaced.get( win.id );
			if ( ! before || ! win.isMaximized() ) {
				continue;
			}
			// A window born on the phone would un-maximize to a
			// phone's numbers: give it the desktop's own default first.
			if ( before.unplaced ) {
				const placed = desktopDefaultGeometry( cascade++ );
				if ( placed ) {
					win._savedGeometry = placed;
				}
			}
			win.toggleMaximize();
		}
		displaced.clear();
	} );

	// 2. The session: hand the desktop its own numbers and its own
	// desks back, and keep carrying what this phone chose not to open.
	addFilter< Session >( HOOKS.SESSION_SNAPSHOT, NS, ( session ) => {
		const openIds = new Set( session.windows.map( ( w ) => w.id ) );
		const windows = session.windows.map( ( w ) => {
			const before = displaced.get( w.id );
			const desk = folded.get( w.id );
			if ( ! mode.isMobile() || ( ! before && ! desk ) ) {
				return w;
			}
			return {
				...w,
				...( before
					? {
						x: before.x,
						y: before.y,
						width: before.width,
						height: before.height,
						// "Home" on a phone is every window minimized;
						// the desktop should not wake up to that, so the
						// state written is the one the window had before
						// the phone.
						state: before.state,
						// The desktop's restore path places an
						// `unplaced` window itself instead of trusting
						// the pixels above.
						...( before.unplaced ? { unplaced: true } : {} ),
					}
					: {} ),
				// The desk the window was on, not the one the phone
				// folded it onto.
				...( desk ? { desktopId: desk } : {} ),
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
				if (
					! deps.openNative( win.id, win.baseId || win.id, {
						desktopId: win.desktopId,
						...( win.params ? { params: win.params } : {} ),
					} )
				) {
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
					// Its desktop pixels ride along, so the filter above
					// sees a pinned open and keeps them for the desktop.
					x: win.x,
					y: win.y,
					width: win.width,
					height: win.height,
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
		foldedIds: () => Array.from( folded.keys() ),
		dispose() {
			unsubscribeMode();
			recentListeners.clear();
		},
	};
}
