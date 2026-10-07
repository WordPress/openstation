import type {
	AgentPairing,
	ConnectionState,
	DesktopHostBridge,
	FreeWindowRequest,
	FreeWindowResult,
	HostInfo,
} from './types';

const POLL_MS = 2000;

const PROBE_TIMEOUT_MS = 1500;

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

export async function connectToAgent(
	config: AgentPairing | undefined,
): Promise< DesktopHostBridge | null > {
	if ( ! config?.hasAgent || ! config.url || ! config.token ) {
		return null;
	}

	const base = config.url.replace( /\/+$/, '' );
	const headers = { Authorization: `Bearer ${ config.token }` };

	const call = async (
		path: string,
		init: RequestInit = {},
	): Promise< Record< string, unknown > > => {

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

		return null;
	}

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
