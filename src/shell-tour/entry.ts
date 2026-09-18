/**
 * Shell-tour lazy bundle — entry.
 *
 * Builds to `assets/js/shell-tour[.min].js`. A user's first boot, a
 * "Take the tour" click or a what's-new reset are the only things
 * that need it, so `<os-coachmark>` and the step driver stay out of
 * `desktop.min.js`. The main bundle keeps `src/shell-tour/loader.ts`,
 * which injects this and forwards the call.
 *
 * Cross-bundle safety: the tour takes its entry points through the
 * deps object and reads no shell module state. See `./index.ts`.
 */

import { endShellTour, isShellTourRunning, startShellTour } from './index';

( window as unknown as {
	openStationShellTour?: {
		startShellTour: typeof startShellTour;
		endShellTour: typeof endShellTour;
		isShellTourRunning: typeof isShellTourRunning;
	};
} ).openStationShellTour = { startShellTour, endShellTour, isShellTourRunning };
