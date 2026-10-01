/**
 * Shell-tour lazy bundle — loader (main-bundle side).
 *
 * Two jobs. At boot, decide whether this user is owed the tour and,
 * if so, inject `shell-tour[.min].js` once the desk has settled. For
 * the rest of the session, listen for the three replay signals — the
 * `os-shell-tour-start` event behind "Take the tour", the
 * `os-intros-reset` event behind "Reset what's-new dialogs", and a
 * click on the desktop icon an unfinished tour leaves behind — and
 * start the tour on demand, whatever the boot gate said.
 *
 * Never on the phone layer, by any of those routes: the tour is about
 * a rail, windows side by side and a snap gesture, and the phone has
 * none of them (nor the room for a card beside the thing it points
 * at). A tour running when the shell flips to the phone layer ends
 * without being recorded, so it is still owed on the next desk boot.
 *
 * Mirrors `src/workspaces/wizard-loader.ts`: the bundle publishes
 * `window.openStationShellTour`, and the generation guard keeps two
 * quick starts from stacking two tours while the first fetch is in
 * flight.
 */

import type { DesktopConfig } from '../types';
import type { ShellTourDeps, ShellTourHandle } from './index';
import { SHELL_TOUR_ICON_ID, SHELL_TOUR_INTRO_SLUG, SHELL_TOUR_START_EVENT } from './constants';
import { addAction, HOOKS, removeAction } from '../hooks';
import { loadVendorScript } from '../wallpapers/vendor-loader';
import { USAGE_FEEDBACK_INTRO_SLUG } from '../usage-feedback/index';

/** Hook namespace for the loader's listeners. */
const NS = 'openstation/shell-tour-loader';

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
	/**
	 * Settles `true` when the core-update notice put something on screen
	 * this boot: the release card, or its plain-toast fallback. Only that
	 * module knows, and only once the release art has resolved, which is
	 * why this is a promise and not a config read. Absent means no notice.
	 */
	updateNoticeShown?: Promise< boolean >;
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
 * layer, or when the rebrand notice or the usage feedback prompt owns
 * this boot. Two announcements on one boot read as a broken page; the
 * tour is the one that can wait. The prompt is owed a week into using
 * OpenStation, so the two only meet for someone who never got the
 * tour in that week (their boots so far were on a phone, say). The
 * core-update notice is the other announcement, and it is asked
 * separately (`updateNoticeShown`): whether it shows anything is not
 * knowable from the config.
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
	if ( config.usageFeedback && ! config.seenIntros?.includes( USAGE_FEEDBACK_INTRO_SLUG ) ) {
		return false;
	}
	if ( isMobile() ) {
		return false;
	}
	return true;
}

/** Start the tour, loading its bundle on first use. */
function start( deps: ShellTourLoaderDeps ): void {
	if ( deps.isMobile() ) {
		return;
	}
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
			// The shell can flip to the phone layer while the bundle is
			// in flight.
			if ( myGen !== generation || deps.isMobile() ) {
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
 *
 * Returns a function that unwires it again.
 */
export function installShellTour( deps: ShellTourLoaderDeps ): () => void {
	const controller = new AbortController();
	const { signal } = controller;
	let bootTimer = 0;
	const uninstall = (): void => {
		controller.abort();
		window.clearTimeout( bootTimer );
		removeAction( HOOKS.DESKTOP_ICON_CLICKED, NS );
		removeAction( HOOKS.MODE_CHANGED, NS );
	};

	document.addEventListener( SHELL_TOUR_START_EVENT, () => start( deps ), { signal } );
	// A reset clears `shell-tour` server-side; replaying right away
	// turns "Reset what's-new dialogs" into an instant replay instead
	// of one on the next boot.
	document.addEventListener( 'os-intros-reset', () => start( deps ), { signal } );
	// The relaunch icon has no window or URL to open: it is registered
	// only for a user who skipped, and a click on it IS the request.
	addAction< [ { id?: string } ] >( HOOKS.DESKTOP_ICON_CLICKED, NS, ( detail ) => {
		if ( detail?.id === SHELL_TOUR_ICON_ID ) {
			start( deps );
		}
	} );
	// A desk that becomes a phone under a running tour (a narrowed
	// window, a rotated tablet) takes the rail and the windows away from
	// the cards pointing at them. A teardown, not a skip: nothing is
	// recorded, so the tour is still owed.
	addAction< [ { mode?: string } ] >( HOOKS.MODE_CHANGED, NS, ( change ) => {
		if ( 'mobile' === change?.mode ) {
			// Also drops a start whose bundle is still in flight.
			generation++;
			loadedApi()?.endShellTour();
		}
	} );

	if ( ! shouldAutoStartShellTour( deps.config, deps.isMobile ) ) {
		return uninstall;
	}
	bootTimer = window.setTimeout( () => {
		void ( deps.updateNoticeShown ?? Promise.resolve( false ) )
			.catch( () => false )
			.then( ( noticeShown ) => {
				// The gate can change while this waits: the notice took
				// the boot, the install was unwired, or a Take-the-tour
				// click already started one.
				if ( noticeShown || signal.aborted || loadedApi()?.isShellTourRunning() ) {
					return;
				}
				start( deps );
			} );
	}, MOUNT_DELAY_MS );
	return uninstall;
}
