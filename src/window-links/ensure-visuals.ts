import type { DesktopConfig } from '../types';
import { loadVendorScript } from '../wallpapers/vendor-loader';

let inflight: Promise< boolean > | null = null;

export function ensureWindowLinkVisuals(): Promise< boolean > {
	if ( inflight ) {
		return inflight;
	}

	if ( window.openStationWindowLinkVisuals ) {
		inflight = Promise.resolve( true );
		return inflight;
	}

	const config = (
		window as unknown as { openStationConfig?: DesktopConfig }
	).openStationConfig;
	const url = config?.windowLinkVisualsBundleUrl;
	if ( ! url ) {
		return Promise.resolve( false );
	}

	inflight = loadVendorScript( url )
		.then( () => true )
		.catch( ( err ) => {
			inflight = null;
			throw err;
		} );
	return inflight;
}

export function __resetWindowLinkVisualsForTests(): void {
	inflight = null;
}
