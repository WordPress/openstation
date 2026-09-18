/**
 * Shell-tour lazy bundle — loader (main-bundle side).
 *
 * Two jobs. At boot, decide whether this user is owed the tour and,
 * if so, inject `shell-tour[.min].js` once the desk has settled. For
 * the rest of the session, listen for the two replay signals — the
 * `os-shell-tour-start` event behind "Take the tour" and the
 * `os-intros-reset` event behind "Reset what's-new dialogs" — and
 * start the tour on demand, whatever the boot gate said.
 *
 * Mirrors `src/workspaces/wizard-loader.ts`: the bundle publishes
 * `window.openStationShellTour`, and the generation guard keeps two
 * quick starts from stacking two tours while the first fetch is in
 * flight.
 */

import type { DesktopConfig } from '../types';
import type { ShellTourDeps, ShellTourHandle } from './index';
import { SHELL_TOUR_INTRO_SLUG, SHELL_TOUR_START_EVENT } from './constants';
import { loadVendorScript } from '../wallpapers/vendor-loader';
import { isNoticeDismissed } from '../ui/components/os-notice/storage';
import { coreUpdateDismissKey } from '../update-notice';

/**
 * Delay before the first card mounts, in ms. The rebrand notice's
 * rationale: boot is busy, and a card that lands mid-paint reads as
 * a page that broke rather than as something addressed to you.
 */
export const MOUNT_DELAY_MS = 1200;

/** What the lazy bundle publishes. */
interface ShellTourApi {
	startShellTour: ( deps: ShellTourDeps ) => ShellTourHandle;
	endShellTour: () => void;
	isShellTourRunning: () => boolean;
}

export interface ShellTourLoaderDeps extends Omit< ShellTourDeps, 'config' > {
	config: DesktopConfig;
	/** The phone layer has no dock tiles and no snap gesture. */
	isMobile: () => boolean;
}

let generation = 0;

function loadedApi(): ShellTourApi | null {
	return (
		( window as unknown as { openStationShellTour?: ShellTourApi } ).openStationShellTour ??
		null
	);
}

/**
 * Whether the tour should start on its own this boot.
 *
 * Not when the site switched it off, when this user already had it,
 * when the shell is painting a single solo window, on the phone
 * layer, or when another announcement owns this boot — the rebrand
 * notice or the core-update card. Two announcements on one boot read
 * as a broken page; the tour is the one that can wait.
 */
export function shouldAutoStartShellTour( config: DesktopConfig, isMobile: () => boolean ): boolean {
	if ( config.shellTour === false ) {
		return false;
	}
	if ( config.soloWindow ) {
		return false;
	}
	if ( config.seenIntros?.includes( SHELL_TOUR_INTRO_SLUG ) ) {
		return false;
	}
	if ( config.rebrandNotice ) {
		return false;
	}
	const update = config.coreUpdate;
	if ( update && update.version && update.url && ! isNoticeDismissed( coreUpdateDismissKey( update ) ) ) {
		return false;
	}
	if ( isMobile() ) {
		return false;
	}
	return true;
}

/** Start the tour, loading its bundle on first use. */
function start( deps: ShellTourLoaderDeps ): void {
	const api = loadedApi();
	if ( api ) {
		api.startShellTour( deps );
		return;
	}
	const url = deps.config.shellTourBundleUrl ?? '';
	if ( ! url ) {
		// vitest / jsdom, or a deploy without the bundle: nothing
		// sane to inject, and a tour is never worth an error.
		return;
	}
	const myGen = ++generation;
	void loadVendorScript( url )
		.then( () => {
			if ( myGen !== generation ) {
				return;
			}
			loadedApi()?.startShellTour( deps );
		} )
		.catch( ( err ) => {
			if ( typeof console !== 'undefined' ) {
				console.warn( '[openstation] shell-tour bundle failed to load; tour suppressed:', err );
			}
		} );
}

/**
 * Wire the tour into a booting shell: the replay listeners for the
 * whole session, and the delayed first-boot start when it is owed.
 */
export function installShellTour( deps: ShellTourLoaderDeps ): void {
	document.addEventListener( SHELL_TOUR_START_EVENT, () => start( deps ) );
	// A reset clears `shell-tour` server-side; replaying right away
	// turns "Reset what's-new dialogs" into an instant replay instead
	// of one on the next boot.
	document.addEventListener( 'os-intros-reset', () => start( deps ) );

	if ( ! shouldAutoStartShellTour( deps.config, deps.isMobile ) ) {
		return;
	}
	window.setTimeout( () => {
		// The gate can change during the delay (a solo window cannot,
		// but a Take-the-tour click already started one).
		if ( loadedApi()?.isShellTourRunning() ) {
			return;
		}
		start( deps );
	}, MOUNT_DELAY_MS );
}
