/**
 * Usage-feedback lazy bundle — loader (main-bundle side).
 *
 * Mirrors `src/workspaces/wizard-loader.ts`: it `<script>`-injects
 * `assets/js/usage-feedback[.min].js` (URL from
 * `openStationConfig.usageFeedbackBundleUrl`), then forwards the call
 * to the API the bundle published on `window.openStationUsageFeedback`.
 *
 * Resolves `true` when the prompt was shown and `false` when it could
 * not be (no URL, or the script failed to load), so the caller knows
 * whether the user ever got to see the question.
 */

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

/** Show the prompt, loading its bundle first. */
export async function showUsageFeedbackPrompt( opts: UsageFeedbackPromptOptions ): Promise< boolean > {
	let api = loadedApi();
	if ( ! api ) {
		const url = bundleUrl();
		if ( ! url ) {
			// No URL configured: vitest / jsdom, or a misconfigured
			// deploy. Nothing sane to inject.
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
