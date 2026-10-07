import { deriveWindowId } from '../utils';
import type { DesktopConfig, SessionWindow } from '../types';

export const VIEWPORT_CLAMP_MARGIN = 12;

export function findDockEntryForUrl(
	url: string,
	config: DesktopConfig,
): DesktopConfig[ 'dockItems' ][ number ] | undefined {
	return findDockEntryForWindowId(
		deriveWindowId( url, config.adminUrl ),
		config,
	);
}

export function findDockEntryForWindowId(
	windowId: string,
	config: DesktopConfig,
): DesktopConfig[ 'dockItems' ][ number ] | undefined {
	if ( ! windowId ) {
		return undefined;
	}
	return ( config.dockItems || [] ).find(
		( i ) =>
			deriveWindowId( i.url, config.adminUrl ) === windowId ||
			( i.submenu || [] ).some(
				( s ) => deriveWindowId( s.url, config.adminUrl ) === windowId,
			),
	);
}

export function findDockTitleForUrl(
	url: string,
	config: DesktopConfig,
): string | undefined {
	const windowId = deriveWindowId( url, config.adminUrl );
	if ( ! windowId ) {
		return undefined;
	}
	const items = config.dockItems || [];
	const top = items.find(
		( i ) => deriveWindowId( i.url, config.adminUrl ) === windowId,
	);
	if ( top?.title ) {
		return top.title;
	}
	for ( const item of items ) {
		const child = ( item.submenu || [] ).find(
			( s ) => deriveWindowId( s.url, config.adminUrl ) === windowId,
		);
		if ( child?.title ) {
			return child.title;
		}
	}
	return undefined;
}

export function clampGeometryToViewport(
	win: SessionWindow,
	rect: { x?: number; y?: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } {
	const originX = rect.x ?? 0;
	const originY = rect.y ?? 0;
	const maxW = Math.max( 200, rect.width - VIEWPORT_CLAMP_MARGIN * 2 );
	const maxH = Math.max( 200, rect.height - VIEWPORT_CLAMP_MARGIN * 2 );

	const width = Math.min( win.width, maxW );
	const height = Math.min( win.height, maxH );

	const maxX = originX + Math.max( 0, rect.width - width - VIEWPORT_CLAMP_MARGIN );
	const maxY = originY + Math.max( 0, rect.height - height - VIEWPORT_CLAMP_MARGIN );

	const x = Math.max( originX + VIEWPORT_CLAMP_MARGIN, Math.min( win.x, maxX ) );
	const y = Math.max( originY + VIEWPORT_CLAMP_MARGIN, Math.min( win.y, maxY ) );

	return { x, y, width, height };
}
