import { connectToAgent, fetchPairing } from './agent-bridge';
import { FreedWindows } from './freed-windows';
import { freedWindowUrl, getFrameBridge, getHostBridge, sendLabel } from './host';
import { installSoloForwarder } from './solo-forwarder';
import type { SoloShellApi } from './solo-forwarder';
import type {
	AdapterConfig,
	ConnectionState,
	DesktopHostBridge,
	ElectronAdapterApi,
	HostInfo,
} from './types';

const NONCE_RETRY_MS = 60000;

export const EVENT_FREED = 'os-desktop-host-freed';

export const EVENT_DOCKED = 'os-desktop-host-docked';

export const EVENT_CONNECTION = 'os-desktop-host-connection';

interface ShellApi {
	windowManager: {
		getById( id: string ): never;
		focus( win: never ): void;
	};
	config: { adminUrl: string; restNonce: string };
	HOOKS: Record< string, string >;
	hooks: {
		addAction(
			name: string,
			namespace: string,
			cb: ( payload: { windowId?: string } ) => void,
		): void;
	};
	ready( cb: () => void ): void;
	registerWindowAction( def: unknown ): void;
	registerNamespace( name: string, api: object ): void;
	fetch(
		input: RequestInfo,
		init?: RequestInit,
		opts?: { windowId?: string; source?: string; silent?: boolean },
	): Promise< Response >;
	electron?: ElectronAdapterApi;
}

declare global {
	interface Window {
		openStationElectronConfig?: AdapterConfig;
		wp?: { os?: ShellApi; i18n?: { __( t: string, d?: string ): string } };
	}
}

const TEXT_DOMAIN = 'openstation-electron-adapter';

function __( text: string ): string {
	const i18n = window.wp?.i18n;
	return i18n?.__ ? i18n.__( text, TEXT_DOMAIN ) : text;
}

function emit( name: string, detail: unknown ): void {
	document.dispatchEvent( new CustomEvent( name, { detail } ) );
}

function markSoloHost(): void {
	const frame = getFrameBridge();
	if ( ! frame ) {
		return;
	}
	document.body.classList.add( 'os-solo--host' );
	if ( 'darwin' === frame.platform ) {
		document.body.classList.add( 'os-solo--darwin' );
	}
}

export function boot(
	bridge: DesktopHostBridge,
	os: ShellApi,
	config: AdapterConfig,
): ElectronAdapterApi {
	let info: HostInfo | null = null;
	let connection: ConnectionState = { state: 'idle' };
	let lastNonceRetry = 0;

	const freed = new FreedWindows( {
		manager: os.windowManager as never,
		focusNative: ( id ) => {
			void bridge.focusWindow( id );
		},
		closeNative: ( id ) => {
			void bridge.dockWindow( id );
		},
		onFreed: ( windowId ) => emit( EVENT_FREED, { windowId } ),
		onDocked: ( windowId ) => emit( EVENT_DOCKED, { windowId } ),
	} );

	function handshake(): void {
		if ( ! config.enabled || ! config.restRoot ) {
			return;
		}
		void bridge
			.handshake( {
				restUrl: config.restRoot,
				nonce: os.config.restNonce,
				siteUrl: window.location.origin,
			} )
			.then( ( state ) => {
				connection = state;
				emit( EVENT_CONNECTION, state );
			} )
			.catch( ( err ) => {
				console.error( '[openstation-electron] handshake failed:', err );
			} );
	}

	async function free( windowId: string ): Promise< boolean > {
		const win = os.windowManager.getById( windowId ) as
			| ( { config: { native?: boolean; title?: string }; element: HTMLElement; getCurrentUrl?: () => string; id: string } )
			| undefined;
		if ( ! win ) {
			return false;
		}
		if ( freed.has( windowId ) ) {
			await bridge.focusWindow( windowId );
			return true;
		}

		const url = freedWindowUrl( win, {
			adminUrl: os.config.adminUrl,
			soloParam: config.soloParam,
			origin: window.location.origin,
		} );
		if ( ! url ) {
			return false;
		}

		const rect = win.element.getBoundingClientRect();
		const result = await bridge.freeWindow( {
			windowId,
			url,
			title: win.config.title,
			width: Math.round( rect.width ),
			height: Math.round( rect.height ),
			native: !! win.config.native,
		} );
		if ( ! result?.ok ) {
			console.error(
				'[openstation-electron] host refused to free the window:',
				result?.error,
			);
			return false;
		}

		freed.adopt( windowId );
		return true;
	}

	async function dock( windowId: string ): Promise< boolean > {
		if ( ! freed.has( windowId ) ) {
			return false;
		}
		const result = await bridge.dockWindow( windowId );
		return !! result?.ok;
	}

	bridge.onWindowDocked( ( { windowId } ) => freed.release( windowId ) );

	bridge.onWindowFreed( ( { windowId } ) => {

		freed.adopt( windowId );
	} );

	bridge.onConnectionChange( ( state ) => {
		connection = state;
		emit( EVENT_CONNECTION, state );
		if ( 'nonce-stale' === state.state ) {
			const now = Date.now();
			if ( now - lastNonceRetry >= NONCE_RETRY_MS ) {
				lastNonceRetry = now;

				handshake();
			}
		}
	} );

	os.hooks.addAction(
		os.HOOKS.WINDOW_RESTORED,
		'openstation-electron/redirect',
		( payload ) => payload?.windowId && freed.redirect( payload.windowId ),
	);
	os.hooks.addAction(
		os.HOOKS.WINDOW_FOCUSED,
		'openstation-electron/redirect',
		( payload ) => payload?.windowId && freed.redirect( payload.windowId ),
	);
	os.hooks.addAction(
		os.HOOKS.WINDOW_CLOSED,
		'openstation-electron/cleanup',
		( payload ) => payload?.windowId && freed.forget( payload.windowId ),
	);

	os.registerWindowAction( {
		id: 'openstation-electron/send-to-desktop',
		order: 60,
		icon: ( win: { id: string } ) =>
			freed.has( win.id ) ? 'dashicons-editor-contract' : 'dashicons-desktop',
		label: ( win: { id: string } ) =>
			freed.has( win.id )
				? __( 'Bring back into OpenStation' )
				: sendLabel( bridge.osLabel, __ ),
		onSelect: ( win: { id: string } ) => {
			if ( freed.has( win.id ) ) {
				void dock( win.id );
			} else {
				void free( win.id );
			}
		},
		owner: 'openstation-electron-adapter',
	} );

	const api: ElectronAdapterApi = {
		isAvailable: () => true,
		getInfo: () => info,
		getSendLabel: () => sendLabel( bridge.osLabel, __ ),
		getDockLabel: () => __( 'Bring back into OpenStation' ),
		isFreedWindow: () => null !== getFrameBridge(),
		free,
		dock,
		listFreed: () => freed.list(),
		isFreed: ( windowId ) => freed.has( windowId ),
		getConnection: () => connection,
	};

	os.registerNamespace( 'electron', api );

	void bridge
		.getInfo()
		.then( ( result ) => {
			info = result;
			freed.adoptExisting( result?.freedWindows ?? [] );
		} )
		.catch( () => {

		} )
		.then( handshake );

	return api;
}

const SHELL_WAIT_MS = 15000;

const SHELL_POLL_MS = 50;

const RETRY_MS = 1500;

function waitForShell(): Promise< ShellApi | null > {
	const ready = () => {
		const os = window.wp?.os;
		return os?.ready ? os : null;
	};

	const now = ready();
	if ( now ) {
		return Promise.resolve( now );
	}

	return new Promise( ( resolve ) => {
		const deadline = Date.now() + SHELL_WAIT_MS;
		const timer = setInterval( () => {
			const os = ready();
			if ( os ) {
				clearInterval( timer );
				resolve( os );
				return;
			}
			if ( Date.now() > deadline ) {
				clearInterval( timer );
				console.error(
					'[openstation-electron] wp.os never appeared — the adapter bundle loaded outside OpenStation.',
				);
				resolve( null );
			}
		}, SHELL_POLL_MS );
	} );
}

export function start(): void {

	if ( document.body ) {
		markSoloHost();
	} else {
		document.addEventListener( 'DOMContentLoaded', markSoloHost );
	}

	const config = window.openStationElectronConfig;
	if ( ! config ) {
		console.error(
			'[openstation-electron] openStationElectronConfig is missing — the bundle was enqueued without its config.',
		);
		return;
	}

	const frame = getFrameBridge();
	if ( frame ) {
		void waitForShell().then( ( os ) => {
			if ( os ) {
				os.ready( () =>
					installSoloForwarder(
						frame as Parameters< typeof installSoloForwarder >[ 0 ],
						os as unknown as SoloShellApi,
						config,
					),
				);
			}
		} );
		return;
	}

	void ( async () => {
		const os = await waitForShell();
		if ( ! os ) {
			return;
		}

		const preload = getHostBridge();
		if ( preload ) {

			os.ready( () => boot( preload, os, config ) );
			return;
		}

		let connecting = false;
		let booted = false;
		let lastTry = 0;

		let pairing = config.agent;

		const tryConnect = async (): Promise< void > => {
			if ( booted || connecting || Date.now() - lastTry < RETRY_MS ) {
				return;
			}
			connecting = true;
			lastTry = Date.now();
			try {
				let bridge = await connectToAgent( pairing );

				if ( ! bridge ) {

					const fresh = await fetchPairing(
						config.restUrl,
						os.config.restNonce,
					);
					if ( fresh?.hasAgent && fresh.url !== pairing?.url ) {
						pairing = fresh;
						bridge = await connectToAgent( fresh );
					}
				}

				if ( bridge && ! booted ) {
					booted = true;
					boot( bridge, os, config );
				}
			} finally {
				connecting = false;
			}
		};

		os.ready( () => {
			void tryConnect();

			os.hooks.addAction(
				os.HOOKS.WINDOW_MENU_OPENED,
				'openstation-electron/probe',
				() => void tryConnect(),
			);
			window.addEventListener( 'focus', () => void tryConnect() );
		} );
	} )();
}

start();
