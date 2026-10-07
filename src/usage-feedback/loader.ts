import { loadVendorScript } from '../wallpapers/vendor-loader';
import type { UsageFeedbackApi, UsageFeedbackPromptOptions } from './types';

function loadedApi(): UsageFeedbackApi | null {
	return (
		( window as unknown as { openStationUsageFeedback?: UsageFeedbackApi } )
			.openStationUsageFeedback ?? null
	);
}

function bundleUrl(): string {
	return (
		(
			window as unknown as {
				openStationConfig?: { usageFeedbackBundleUrl?: string };
			}
		).openStationConfig?.usageFeedbackBundleUrl ?? ''
	);
}

export async function showUsageFeedbackPrompt( opts: UsageFeedbackPromptOptions ): Promise< boolean > {
	let api = loadedApi();
	if ( ! api ) {
		const url = bundleUrl();
		if ( ! url ) {
			return false;
		}
		try {
			await loadVendorScript( url );
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.warn( '[openstation] usage-feedback bundle failed to load; prompt suppressed:', err );
			}
			return false;
		}
		api = loadedApi();
	}
	if ( ! api ) {
		return false;
	}
	api.showUsageFeedbackPrompt( opts );
	return true;
}
