import type { Window as DesktopWindow } from '../window';
import type { WindowConfig } from '../types';

export interface WindowSystemApi {

	createWindow( cfg: WindowConfig ): DesktopWindow;
}

declare global {

	interface Window {
		openStationWindowSystem?: WindowSystemApi;
	}
}
