import type { DesktopConfig } from '../types';
import type { ShellTourDeps, ShellTourHandle } from './index';
import { SHELL_TOUR_ICON_ID, SHELL_TOUR_INTRO_SLUG, SHELL_TOUR_START_EVENT } from './constants';
import { addAction, HOOKS, removeAction } from '../hooks';
import { loadVendorScript } from '../wallpapers/vendor-loader';
import { USAGE_FEEDBACK_INTRO_SLUG } from '../usage-feedback/index';

const NS = 'openstation/shell-tour-loader';

export const MOUNT_DELAY_MS = 1200;

interface ShellTourApi {
	startShellTour: ( deps: ShellTourDeps ) => ShellTourHandle;
	endShellTour: () => void;
	isShellTourRunning: () => boolean;
}

export interface ShellTourLoaderDeps extends Omit< ShellTourDeps, 'config' > {
	config: DesktopConfig;

	isMobile: () => boolean;

	updateNoticeShown?: Promise< boolean >;
}

let generation = 0;

function loadedApi(): ShellTourApi | null {
	return (
		( window as unknown as { openStationShellTour?: ShellTourApi } ).openStationShellTour ??
		null
	);
}

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
		return;
	}
	const myGen = ++generation;
	void loadVendorScript( url )
		.then( () => {
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

	document.addEventListener( 'os-intros-reset', () => start( deps ), { signal } );

	addAction< [ { id?: string } ] >( HOOKS.DESKTOP_ICON_CLICKED, NS, ( detail ) => {
		if ( detail?.id === SHELL_TOUR_ICON_ID ) {
			start( deps );
		}
	} );

	addAction< [ { mode?: string } ] >( HOOKS.MODE_CHANGED, NS, ( change ) => {
		if ( 'mobile' === change?.mode ) {
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
				if ( noticeShown || signal.aborted || loadedApi()?.isShellTourRunning() ) {
					return;
				}
				start( deps );
			} );
	}, MOUNT_DELAY_MS );
	return uninstall;
}
