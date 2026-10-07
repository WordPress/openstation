import { tryNativeUrlRemap } from '../native-url-remap';
import { isShellDocumentUrl } from '../shell-url';
import { deriveWindowId } from '../utils';
import {
	clampGeometryToViewport,
	findDockEntryForUrl,
	findDockEntryForWindowId,
	findDockTitleForUrl,
} from './geometry';
import type { WindowManager } from '../window-manager';
import type { NativeWindowRestoreState } from '../native-windows';
import { workAreaRectOf } from '../work-area';
import type { Window } from '../window';
import type { DesktopConfig, Session, SessionWindow, WindowConfig } from '../types';

function placedGeometry(
	win: SessionWindow,
	rect: Parameters< typeof clampGeometryToViewport >[ 1 ],
): Pick< WindowConfig, 'x' | 'y' | 'width' | 'height' | 'initialState' > {
	const clamped = clampGeometryToViewport( win, rect );
	return {
		x: clamped.x,
		y: clamped.y,
		width: clamped.width,
		height: clamped.height,
		initialState: win.state,
	};
}

export function hasRestorableSession(
	session: Session | undefined,
): boolean {
	if ( ! session ) {
		return false;
	}
	if ( Array.isArray( session.windows ) && session.windows.length > 0 ) {
		return true;
	}
	if (
		typeof session.updated !== 'number' ||
		session.updated <= 0 ||
		! Array.isArray( session.desktops ) ||
		session.desktops.length === 0
	) {
		return false;
	}
	if ( session.desktops.length > 1 ) {
		return true;
	}
	const onlyDesktop = session.desktops[ 0 ];
	if ( onlyDesktop?.id && onlyDesktop.id !== 'desktop-1' ) {
		return true;
	}
	return !! session.activeDesktop && session.activeDesktop !== 'desktop-1';
}

export type OpenNativeWindow = (
	instanceId: string,
	baseId?: string,
	state?: NativeWindowRestoreState,
) => boolean;

function waitForWindow(
	manager: WindowManager,
	id: string,
	timeoutMs = 5000,
): Promise< Window | null > {
	const existing = manager.getById( id );
	if ( existing ) {
		return Promise.resolve( existing );
	}
	return new Promise( ( resolve ) => {
		const done = ( win: Window | null ): void => {
			window.clearTimeout( timer );
			document.removeEventListener( 'os-window-opened', onOpened );
			resolve( win );
		};
		const onOpened = ( e: Event ): void => {
			const detail = ( e as CustomEvent ).detail as
				| { windowId?: string }
				| undefined;
			if ( detail?.windowId === id ) {
				done( manager.getById( id ) ?? null );
			}
		};
		const timer = window.setTimeout( () => done( null ), timeoutMs );
		document.addEventListener( 'os-window-opened', onOpened );
	} );
}

export async function restoreSession(
	manager: WindowManager,
	config: DesktopConfig,
	desktopArea: HTMLElement,
	openNative?: OpenNativeWindow,
): Promise< void > {
	const rect = workAreaRectOf( desktopArea );

	if (
		Array.isArray( config.session.desktops ) &&
		config.session.desktops.length > 0
	) {
		manager.seedDesktops(
			config.session.desktops,
			config.session.activeDesktop || config.session.desktops[ 0 ].id,
		);
	}

	const nativeSeeds: Record< string, NativeWindowRestoreState > = {};
	for ( const win of config.session.windows ) {
		if ( ! win.native ) {
			continue;
		}
		nativeSeeds[ win.id ] = {
			desktopId: win.desktopId,

			...( win.unplaced ? {} : placedGeometry( win, rect ) ),

			...( win.params ? { params: win.params } : {} ),

			...( win.gridSpan ? { gridSpan: win.gridSpan } : {} ),
		};
	}
	if ( Object.keys( nativeSeeds ).length > 0 ) {
		manager.seedWindowRestoreState( nativeSeeds, { reserveIds: true } );
	}

	for ( const win of config.session.windows ) {
		if ( win.native ) {
			manager.discardWindowRestoreState( win.id );
			if (
				! openNative?.(
					win.id,
					win.baseId || win.id,
					nativeSeeds[ win.id ],
				)
			) {
				continue;
			}

			await waitForWindow( manager, win.id );
			continue;
		}

		if ( isShellDocumentUrl( win.url, config.adminUrl ) ) {
			continue;
		}

		const dockEntry =
			findDockEntryForUrl( win.url, config ) ??
			findDockEntryForWindowId( win.baseId || win.id, config );

		const opened = await manager.openNew( {
			id: win.id,
			baseId: win.baseId || win.id,
			desktopId: win.desktopId,
			multi: !! dockEntry?.multi,
			url: win.url,

			parentUrl: dockEntry?.url ?? win.url,

			title: findDockTitleForUrl( win.url, config ) ?? win.title,
			icon: win.icon || 'dashicons-admin-generic',

			...( win.unplaced ? {} : placedGeometry( win, rect ) ),
			submenu: dockEntry?.submenu,
			selfLabel: dockEntry?.selfLabel,

			...( win.gridSpan ? { gridSpan: win.gridSpan } : {} ),
		} );

		if ( Array.isArray( win.externalTabs ) ) {
			for ( const ext of win.externalTabs ) {
				if ( ext && typeof ext.url === 'string' && ext.url !== '' ) {
					opened.addExternalTab(
						ext.url,
						typeof ext.label === 'string' && ext.label !== ''
							? ext.label
							: ext.url,
					);
				}
			}
		}
	}

	manager.discardWindowRestoreState();

	if ( config.session.focused ) {
		const focused = manager.getById( config.session.focused );
		const activeDesktopId = manager.getActiveDesktopId();
		if (
			focused &&
			( focused.config.desktopId || activeDesktopId ) === activeDesktopId
		) {
			manager.focus( focused );
		}
	}
}

export async function openCurrentPage(
	manager: WindowManager,
	config: DesktopConfig,
): Promise< void > {
	if ( isShellDocumentUrl( config.currentPage, config.adminUrl ) ) {
		return;
	}
	if ( tryNativeUrlRemap( config.currentPage ) ) {
		return;
	}

	const windowId = deriveWindowId( config.currentPage, config.adminUrl );
	const dockEntry = findDockEntryForUrl( config.currentPage, config );

	await manager.open( {
		id: windowId,
		baseId: windowId,
		multi: !! dockEntry?.multi,
		url: config.currentPage,
		parentUrl: dockEntry?.url ?? config.currentPage,

		title: config.currentTitle || dockEntry?.title || '',
		icon: config.currentIcon,
		submenu: dockEntry?.submenu,
		selfLabel: dockEntry?.selfLabel,
	} );
}
