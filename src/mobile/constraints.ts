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

interface DisplacedGeometry {
	x: number;
	y: number;
	width: number;
	height: number;
	state: WindowState;

	unplaced: boolean;
}

export interface MobileConstraintsDeps {
	manager: WindowManager;
	mode: OsModeApi;

	openNative: OpenNativeWindow;
}

export interface MobileConstraints {
	recents: MobileRecents;

	trimSessionForMobile( config: DesktopConfig ): DesktopConfig;

	forcedIds(): string[];

	foldedIds(): string[];
	dispose(): void;
}

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

	addFilter< ResolvedWindowGeometry, [ WindowGeometryContext ] >(
		HOOKS.WINDOW_GEOMETRY,
		NS,
		( geometry, ctx ) => {
			if ( ! mode.isMobile() ) {
				return geometry;
			}

			if ( geometry.state === 'minimized' ) {
				return geometry;
			}
			displaced.set( ctx.windowId, {
				x: geometry.x,
				y: geometry.y,
				width: geometry.width,
				height: geometry.height,
				state: geometry.state ?? 'normal',

				unplaced: ! ctx.hasSavedGeometry && ! ctx.callerPinned,
			} );

			return { ...geometry, state: 'maximized' };
		},
	);

	const onWindowState = ( payload: unknown ): void => {
		const id = ( payload as { windowId?: string } | null )?.windowId;
		if ( id ) {
			maximizeIfNeeded( id );
		}
	};
	addAction( HOOKS.WINDOW_RESTORED, NS, onWindowState );
	addAction( HOOKS.WINDOW_UNMAXIMIZED, NS, onWindowState );

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

						state: before.state,

						...( before.unplaced ? { unplaced: true } : {} ),
					}
					: {} ),

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
