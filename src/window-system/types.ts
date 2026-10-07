import type { Window as DesktopWindow } from '../window';
import type { WindowConfig } from '../types';

export interface WindowSystemApi {
	createWindow( cfg: WindowConfig ): DesktopWindow;
}

declare global {
	// eslint-disable-next-line @typescript-eslint/no-shadow
	interface Window {
		openStationWindowSystem?: WindowSystemApi;
	}
}
