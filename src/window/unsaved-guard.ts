import {
	UNSAVED_GUARD_COMMIT_WINDOW_MS,
	UNSAVED_GUARD_QUERY_TIMEOUT_MS,
} from './constants';
import type { Window } from './index';

const INITIAL_ORIGIN = window.location.origin;

let queryCounter = 0;

type ContentWindow = {
	postMessage( message: unknown, targetOrigin: string ): void;
};

export function queryUnsavedGuard(
	frame: { contentWindow?: ContentWindow | null } | null | undefined,
	{
		timeoutMs = UNSAVED_GUARD_QUERY_TIMEOUT_MS,
	}: { timeoutMs?: number } = {},
): Promise< boolean > {
	const target = frame?.contentWindow;
	if ( ! target ) {
		return Promise.resolve( false );
	}

	queryCounter += 1;
	const requestId = `os-unsaved-guard-${ Date.now() }-${ queryCounter }`;

	return new Promise< boolean >( ( resolve ) => {
		let timer: number | null = null;
		let settled = false;

		const finish = ( prevented: boolean ): void => {
			if ( settled ) {
				return;
			}
			settled = true;
			window.removeEventListener( 'message', onMessage );
			if ( timer !== null ) {
				window.clearTimeout( timer );
			}
			resolve( prevented );
		};

		const onMessage = ( ev: MessageEvent ): void => {
			if ( ev.origin !== INITIAL_ORIGIN ) {
				return;
			}
			const data = ev?.data as {
				type?: unknown;
				requestId?: unknown;
				prevent?: unknown;
			} | null;
			if (
				! data ||
				typeof data !== 'object' ||
				data.type !== 'os-bridge-beforeunload-response' ||
				data.requestId !== requestId
			) {
				return;
			}
			finish( data.prevent === true );
		};

		window.addEventListener( 'message', onMessage );
		timer = window.setTimeout(
			() => finish( false ),
			timeoutMs,
		) as unknown as number;

		try {
			target.postMessage(
				{ type: 'os-bridge-beforeunload-query', requestId },
				INITIAL_ORIGIN,
			);
		} catch {
			finish( false );
		}
	} );
}

export function navigateWithUnsavedGuard(
	win: Window,
	{ commit, navigate }: { commit: () => void; navigate: () => void },
): void {
	if ( ! win._iframeBridgeReady || ! win.iframe ) {
		commit();
		navigate();
		return;
	}

	win._unsavedGuardPending = true;
	void queryUnsavedGuard( win.iframe ).then( ( prevented ) => {
		win._unsavedGuardPending = false;
		if ( win._isDestroyed ) {
			return;
		}
		if ( ! prevented ) {
			commit();
			navigate();
			return;
		}
		win._deferNavigationCommit( commit, UNSAVED_GUARD_COMMIT_WINDOW_MS );
		navigate();
	} );
}
