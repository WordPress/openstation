/**
 * Desktop Mode — editor-autosave request/response correlation.
 *
 * The parent-side half of the editor-autosave bridge query: posts
 * `desktop-mode-editor-autosave-request` into an editor window's
 * iframe and resolves with the matching
 * `desktop-mode-editor-autosave-response` (or a timeout). The
 * iframe-side answerer lives in `src/iframe-bridge-standalone.ts` —
 * see `installEditorAutosaveHandler()` there and
 * `docs/bridge-protocol.md` for the message contract.
 *
 * Uses its own scoped `message` listener per request (the pattern the
 * relations engine uses) so the editor-preview module stays out of
 * the lazy window-system bundle's bridge dispatcher.
 */

/** Statuses the iframe can answer with, plus the parent-side timeout. */
export type AutosaveStatus =
	| 'saved'
	| 'no-editor'
	| 'not-dirty'
	| 'error'
	| 'timeout';

export interface AutosaveResult {
	status: AutosaveStatus;
	/**
	 * Fresh preview link, only present on the Gutenberg
	 * `__unstableSaveForPreview()` path — and only when same-origin.
	 * Callers fall back to the identity's server-computed
	 * `previewUrl` otherwise.
	 */
	previewUrl?: string;
}

const VALID_STATUSES: ReadonlySet< string > = new Set( [
	'saved',
	'no-editor',
	'not-dirty',
	'error',
] );

let requestCounter = 0;

/** Same-origin check for an iframe-supplied preview link. */
export function sameOriginUrl( value: unknown ): string | undefined {
	if ( typeof value !== 'string' || value === '' ) {
		return undefined;
	}
	try {
		const parsed = new URL( value, window.location.origin );
		return parsed.origin === window.location.origin ? value : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Ask an editor window's iframe to autosave, so the front-end preview
 * about to open reflects on-screen content.
 *
 * Never rejects — every failure mode resolves with a status the
 * caller can degrade on (`timeout` when the iframe stays silent,
 * `no-editor` when there's no iframe to ask).
 *
 * @param win            The editor window.
 * @param win.iframe     The window's iframe (the only member read —
 *                       structural so tests can pass a stub).
 * @param opts           Options bag.
 * @param opts.timeoutMs How long to wait for the iframe's answer.
 *                       The iframe answers immediately when there's
 *                       no editor, and has its own shorter internal
 *                       backstops, so this only trips when the frame
 *                       is unresponsive.
 */
export function requestEditorAutosave(
	win: { iframe?: HTMLIFrameElement | null },
	{ timeoutMs = 10000 }: { timeoutMs?: number } = {},
): Promise< AutosaveResult > {
	const target = win.iframe?.contentWindow;
	if ( ! target ) {
		return Promise.resolve( { status: 'no-editor' } );
	}

	requestCounter += 1;
	const requestId = `desktop-mode-editor-preview-${ Date.now() }-${ requestCounter }`;

	return new Promise< AutosaveResult >( ( resolve ) => {
		let timer: number | null = null;
		let settled = false;

		const finish = ( result: AutosaveResult ): void => {
			if ( settled ) {
				return;
			}
			settled = true;
			window.removeEventListener( 'message', onMessage );
			if ( timer !== null ) {
				window.clearTimeout( timer );
			}
			resolve( result );
		};

		const onMessage = ( ev: MessageEvent ): void => {
			if ( ev.origin !== window.location.origin ) {
				return;
			}
			const data = ev?.data as {
				type?: unknown;
				requestId?: unknown;
				status?: unknown;
				previewUrl?: unknown;
			} | null;
			if (
				! data ||
				typeof data !== 'object' ||
				data.type !== 'desktop-mode-editor-autosave-response' ||
				data.requestId !== requestId
			) {
				return;
			}
			const status =
				typeof data.status === 'string' &&
				VALID_STATUSES.has( data.status )
					? ( data.status as AutosaveStatus )
					: 'error';
			const previewUrl = sameOriginUrl( data.previewUrl );
			finish( previewUrl ? { status, previewUrl } : { status } );
		};

		window.addEventListener( 'message', onMessage );
		timer = window.setTimeout(
			() => finish( { status: 'timeout' } ),
			timeoutMs,
		);

		try {
			target.postMessage(
				{ type: 'desktop-mode-editor-autosave-request', requestId },
				window.location.origin,
			);
		} catch {
			finish( { status: 'no-editor' } );
		}
	} );
}
