import { injectRestNonce } from './inject-rest-nonce';

export interface TrackedFetchOpts {
	windowId?: string;
	source?: string;
	silent?: boolean;
}

export function trackedFetch(
	input: RequestInfo,
	init?: RequestInit,
	opts: TrackedFetchOpts = {},
): Promise< Response > {
	const fn = ( window.wp as
		| { os?: { fetch?: ( i: RequestInfo, ri?: RequestInit, o?: TrackedFetchOpts ) => Promise< Response > } }
		| undefined )?.os?.fetch;
	if ( typeof fn === 'function' ) {
		return fn( input, init, opts );
	}
	const finalInit = injectRestNonce( input, init );
	// eslint-disable-next-line no-restricted-syntax -- this IS the framework-fetch wrapper; the boot fallback before `wp.os` exists is the one legitimate use of raw fetch in the codebase.
	return fetch( input, finalInit );
}
