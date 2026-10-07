import { applyFilters, doAction, HOOKS } from '../hooks';
import type { Desktop } from '../types';
import type { NavItem } from '../nav/types';
import type { Window } from '../window';
import type { WindowManager } from '../window-manager';
import { reflowGridSpan } from '../window-manager/grid-snap';
import { workAreaRectOf } from '../work-area';
import {
	resolveNativeUrlRemap,
	tryNativeUrlRemap,
} from '../native-url-remap';
import { resolveLaunches, type ResolvedLaunch } from './match';
import { findWorkspacePreset, workspaceProfileFromPreset } from './presets';
import {
	blankWorkspaceProfile,
	WORKSPACE_MAX_WINDOWS,
	type WorkspaceLaunch,
	type WorkspaceLayoutId,
	type WorkspaceProfile,
} from './types';
import { workspaceAppearance, workspaceWidgetIds } from './visibility';

export interface WorkspaceDeps {
	manager: WindowManager;

	getNavItems: () => NavItem[];

	adminUrl: string;

	deriveWindowId: ( url: string ) => string;

	openNative: ( id: string ) => void;

	refreshLayout: () => void;

	setVisibleWidgets?: ( ids: readonly string[] | null ) => void;

	setAppearance?: ( patch: Record< string, unknown > | null ) => void;
}

export function getWorkspaceProfile(
	mgr: WindowManager,
	desktopId: string,
): WorkspaceProfile | null {
	return (
		mgr.getDesktops().find( ( d ) => d.id === desktopId )?.profile ?? null
	);
}

export function getActiveWorkspaceProfile(
	mgr: WindowManager,
): WorkspaceProfile | null {
	return getWorkspaceProfile( mgr, mgr.getActiveDesktopId() );
}

export function setWorkspaceProfile(
	deps: WorkspaceDeps,
	desktopId: string,
	profile: WorkspaceProfile | null,
): boolean {
	const desktop = deps.manager._desktops.find(
		( d: Desktop ) => d.id === desktopId,
	);
	if ( ! desktop ) {
		return false;
	}
	const previousLook = JSON.stringify( workspaceAppearance( desktop.profile ) );
	if ( profile ) {
		desktop.profile = profile;
	} else {
		delete desktop.profile;
	}

	deps.refreshLayout();

	if ( desktopId === deps.manager.getActiveDesktopId() ) {
		if ( JSON.stringify( workspaceAppearance( profile ) ) === previousLook ) {
			applyWorkspaceWidgets( deps, desktopId );
		} else {
			applyWorkspaceView( deps, desktopId );
		}
	}
	doAction( HOOKS.WORKSPACE_UPDATED, { desktopId, profile } );
	return true;
}

export function applyWorkspaceWidgets(
	deps: WorkspaceDeps,
	desktopId: string,
): void {
	deps.setVisibleWidgets?.(
		workspaceWidgetIds( getWorkspaceProfile( deps.manager, desktopId ) ),
	);
}

export function applyWorkspaceAppearance(
	deps: WorkspaceDeps,
	desktopId: string,
): void {
	deps.setAppearance?.(
		workspaceAppearance( getWorkspaceProfile( deps.manager, desktopId ) ),
	);
}

export function applyWorkspaceView(
	deps: WorkspaceDeps,
	desktopId: string,
): void {
	applyWorkspaceAppearance( deps, desktopId );
	applyWorkspaceWidgets( deps, desktopId );
}

export interface CreateWorkspaceOptions {

	preset?: string;

	label?: string;

	profile?: WorkspaceProfile;

	activate?: boolean;

	desktopId?: string;
}

export function createWorkspace(
	deps: WorkspaceDeps,
	options: CreateWorkspaceOptions = {},
): Desktop {
	const preset = options.preset ? findWorkspacePreset( options.preset ) : null;

	let profile = options.profile ?? null;
	if ( ! profile && preset ) {
		profile = applyFilters< WorkspaceProfile, [ typeof preset ] >(
			HOOKS.WORKSPACE_PROFILE,
			workspaceProfileFromPreset( preset, deps.getNavItems() ),
			preset,
		);
	}

	const existing = options.desktopId
		? deps.manager.getDesktops().find( ( d ) => d.id === options.desktopId )
		: undefined;
	const desktop = existing ?? deps.manager.createDesktop();
	const label = options.label ?? preset?.defaultLabel ?? preset?.label ?? '';
	if ( label ) {
		deps.manager.renameDesktop( desktop.id, label );
	}
	if ( profile ) {
		setWorkspaceProfile( deps, desktop.id, profile );
	}
	if ( options.activate !== false ) {
		deps.manager.switchDesktop( desktop.id );
	}
	return desktop;
}

export function applyWorkspaceLayout(
	mgr: WindowManager,
	layout: WorkspaceLayoutId,
): void {
	switch ( layout ) {
		case 'cascade':
			mgr.cascade();
			break;
		case 'tile':
			mgr.tile();
			break;
		case 'columns':
			mgr.columns();
			break;
		case 'focus':
			mgr.focusLayout();
			break;
		case 'free':
		default:
			break;
	}
}

function launchBaseId(
	deps: WorkspaceDeps,
	url: string,
	launch: { item: NavItem },
): string {
	const menuUrl = launch.item.menu?.url;
	return (
		resolveNativeUrlRemap( url ) ??
		deps.deriveWindowId(
			menuUrl ? absoluteAdminUrl( menuUrl, deps.adminUrl ) : url,
		)
	);
}

function claimOpenWindows(
	deps: WorkspaceDeps,
	launches: readonly ResolvedLaunch[],
	desktopId: string,
	claimed: Set< string >,
): Map< ResolvedLaunch, Window > {
	const matchers: Array< ( win: Window, ownId: string ) => boolean > = [
		( win, ownId ) => win.id === ownId,
		( win, ownId ) => deps.deriveWindowId( win.config.url ?? '' ) === ownId,
		() => true,
	];
	const found = new Map< ResolvedLaunch, Window >();
	for ( const matches of matchers ) {
		for ( const launch of launches ) {
			if ( ! launch.url || found.has( launch ) ) {
				continue;
			}
			const url = absoluteAdminUrl( launch.url, deps.adminUrl );
			const ownId = deps.deriveWindowId( url );
			const win = deps.manager
				.getAllByBaseId( launchBaseId( deps, url, launch ) )
				.find(
					( w ) =>
						! claimed.has( w.id ) &&
						( ! w.config.desktopId || w.config.desktopId === desktopId ) &&
						matches( w, ownId ),
				);
			if ( win ) {
				claimed.add( win.id );
				found.set( launch, win );
			}
		}
	}
	return found;
}

function openLaunchUrl(
	deps: WorkspaceDeps,
	url: string,
	launch: { title?: string; item: NavItem },
	desktopId: string,
	claimed: Set< string >,
): Promise< Window | null > {
	const nativeId = resolveNativeUrlRemap( url );
	if ( nativeId ) {
		const before = new Set(
			deps.manager.getAllByBaseId( nativeId ).map( ( w ) => w.id ),
		);
		if ( tryNativeUrlRemap( url, { newInstance: true } ) ) {
			return whenWindowOpens(
				deps.manager,
				nativeId,
				( win ) => ! before.has( win.id ) && ! claimed.has( win.id ),
			);
		}
	}
	const menu = launch.item.menu;
	return deps.manager.openNew( {
		id: deps.deriveWindowId( url ),

		baseId: launchBaseId( deps, url, launch ),
		url,

		parentUrl: menu?.url ?? url,
		title: launch.title ?? launch.item.title,
		icon: launch.item.icon,
		submenu: menu?.submenu,
		selfLabel: menu?.selfLabel,
		multi: !! menu?.multi,
		desktopId,
	} );
}

export function provisionWorkspace(
	deps: WorkspaceDeps,
	desktopId: string,
	opts: { force?: boolean } = {},
): void {
	const profile = getWorkspaceProfile( deps.manager, desktopId );

	if ( ! profile || ( profile.provisioned && ! opts.force ) ) {
		return;
	}

	setWorkspaceProfile( deps, desktopId, { ...profile, provisioned: true } );

	const launches = resolveLaunches( deps.getNavItems(), profile.windows );

	const claimed = new Set< string >();
	const onDesk = claimOpenWindows( deps, launches, desktopId, claimed );

	const landed: string[] = [];
	let opened = 0;
	for ( const [ index, launch ] of launches.entries() ) {
		if ( launch.url ) {
			const url = absoluteAdminUrl( launch.url, deps.adminUrl );
			opened++;
			const existing = onDesk.get( launch );
			if ( existing ) {
				landed[ index ] = existing.id;
				placeLaunchedWindow( deps.manager, existing, launch );
				continue;
			}

			void openLaunchUrl( deps, url, launch, desktopId, claimed )
				.then( ( win ) => {
					if ( win ) {
						claimed.add( win.id );
						landed[ index ] = win.id;
						placeLaunchedWindow( deps.manager, win, launch );
					}
				} )
				.catch( () => {

				} );
			continue;
		}
		if ( launch.item.windowId ) {
			opened++;
			deps.openNative( launch.item.windowId );
			void whenWindowOpens( deps.manager, launch.item.windowId ).then(
				( win ) => {
					if ( win ) {
						landed[ index ] = win.id;
						placeLaunchedWindow( deps.manager, win, launch );
					}
				},
			);
		}
	}

	const settle = (): void => {
		arrangeDesk( deps.manager, profile.layout, landed );
		doAction( HOOKS.WORKSPACE_PROVISIONED, {
			desktopId,
			opened,
			layout: profile.layout,
		} );
	};
	afterLayout( settle );
}

function arrangeDesk(
	mgr: WindowManager,
	layout: WorkspaceLayoutId,
	landed: readonly string[],
): void {
	const lead = landed.find( Boolean );
	if ( 'focus' === layout && lead ) {
		mgr.focus( lead );
	}
	applyWorkspaceLayout( mgr, layout );
}

function afterLayout( fn: () => void ): void {
	if ( 'undefined' !== typeof requestAnimationFrame ) {
		requestAnimationFrame( () => requestAnimationFrame( fn ) );
	} else {
		fn();
	}
}

export function reopenWorkspaceWindows(
	deps: WorkspaceDeps,
	desktopId: string,
): void {
	const profile = getWorkspaceProfile( deps.manager, desktopId );
	if ( ! profile || ! profile.provisioned || profile.windows.length === 0 ) {
		return;
	}

	const launches = resolveLaunches( deps.getNavItems(), profile.windows );
	const claimed = new Set< string >();
	const onDesk = claimOpenWindows( deps, launches, desktopId, claimed );
	const landed: string[] = [];
	const reopened: Promise< unknown >[] = [];
	for ( const [ index, launch ] of launches.entries() ) {
		if ( launch.url ) {
			const url = absoluteAdminUrl( launch.url, deps.adminUrl );

			const existing = onDesk.get( launch );
			if ( existing ) {
				landed[ index ] = existing.id;
				continue;
			}
			reopened.push(
				openLaunchUrl( deps, url, launch, desktopId, claimed )
					.then( ( win ) => {
						if ( win ) {
							claimed.add( win.id );
							landed[ index ] = win.id;
							placeLaunchedWindow( deps.manager, win, launch );
						}
					} )
					.catch( () => {

					} ),
			);
			continue;
		}
		if ( launch.item.windowId ) {
			if ( deps.manager.getById( launch.item.windowId ) ) {
				landed[ index ] = launch.item.windowId;
				continue;
			}
			deps.openNative( launch.item.windowId );
			reopened.push(
				whenWindowOpens( deps.manager, launch.item.windowId ).then(
					( win ) => {
						if ( win ) {
							landed[ index ] = win.id;
							placeLaunchedWindow( deps.manager, win, launch );
						}
					},
				),
			);
		}
	}

	if ( reopened.length > 0 ) {
		void Promise.all( reopened ).then( () =>
			afterLayout( () => {
				if ( deps.manager.getActiveDesktopId() === desktopId ) {
					arrangeDesk( deps.manager, profile.layout, landed );
				}
			} ),
		);
	}
}

export function captureWorkspaceWindows(
	mgr: WindowManager,
	desktopId: string,
): WorkspaceLaunch[] {
	const out: WorkspaceLaunch[] = [];
	const seen = new Set< string >();
	const area = workAreaRectOf( mgr._desktop );
	for ( const win of mgr.getAll() ) {
		if ( ( win.config.desktopId || mgr.getActiveDesktopId() ) !== desktopId ) {
			continue;
		}
		const id = win.config.baseId || win.id;
		if ( seen.has( id ) ) {
			continue;
		}
		seen.add( id );
		const entry: WorkspaceLaunch = {
			match: id,
			title: win.config.title || id,
		};

		if ( true !== win.config.native && win.config.url ) {
			entry.url = win.config.url;
		}

		if ( win._gridSpan ) {
			entry.gridSpan = { ...win._gridSpan };
		} else if ( win.state === 'normal' && area.width > 0 && area.height > 0 ) {
			const el = win.element;
			entry.place = clampPlace( {
				x: ( el.offsetLeft - area.x ) / area.width,
				y: ( el.offsetTop - area.y ) / area.height,
				width: el.offsetWidth / area.width,
				height: el.offsetHeight / area.height,
			} );
		}
		out.push( entry );

		if ( out.length >= WORKSPACE_MAX_WINDOWS ) {
			break;
		}
	}
	return out;
}

function clampPlace( p: NonNullable< WorkspaceLaunch[ 'place' ] > ): NonNullable< WorkspaceLaunch[ 'place' ] > {
	const unit = ( v: number ): number =>
		Number.isFinite( v ) ? Math.min( 1, Math.max( 0, v ) ) : 0;
	return {
		x: unit( p.x ),
		y: unit( p.y ),
		width: Math.max( 0.05, unit( p.width ) ),
		height: Math.max( 0.05, unit( p.height ) ),
	};
}

function placeLaunchedWindow(
	mgr: WindowManager,
	win: Window,
	launch: Pick< WorkspaceLaunch, 'gridSpan' | 'place' >,
): void {
	const area = workAreaRectOf( mgr._desktop );
	if ( launch.gridSpan ) {
		win._gridSpan = {
			anchor: { ...launch.gridSpan.anchor },
			cursor: { ...launch.gridSpan.cursor },
			cols: launch.gridSpan.cols,
			rows: launch.gridSpan.rows,
		};
		reflowGridSpan( win, area );
		win._emitChange( 'moved' );
		return;
	}
	if ( launch.place ) {
		const p = launch.place;
		win.element.style.left = `${ Math.round( area.x + p.x * area.width ) }px`;
		win.element.style.top = `${ Math.round( area.y + p.y * area.height ) }px`;
		win.element.style.width = `${ Math.round( p.width * area.width ) }px`;
		win.element.style.height = `${ Math.round( p.height * area.height ) }px`;
		win._emitChange( 'moved' );
	}
}

function whenWindowOpens(
	mgr: WindowManager,
	id: string,
	accept?: ( win: Window ) => boolean,
	timeoutMs = 8000,
): Promise< Window | null > {
	const found = (): Window | null =>
		accept
			? mgr.getAllByBaseId( id ).find( accept ) ?? null
			: mgr.getById( id ) ?? null;
	const now = found();
	if ( now ) {
		return Promise.resolve( now );
	}
	return new Promise( ( resolve ) => {
		const done = ( win: Window | null ): void => {
			document.removeEventListener( 'os-window-opened', onOpened );
			window.clearTimeout( timer );
			resolve( win );
		};
		const onOpened = ( e: Event ): void => {
			const detail = ( e as CustomEvent< { windowId?: string } > ).detail;
			if ( accept || detail?.windowId === id ) {
				const win = found();
				if ( win ) {
					done( win );
				}
			}
		};
		const timer = window.setTimeout( () => done( null ), timeoutMs );
		document.addEventListener( 'os-window-opened', onOpened );
	} );
}

export interface SaveDeskOptions {

	visibleAppIds?: readonly string[];

	mountedWidgetIds?: readonly string[];
}

export function saveDeskToWorkspace(
	deps: WorkspaceDeps,
	desktopId: string,
	opts: SaveDeskOptions = {},
): WorkspaceProfile | null {
	const desktop = deps.manager._desktops.find( ( d: Desktop ) => d.id === desktopId );
	if ( ! desktop ) {
		return null;
	}
	const current = desktop.profile ?? blankWorkspaceProfile();
	const next: WorkspaceProfile = {
		...current,
		windows: captureWorkspaceWindows( deps.manager, desktopId ),
		layout: 'free',
		provisioned: true,
	};
	if ( opts.visibleAppIds ) {
		const controls = new Set(
			deps.getNavItems()
				.filter( ( item ) => 'control' === item.kind || item.locked )
				.map( ( item ) => item.id ),
		);
		next.apps = {
			mode: 'only',
			ids: opts.visibleAppIds.filter( ( id ) => ! controls.has( id ) ),
		};
	}
	if ( opts.mountedWidgetIds ) {
		next.widgets = { mode: 'only', ids: [ ...opts.mountedWidgetIds ] };
	}
	setWorkspaceProfile( deps, desktopId, next );
	return next;
}

export function absoluteAdminUrl( url: string, adminUrl: string ): string {
	if ( /^https?:\/\//i.test( url ) ) {
		return url;
	}
	try {
		return new URL( url, adminUrl ).href;
	} catch {
		return adminUrl;
	}
}
