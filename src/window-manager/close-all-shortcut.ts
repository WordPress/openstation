import { __, _n, sprintf } from '../i18n';
import { osConfirm, type OsConfirmOptions } from '../os-confirm';
import { showToast } from '../toast';
import type { Window } from '../window';
import type { WindowManager } from './index';

export const CLOSE_ALL_MESSAGE = 'os-window-close-all';

export function isCloseAllChord( e: KeyboardEvent ): boolean {
	if ( e.code !== 'KeyW' ) {
		return false;
	}
	if ( e.getModifierState?.( 'AltGraph' ) ) {
		return false;
	}
	if ( ! ( e.ctrlKey || e.metaKey ) ) {
		return false;
	}
	return e.altKey && ! e.shiftKey;
}

export interface CloseAllPrefs {

	shouldAsk(): boolean;

	setAsk( ask: boolean ): void;
}

let confirming = false;

export function windowsOnActiveDesktop( mgr: WindowManager ): Window[] {
	const activeId = mgr.getActiveDesktopId();
	return mgr
		.getAll()
		.filter( ( w ) => ( w.config.desktopId || activeId ) === activeId );
}

export async function closeAllWindows(
	mgr: WindowManager,
	prefs?: CloseAllPrefs,
): Promise< number > {
	if ( confirming ) {
		return 0;
	}
	const open = windowsOnActiveDesktop( mgr );
	if ( open.length === 0 ) {
		return 0;
	}

	if ( prefs && ! prefs.shouldAsk() ) {
		return runClose( mgr );
	}

	const rememberOpts: Pick< OsConfirmOptions, 'rememberLabel' | 'onRemember' > =
		prefs
			? {
				rememberLabel: __( "Don't ask again" ),
				onRemember: ( dontAsk: boolean ): void => {
					if ( dontAsk ) {
						prefs.setAsk( false );
					}
				},
			}
			: {};

	confirming = true;
	let confirmed = false;
	try {
		confirmed = await osConfirm( {
			title: __( 'Close all windows?' ),
			message: sprintf(

				_n(
					'%d open window on this desktop will be closed.',
					'%d open windows on this desktop will be closed.',
					open.length,
				),
				open.length,
			),
			confirmLabel: __( 'Close all' ),
			danger: true,
			...rememberOpts,
		} );
	} finally {
		confirming = false;
	}
	if ( ! confirmed ) {
		return 0;
	}
	return runClose( mgr );
}

const CLOSE_SETTLE_TIMEOUT_MS = 700;

const CLOSE_SETTLE_POLL_MS = 50;

function countClosed( mgr: WindowManager, targets: string[] ): Promise< number > {
	const gone = (): number =>
		targets.filter( ( id ) => ! mgr.getById( id ) ).length;
	return new Promise( ( resolve ) => {
		const deadline = Date.now() + CLOSE_SETTLE_TIMEOUT_MS;
		const check = (): void => {
			const n = gone();
			if ( n === targets.length || Date.now() >= deadline ) {
				resolve( n );
				return;
			}
			setTimeout( check, CLOSE_SETTLE_POLL_MS );
		};
		check();
	} );
}

async function runClose( mgr: WindowManager ): Promise< number > {
	if ( mgr._overviewActive ) {
		mgr.exitOverview();
	}

	const targets = windowsOnActiveDesktop( mgr ).map( ( w ) => w.id );

	const elsewhere = mgr
		.getAll()
		.map( ( w ) => w.id )
		.filter( ( id ) => ! targets.includes( id ) );

	mgr.closeAll( { exceptIds: elsewhere } );

	const closed = await countClosed( mgr, targets );
	if ( closed > 0 ) {
		showToast( {
			message: sprintf(

				_n( 'Closed %d window.', 'Closed %d windows.', closed ),
				closed,
			),
		} );
	}
	return closed;
}

let installed = false;

export function installCloseAllShortcut(
	mgr: WindowManager,
	prefs?: CloseAllPrefs,
): void {
	if ( installed ) {
		return;
	}
	installed = true;

	document.addEventListener(
		'keydown',
		( e: KeyboardEvent ) => {
			if ( ! isCloseAllChord( e ) ) {
				return;
			}
			e.preventDefault();
			e.stopImmediatePropagation();
			void closeAllWindows( mgr, prefs );
		},
		true,
	);

	const origin = window.location.origin;
	window.addEventListener( 'message', ( e: MessageEvent ) => {
		if ( e.origin !== origin ) {
			return;
		}
		const data = e.data as { type?: string } | null;
		if ( ! data || data.type !== CLOSE_ALL_MESSAGE ) {
			return;
		}
		void closeAllWindows( mgr, prefs );
	} );
}
