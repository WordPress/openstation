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
