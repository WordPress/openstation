import { endShellTour, isShellTourRunning, startShellTour } from './index';

( window as unknown as {
	openStationShellTour?: {
		startShellTour: typeof startShellTour;
		endShellTour: typeof endShellTour;
		isShellTourRunning: typeof isShellTourRunning;
	};
} ).openStationShellTour = { startShellTour, endShellTour, isShellTourRunning };
