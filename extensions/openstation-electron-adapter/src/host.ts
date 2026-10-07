import type { DesktopFrameBridge, DesktopHostBridge } from './types';

export const HOST_PROTOCOL = 1;

interface HostGlobals {
	openStationDesktopHost?: Partial< DesktopHostBridge >;
	openStationDesktopFrame?: Partial< DesktopFrameBridge >;
}

export function getHostBridge(
	scope: unknown = typeof window === 'undefined' ? undefined : window,
): DesktopHostBridge | null {
	if ( ! scope ) {
		return null;
	}
	const candidate = ( scope as HostGlobals ).openStationDesktopHost;
	if ( ! candidate || true !== candidate.isDesktopHost ) {
		return null;
	}
	const protocol = Number( candidate.protocol );
	if ( ! Number.isFinite( protocol ) || protocol > HOST_PROTOCOL ) {
		return null;
	}

	if ( 'function' !== typeof candidate.freeWindow ) {
		return null;
	}
	return candidate as DesktopHostBridge;
}

export function getFrameBridge(
	scope: unknown = typeof window === 'undefined' ? undefined : window,
): DesktopFrameBridge | null {
	if ( ! scope ) {
		return null;
	}
	const candidate = ( scope as HostGlobals ).openStationDesktopFrame;
	if ( ! candidate || true !== candidate.isFreedWindow ) {
		return null;
	}
	return candidate as DesktopFrameBridge;
}

export function sendLabel(
	osLabel: string,
	translate: ( text: string ) => string = ( text ) => text,
): string {
	const label = String( osLabel || '' ).trim();
	if ( ! label ) {
		return translate( 'Send to your desktop' );
	}
	return translate( 'Send to your %s' ).replace( '%s', label );
}

export interface WindowLike {
	id: string;
	config: { native?: boolean; title?: string };
	getCurrentUrl?: () => string;
}

export function freedWindowUrl(
	win: WindowLike,
	opts: { adminUrl: string; soloParam: string; origin?: string },
): string {
	const isNative = !! win.config?.native;
	const current = win.getCurrentUrl ? win.getCurrentUrl() : '';

	if ( ! isNative && current ) {
		try {
			const url = new URL( current, opts.origin || undefined );
			if ( ! /^https?:$/.test( url.protocol ) ) {
				return '';
			}

			url.searchParams.set( 'openstation_chromeless', '1' );
			return url.toString();
		} catch {
			return '';
		}
	}

	if ( ! opts.adminUrl || ! win.id ) {
		return '';
	}
	try {
		const solo = new URL( 'index.php', opts.adminUrl );
		solo.searchParams.set( opts.soloParam || 'openstation_solo', win.id );
		return solo.toString();
	} catch {
		return '';
	}
}
