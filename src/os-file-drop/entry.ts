import { bootOsFileDrop, replayCapturedDrop, routePickedFiles } from './index';
import type { CapturedDrop } from './index';

declare global {
	interface Window {
		openStationFileDrop?: {
			boot: typeof bootOsFileDrop;
			replayCapturedDrop: ( drop: CapturedDrop ) => void;
			routePickedFiles: typeof routePickedFiles;
		};
	}
}

window.openStationFileDrop = {
	boot: bootOsFileDrop,
	replayCapturedDrop,
	routePickedFiles,
};
