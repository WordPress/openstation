import { freedWindowUrl } from './host';
import type { AdapterConfig, DesktopFrameBridge } from './types';

export interface SoloShellApi {
	config: { adminUrl: string; soloWindow?: string };
	HOOKS: Record< string, string >;
	hooks: {
		addAction(
			name: string,
			namespace: string,
			cb: ( payload: { windowId?: string } ) => void,
		): void;
	};
	windowManager: {
		getById( id: string ): unknown;
	};
}

interface OpenedWindow {
	id: string;
	config: { native?: boolean; title?: string; url?: string };
	element?: { getBoundingClientRect(): { width: number; height: number } };
	getCurrentUrl?: () => string;
	close?: () => void;
}

export function sameDocument( a: string, b: string ): boolean {
	const strip = ( raw: string ): string => {
		try {
			const url = new URL( raw, window.location.origin );
			for ( const flag of [
				'openstation_chromeless',
				'desktop_mode_portal',
				'desktop_mode_portal_intent',
			] ) {
				url.searchParams.delete( flag );
			}
			url.searchParams.sort();
			return `${ url.origin }${ url.pathname }?${ url.searchParams.toString() }`;
		} catch {
			return raw;
		}
	};
	return strip( a ) === strip( b );
}

export function installSoloForwarder(
	frame: Pick< DesktopFrameBridge, 'isFreedWindow' > & {
		openWindow?: ( req: {
			windowId: string;
			url: string;
			title?: string;
			width?: number;
			height?: number;
			native?: boolean;
		} ) => Promise< { ok: boolean; error?: string } >;
	},
	os: SoloShellApi,
	config: AdapterConfig,
): void {
	if ( 'function' !== typeof frame.openWindow ) {

		return;
	}

	const soloId = String( os.config.soloWindow || '' );

	os.hooks.addAction(
		os.HOOKS.WINDOW_OPENED,
		'openstation-electron/solo-forwarder',
		( payload ) => {
			const windowId = payload?.windowId;
			if ( ! windowId || windowId === soloId ) {
				return;
			}

			const win = os.windowManager.getById( windowId ) as
				| OpenedWindow
				| undefined
				| null;
			if ( ! win ) {
				return;
			}

			const url = freedWindowUrl(
				{
					id: win.id,
					config: win.config,

					getCurrentUrl: () =>
						( win.getCurrentUrl ? win.getCurrentUrl() : '' ) ||
						win.config.url ||
						'',
				},
				{
					adminUrl: os.config.adminUrl,
					soloParam: config.soloParam,
					origin: window.location.origin,
				},
			);
			if ( ! url ) {
				return;
			}

			if ( sameDocument( url, window.location.href ) ) {
				return;
			}

			const rect = win.element?.getBoundingClientRect();

			void frame
				.openWindow!( {
					windowId,
					url,
					title: win.config.title,
					width: rect ? Math.round( rect.width ) : undefined,
					height: rect ? Math.round( rect.height ) : undefined,
					native: !! win.config.native,
				} )
				.then( ( result ) => {
					if ( ! result?.ok ) {

						console.error(
							'[openstation-electron] host refused to open a window:',
							result?.error,
						);
						return;
					}

					win.close?.();
				} )
				.catch( ( err ) => {
					console.error(
						'[openstation-electron] could not forward a window to the host:',
						err,
					);
				} );
		},
	);
}
