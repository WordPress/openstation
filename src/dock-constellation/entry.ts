import { mountDockConstellation } from './index';

declare global {
	interface Window {
		openStationDockConstellation?: {
			mount: typeof mountDockConstellation;
		};
	}
}

window.openStationDockConstellation = {
	mount: mountDockConstellation,
};
