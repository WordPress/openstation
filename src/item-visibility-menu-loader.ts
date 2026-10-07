import type { OpenItemVisibilityMenuOpts } from './item-visibility-menu';
import { loadVendorScript } from './wallpapers/vendor-loader';

interface MenuApi {
	openItemVisibilityMenu: ( opts: OpenItemVisibilityMenuOpts ) => void;
}

let generation = 0;

function loadedApi(): MenuApi | null {
	const w = window as unknown as {
		openStationItemVisibilityMenu?: MenuApi;
	};
	return w.openStationItemVisibilityMenu ?? null;
}

function bundleUrl(): string {
	const cfg = ( window as unknown as {
		openStationConfig?: { itemVisibilityMenuBundleUrl?: string };
	} ).openStationConfig;
	return cfg?.itemVisibilityMenuBundleUrl ?? '';
}

export function openItemVisibilityMenu(
	opts: OpenItemVisibilityMenuOpts,
): void {
	const api = loadedApi();
	if ( api ) {
		api.openItemVisibilityMenu( opts );
		return;
	}
	const url = bundleUrl();
	if ( ! url ) {
		return;
	}
	const myGen = ++generation;
	void loadVendorScript( url )
		.then( () => {
			if ( myGen !== generation ) {
				return;
			}
			loadedApi()?.openItemVisibilityMenu( opts );
		} )
		.catch( ( err ) => {
			if ( typeof console !== 'undefined' ) {
				console.warn(
					'[openstation] item-visibility-menu bundle failed to load; menu suppressed:',
					err,
				);
			}
		} );
}
