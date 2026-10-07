import { startWindowLinkRenderHost } from './render-host';

declare global {
	interface Window {
		openStationWindowLinkVisuals?: {
			start: typeof startWindowLinkRenderHost;
		};
	}
}

window.openStationWindowLinkVisuals = {
	start: startWindowLinkRenderHost,
};
