export type AutosaveStatus =
	| 'saved'
	| 'no-editor'
	| 'not-dirty'
	| 'error'
	| 'timeout';

export interface AutosaveResult {
	status: AutosaveStatus;

	previewUrl?: string;
}

const VALID_STATUSES: ReadonlySet< string > = new Set( [
	'saved',
	'no-editor',
	'not-dirty',
	'error',
] );

let requestCounter = 0;

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

export function requestEditorAutosave(
	win: { iframe?: HTMLIFrameElement | null },
	{ timeoutMs = 10000 }: { timeoutMs?: number } = {},
): Promise< AutosaveResult > {
	const target = win.iframe?.contentWindow;
	if ( ! target ) {
		return Promise.resolve( { status: 'no-editor' } );
	}

	requestCounter += 1;
	const requestId = `os-editor-preview-${ Date.now() }-${ requestCounter }`;

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
				data.type !== 'os-editor-autosave-response' ||
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
				{ type: 'os-editor-autosave-request', requestId },
				window.location.origin,
			);
		} catch {
			finish( { status: 'no-editor' } );
		}
	} );
}
