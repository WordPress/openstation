import { bootNotes } from './index';

declare global {
	interface Window {
		openStationNotes?: {
			boot: typeof bootNotes;
		};
	}
}

window.openStationNotes = {
	boot: bootNotes,
};
