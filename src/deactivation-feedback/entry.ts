/**
 * Deactivation feedback — bundle entry.
 *
 * Builds to `assets/js/deactivation-feedback[.min].js`. Two ways in:
 *
 * - `plugins.php` (classic, chromeless, network admin): PHP enqueues
 *   the bundle with `window.openStationDeactivationFeedbackConfig`
 *   inlined before it, and the interceptor wires OpenStation's own
 *   Deactivate link.
 * - The native Plugins app: lazy-loads the bundle and calls
 *   `window.openStationDeactivationFeedback.ask()` before it
 *   dispatches a self-deactivate. When the shell is present the same
 *   API is also published as `wp.os.deactivationFeedback`.
 */

import {
	askDeactivationFeedback,
	interceptPluginsScreen,
	type DeactivationFeedbackApi,
	type DeactivationFeedbackConfig,
} from './index';

declare global {
	interface Window {
		openStationDeactivationFeedback?: DeactivationFeedbackApi;
		openStationDeactivationFeedbackConfig?: DeactivationFeedbackConfig;
	}
}

const api: DeactivationFeedbackApi = { ask: askDeactivationFeedback };
window.openStationDeactivationFeedback = api;

const os = window.wp?.os;
if ( os && ! os.deactivationFeedback ) {
	os.deactivationFeedback = api;
}

const config = window.openStationDeactivationFeedbackConfig;
if ( config ) {
	const wire = (): void => {
		interceptPluginsScreen( config );
	};
	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', wire, { once: true } );
	} else {
		wire();
	}
}
