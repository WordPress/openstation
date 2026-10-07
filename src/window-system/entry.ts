import { Window } from '../window';
import type { WindowSystemApi } from './types';

import '../ui/components/os-window-button/os-window-button';
import '../ui/components/os-save-status/os-save-status';
import '../ui/components/os-spinner/os-spinner';
import '../ui/components/os-menu/os-menu';
import '../ui/components/os-tab-chip/os-tab-chip';

const factory: WindowSystemApi = {
	createWindow( cfg ) {
		return new Window( cfg );
	},
};

window.openStationWindowSystem = factory;
