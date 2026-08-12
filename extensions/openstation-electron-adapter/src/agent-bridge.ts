/**
 * Electron Adapter — reaching the desktop app from a browser tab.
 *
 * Inside the app, the shell talks to the host through an injected
 * preload global. A browser tab has no preload, so it talks to the same
 * app over HTTP instead: the app runs a loopback agent (see
 * `app/src/lib/agent.ts`) and hands its coordinates to the site on
 * every handshake, which prints them back into the admin page.
 *
 * The result is deliberately shaped as the **same `DesktopHostBridge`
 * interface** the preload provides, so `boot()` cannot tell the two
 * apart and there is one implementation of the here-or-there rules
 * rather than two that drift.
 *
 * Two honest differences, both handled here:
 *
 *   - **No push channel.** A preload can be told "the user closed that
 *     window"; HTTP cannot. So while anything is freed, this polls the
 *     agent and synthesises the same `onWindowDocked` /
 *     `onWindowFreed` callbacks. Polling stops the moment the last
 *     window comes back — an idle browser tab makes no requests.
 *   - **No server handshake.** The app owns its own connection to
 *     WordPress; a browser tab asking it to re-register would be a tab
 *     speaking for a process it does not own.
 */

import type {
	AgentPairing,
	ConnectionState,
	DesktopHostBridge,
	FreeWindowRequest,
	FreeWindowResult,
	HostInfo,
} from './types';

/** How often to ask the agent what is still open, while anything is. */
const POLL_MS = 2000;

/** How long to wait on the reachability probe before giving up. */
const PROBE_TIMEOUT_MS = 1500;

/**
 * Ask the site for the pairing it currently holds.
 *
 * A page bakes the pairing in once, at load, and the app's port is
 * ephemeral — start the app after the page loaded, or restart it, and
 * the baked value points at a port nothing is listening on. The server
 * always has the current one, because the app handshakes on launch.
 *
 * This one is a **site** request, so it goes through `wp.os.fetch` and
 * feeds the activity bus like any other. `silent: true` because the
 * user did not ask for it — it is a background re-read triggered by a
 * probe that failed, and spinning a window's loading indicator for it
 * would report activity nobody initiated.
 *
 * @param restUrl The adapter's `/host` REST URL.
 * @param nonce   The shell's REST nonce.
 * @return The current pairing, or null when the request fails.
 */
export async function fetchPairing(
	restUrl: string,
	nonce: string,
): Promise< AgentPairing | null > {
	if ( ! restUrl ) {
		return null;
	}
	try {
		const send = window.wp?.os?.fetch;
		const init: RequestInit = {
			credentials: 'same-origin',
			headers: { 'X-WP-Nonce': nonce },
		};
		const response = send
			? await send( restUrl, init, {
				silent: true,
				source: 'openstation-electron/pairing',
			} )
			// The shell always publishes `wp.os.fetch` before this can
			// run — `boot()` waits for `wp.os.ready`. Kept as a
			// fallback rather than a throw because failing to re-read a
			// port is not worth losing the connection over.
			// eslint-disable-next-line no-restricted-syntax -- boot-time fallback; see above.
			: await fetch( restUrl, init );
		if ( ! response.ok ) {
			return null;
		}
		const data = ( await response.json() ) as { agent?: AgentPairing };
		return data.agent ?? null;
	} catch {
		return null;
	}
}

/**
 * Probe the local agent and, if it answers, return a bridge onto it.
 *
 * Returns null for every failure — no agent configured, app not
 * running, wrong token, connection refused. A browser with no app is
 * the common case, not an error, so nothing is logged for it.
 *
 * @param config The `agent` block from the adapter's PHP config.
 * @return A bridge, or null when the app is not reachable.
 */
export async function connectToAgent(
	config: AgentPairing | undefined,
): Promise< DesktopHostBridge | null > {
	if ( ! config?.hasAgent || ! config.url || ! config.token ) {
		return null;
	}

	const base = config.url.replace( /\/+$/, '' );
	const headers = { Authorization: `Bearer ${ config.token }` };

	/**
	 * @param path Route below the agent root.
	 * @param init Fetch options.
	 * @return Parsed JSON.
	 */
	const call = async (
		path: string,
		init: RequestInit = {},
	): Promise< Record< string, unknown > > => {
		// eslint-disable-next-line no-restricted-syntax -- loopback call to the desktop app, not a site request: it has no window to attribute to and must not appear as site activity.
		const response = await fetch( `${ base }${ path }`, {
			...init,
			headers: {
				...headers,
				...( init.body ? { 'Content-Type': 'application/json' } : {} ),
			},
		} );
		if ( ! response.ok ) {
			throw new Error( `agent HTTP ${ response.status }` );
		}
		return ( await response.json() ) as Record< string, unknown >;
	};

	let info: HostInfo;
	try {
		const controller = new AbortController();
		const timer = setTimeout( () => controller.abort(), PROBE_TIMEOUT_MS );
		// eslint-disable-next-line no-restricted-syntax -- loopback reachability probe, not a site request; runs on every menu open and must stay invisible.
		const ping = await fetch( `${ base }/ping`, {
			headers,
			signal: controller.signal,
		} );
		clearTimeout( timer );
		if ( ! ping.ok ) {
			return null;
		}
		const data = ( await ping.json() ) as Record< string, unknown >;
		info = {
			isDesktopHost: true,
			protocol: Number( data.protocol ) || 1,
			platform: String( data.platform || config.platform || '' ),
			osLabel: String( data.osLabel || config.osLabel || '' ),
			appVersion: String( data.appVersion || '' ),
			hostId: String( data.hostId || '' ),
			freedWindows: Array.isArray( data.freedWindows )
				? ( data.freedWindows as string[] )
				: [],
		};
	} catch {
		// The app is not running, or is running for a different site.
		// Either way there is no host here; the browser behaves as a
		// browser.
		return null;
	}

	// Synthesised push channel. One timer, shared by both callbacks,
	// running only while at least one window is out on the desktop.
	const dockedListeners: Array< ( p: { windowId: string } ) => void > = [];
	const freedListeners: Array< ( p: { windowId: string } ) => void > = [];
	let known = new Set< string >( info.freedWindows );
	let timer: ReturnType< typeof setInterval > | null = null;

	const stopPolling = () => {
		if ( timer ) {
			clearInterval( timer );
			timer = null;
		}
	};

	const poll = async () => {
		let current: Set< string >;
		try {
			const data = await call( '/windows' );
			current = new Set(
				Array.isArray( data.windowIds ) ? ( data.windowIds as string[] ) : [],
			);
		} catch {
			// The app went away. Everything it held is, from the
			// browser's point of view, docked — leaving windows marked
			// as freed would strand them: minimized, unreachable, and
			// pointing at a process that no longer exists.
			for ( const id of known ) {
				dockedListeners.forEach( ( cb ) => cb( { windowId: id } ) );
			}
			known = new Set();
			stopPolling();
			return;
		}

		for ( const id of known ) {
			if ( ! current.has( id ) ) {
				dockedListeners.forEach( ( cb ) => cb( { windowId: id } ) );
			}
		}
		for ( const id of current ) {
			if ( ! known.has( id ) ) {
				freedListeners.forEach( ( cb ) => cb( { windowId: id } ) );
			}
		}
		known = current;
		if ( ! known.size ) {
			stopPolling();
		}
	};

	const startPolling = () => {
		if ( ! timer ) {
			timer = setInterval( () => void poll(), POLL_MS );
		}
	};

	if ( known.size ) {
		startPolling();
	}

	const idle: ConnectionState = { state: 'idle' };

	return {
		isDesktopHost: true,
		protocol: info.protocol,
		platform: info.platform,
		osLabel: info.osLabel,
		appVersion: info.appVersion,

		getInfo: async () => {
			const data = await call( '/ping' );
			const freed = Array.isArray( data.freedWindows )
				? ( data.freedWindows as string[] )
				: [];
			known = new Set( freed );
			if ( known.size ) {
				startPolling();
			}
			return { ...info, freedWindows: freed };
		},

		freeWindow: async ( req: FreeWindowRequest ) => {
			const result = ( await call( '/free', {
				method: 'POST',
				body: JSON.stringify( req ),
			} ) ) as unknown as FreeWindowResult;
			if ( result?.ok ) {
				known.add( req.windowId );
				startPolling();
			}
			return result;
		},

		dockWindow: async ( windowId: string ) => {
			const result = await call( '/dock', {
				method: 'POST',
				body: JSON.stringify( { windowId } ),
			} );
			return { ok: !! result.ok };
		},

		focusWindow: async ( windowId: string ) => {
			const result = await call( '/focus', {
				method: 'POST',
				body: JSON.stringify( { windowId } ),
			} );
			return { ok: !! result.ok };
		},

		listFreedWindows: async () => {
			const data = await call( '/windows' );
			return {
				windowIds: Array.isArray( data.windowIds )
					? ( data.windowIds as string[] )
					: [],
			};
		},

		// The app owns its own connection to WordPress. A browser tab
		// asking it to re-register would be speaking for a process it
		// does not own.
		handshake: () => Promise.resolve( idle ),
		getConnection: () => Promise.resolve( idle ),
		disconnect: () => Promise.resolve( { ok: false } ),

		onWindowDocked: ( cb ) => {
			dockedListeners.push( cb );
			return () => {
				const i = dockedListeners.indexOf( cb );
				if ( i >= 0 ) {
					dockedListeners.splice( i, 1 );
				}
			};
		},
		onWindowFreed: ( cb ) => {
			freedListeners.push( cb );
			return () => {
				const i = freedListeners.indexOf( cb );
				if ( i >= 0 ) {
					freedListeners.splice( i, 1 );
				}
			};
		},
		onConnectionChange: () => () => {},
	};
}
