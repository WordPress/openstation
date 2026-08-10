/**
 * OpenStation — Electron Adapter (shell side).
 *
 * The only browser-side code in the project that knows Electron exists.
 * It uses nothing but OpenStation's public API —
 * `wp.os.registerWindowAction`, `wp.os.windowManager`, `wp.os.hooks`,
 * `wp.os.config` — with no core patch behind it and no privileged
 * access. A third-party plugin could have written this file.
 *
 * ## Detection is one global
 *
 * The desktop app injects `window.openStationDesktopHost` through an
 * Electron `contextBridge` preload. **Presence of that object is the
 * whole probe** — synchronous, no network, cannot go stale. Absent, as
 * it is in every browser, this module registers nothing and returns.
 * That is what keeps OpenStation's browser experience untouched.
 *
 * ## Where the logic lives
 *
 * Here: wiring. In `host.ts`: detection and URL rules. In
 * `freed-windows.ts`: the here-or-there state machine. Both of those
 * are Electron-free and DOM-free so the tests can drive every
 * transition directly.
 */

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

/**
 * Shortest gap between two handshakes triggered by a stale nonce. The
 * shell refreshes its nonce on its own schedule; retrying faster would
 * spin against a value that has not moved yet.
 */
const NONCE_RETRY_MS = 60000;

/** CustomEvent fired on `document` when a window is freed. */
export const EVENT_FREED = 'os-desktop-host-freed';
/** CustomEvent fired on `document` when a freed window comes back. */
export const EVENT_DOCKED = 'os-desktop-host-docked';
/** CustomEvent fired on `document` when the connection changes phase. */
export const EVENT_CONNECTION = 'os-desktop-host-connection';

/** Loose view of the public shell API — only what the adapter calls. */
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
	electron?: ElectronAdapterApi;
}

declare global {
	interface Window {
		openStationElectronConfig?: AdapterConfig;
		wp?: { os?: ShellApi; i18n?: { __( t: string, d?: string ): string } };
	}
}

/** Text domain the adapter's strings are registered under. */
const TEXT_DOMAIN = 'openstation-electron-adapter';

/**
 * @param text Untranslated string.
 * @return Translated string, or the original when wp.i18n is absent.
 */
function __( text: string ): string {
	const i18n = window.wp?.i18n;
	return i18n?.__ ? i18n.__( text, TEXT_DOMAIN ) : text;
}

/**
 * @param name   Event name.
 * @param detail Payload.
 */
function emit( name: string, detail: unknown ): void {
	document.dispatchEvent( new CustomEvent( name, { detail } ) );
}

/**
 * Mark solo mode as running inside a real OS window.
 *
 * Core's `solo.css` keeps OpenStation's title bar, because a generic
 * embedder has no other chrome to offer. Here the OS frame *is* the
 * chrome, so the body gets marked and the adapter's own stylesheet
 * stands our title bar down.
 *
 * Done from JS because the server cannot know a solo request is being
 * rendered inside the app — only the page can see the injected global.
 */
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

/**
 * Wire the adapter up. Called once, after `wp.os` is assembled.
 *
 * @param bridge The host bridge.
 * @param os     The public shell API.
 * @param config The adapter's PHP-supplied config.
 * @return The adapter's public surface.
 */
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

	/**
	 * Hand the host the coordinates it needs to introduce itself and
	 * start its liveness pulse. Called at boot, and again whenever the
	 * host reports its credentials went stale.
	 */
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

	/**
	 * Set a window free onto the real desktop.
	 *
	 * @param windowId Window id.
	 * @return Whether the host took it.
	 */
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

	/**
	 * Bring a freed window back into the shell.
	 *
	 * The host answers `onWindowDocked` on close, which is what
	 * actually restores it — both this path and the user closing the
	 * native window land there, so there is exactly one dock-back code
	 * path.
	 *
	 * @param windowId Window id.
	 * @return Whether a native window was found and closed.
	 */
	async function dock( windowId: string ): Promise< boolean > {
		if ( ! freed.has( windowId ) ) {
			return false;
		}
		const result = await bridge.dockWindow( windowId );
		return !! result?.ok;
	}

	bridge.onWindowDocked( ( { windowId } ) => freed.release( windowId ) );

	bridge.onWindowFreed( ( { windowId } ) => {
		// The host confirming a window painted is the authoritative
		// "it really is out there" signal, and covers the case where
		// the shell did not initiate it.
		freed.adopt( windowId );
	} );

	bridge.onConnectionChange( ( state ) => {
		connection = state;
		emit( EVENT_CONNECTION, state );
		if ( 'nonce-stale' === state.state ) {
			const now = Date.now();
			if ( now - lastNonceRetry >= NONCE_RETRY_MS ) {
				lastNonceRetry = now;
				// The shell keeps `os.config.restNonce` fresh in place;
				// re-reading it is the whole refresh path.
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

	/*
	 * The ⋯ menu row. One row, not two: a window is either in the
	 * shell or on the real desktop, so a row that says what it will do
	 * right now describes the situation honestly, where two competing
	 * rows would imply it could be both.
	 */
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

	/**
	 * The adapter's own public surface, namespaced under
	 * `wp.os.electron` rather than baked into core's API: a capability
	 * that arrives with a plugin should be reachable the way a
	 * plugin's capabilities are.
	 */
	os.electron = api;

	// Learn who the host is, re-adopt anything already freed, then
	// introduce ourselves to the server.
	void bridge
		.getInfo()
		.then( ( result ) => {
			info = result;
			freed.adoptExisting( result?.freedWindows ?? [] );
		} )
		.catch( () => {
			// A host that cannot describe itself can still free
			// windows; carry on without the description.
		} )
		.then( handshake );

	return api;
}

/** How long to keep waiting for `wp.os` before giving up. */
const SHELL_WAIT_MS = 15000;
/** Gap between polls while waiting. */
const SHELL_POLL_MS = 50;

/**
 * Shortest gap between two attempts to reach the local agent.
 *
 * The retry triggers are user actions — a tab focus, a menu open — and
 * both can arrive in bursts. One loopback request per gesture is fine;
 * ten is not.
 */
const RETRY_MS = 1500;

/**
 * Resolve once the shell's API object exists, or null on timeout.
 *
 * A declared script dependency orders the *tags*, not the *execution*:
 * the shell bundle is deferred, so a classic script runs before it even
 * though it depends on it. Registering this bundle with a matching
 * `defer` strategy is the actual fix (see `includes/assets.php`), and
 * this is the belt to that pair of braces — because the failure mode
 * was invisible. The adapter simply did nothing, the app connected, the
 * desktop loaded, and the only evidence was one console line.
 *
 * So: never give up on the first look. Waiting costs nothing when the
 * shell is already there, and a future change to how either script is
 * enqueued cannot silently switch the feature off again.
 *
 * @return The shell API, or null if it never appeared.
 */
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

/** Entry point. Runs at parse time, possibly before the shell's boot. */
export function start(): void {
	// Solo mode is marked whether or not the shell API is up: it is
	// pure presentation, and the sooner the class lands the less chance
	// of a frame painting our title bar under the OS frame's.
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

	/*
	 * Inside a freed window the adapter has exactly one job.
	 *
	 * This surface is not a desk: it paints one window, has no dock and
	 * no taskbar, and its window controls belong to the OS frame. So
	 * none of `boot()` applies — there is no ⋯ row worth adding (the
	 * title bar is hidden), and no here-or-there state to keep (there
	 * is one window, and it is here). What it does need is somewhere to
	 * put a *second* window, and that somewhere is the desktop.
	 */
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

		/*
		 * Two ways to reach the desktop, tried in order of directness.
		 *
		 * 1. **The preload.** This page is inside the app, so the host
		 *    is right here: synchronous, no network, no permission to
		 *    negotiate.
		 * 2. **The local agent.** This page is in a browser, and the
		 *    app is running somewhere on the same machine. Costs one
		 *    loopback request to find out.
		 *
		 * The second is why "Send to your Mac" is not an app-only
		 * feature. The app is the thing that can give you native
		 * windows; the browser is where most people actually work.
		 * Making the browser ask the app is what joins those.
		 *
		 * Neither available is the ordinary case — a browser with no
		 * app — and is silent by design.
		 */
		const preload = getHostBridge();
		if ( preload ) {
			// `wp.os.ready` is the shell's own "the API is assembled"
			// signal. `wp.os` existing only means the early shim is in
			// place; `ready` is what guarantees the window manager and
			// the registries behind it are actually wired.
			os.ready( () => boot( preload, os, config ) );
			return;
		}

		/*
		 * Note what is NOT checked here: whether a pairing was baked
		 * into this page. The app may not have been running when the
		 * page loaded — that is exactly the case worth handling — so
		 * the absence of one is a reason to look again later, not a
		 * reason to give up.
		 */

		/*
		 * The app may not be running *yet*.
		 *
		 * Probing once at page load makes starting the app a
		 * refresh-to-notice affair, which is a poor answer to "I just
		 * opened it". So the probe is retried at the two moments the
		 * answer plausibly changed: when the tab regains focus (you
		 * launched the app and came back), and when a ⋯ menu opens (you
		 * are about to look for the row). Both are user actions, so
		 * nothing polls in the background.
		 *
		 * The menu repaints itself while open, so a probe that
		 * succeeds under the pointer puts the row there without a
		 * second click.
		 */
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
					// Either nothing was paired when this page loaded,
					// or the app has restarted onto a different port
					// since. The server knows the current answer.
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
