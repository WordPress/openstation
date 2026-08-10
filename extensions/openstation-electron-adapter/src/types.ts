/**
 * Electron Adapter — the shell-side contract.
 *
 * The two globals the desktop app's preloads inject, plus the config
 * blob the adapter's PHP prints. Kept apart from the controller so the
 * detection rules in `host.ts` can be tested without a shell.
 *
 * Two properties of this contract are load-bearing:
 *
 *   1. **Presence is the probe.** The adapter asks "is there a native
 *      host?" by testing for the global — synchronously, with no
 *      network and no race. Everything host-related is behind that one
 *      test, which is what keeps the browser experience unchanged when
 *      the app is not there.
 *   2. **The shell decides what a freed window loads.** The host takes
 *      a URL and opens a window on it; it does not know the difference
 *      between an iframe window and a native one, and must not have
 *      to. That knowledge stays on this side, where it already lives.
 */

/** Connection phases reported by the app's server heartbeat. */
export type ConnectionPhase =
	| 'idle'
	| 'connecting'
	| 'connected'
	| 'error'
	| 'nonce-stale';

/** Snapshot of the app's connection to the WordPress site. */
export interface ConnectionState {
	state: ConnectionPhase;
	siteUrl?: string;
	message?: string;
	interval?: number;
	lastBeat?: number;
	user?: string;
}

/** What `getInfo()` resolves to. */
export interface HostInfo {
	isDesktopHost: true;
	protocol: number;
	platform: string;
	/** "Mac" / "Windows PC" / "Linux desktop" — the menu label's tail. */
	osLabel: string;
	appVersion: string;
	electronVersion?: string;
	hostId: string;
	/**
	 * Ids of windows currently freed onto the desktop. Non-empty after
	 * a shell reload is normal and important: native windows outlive
	 * the page that created them, so the adapter re-adopts them on boot
	 * rather than assuming a clean slate.
	 */
	freedWindows: string[];
}

/** Request to free one window onto the real desktop. */
export interface FreeWindowRequest {
	windowId: string;
	url: string;
	title?: string;
	width?: number;
	height?: number;
	native?: boolean;
}

/** What the host answers a free request with. */
export interface FreeWindowResult {
	ok: boolean;
	windowId: string;
	reused: boolean;
	error?: string;
}

/** The global the desktop app injects into the shell window. */
export interface DesktopHostBridge {
	isDesktopHost: true;
	protocol: number;
	platform: string;
	osLabel: string;
	appVersion: string;
	getInfo(): Promise< HostInfo >;
	freeWindow( req: FreeWindowRequest ): Promise< FreeWindowResult >;
	dockWindow( windowId: string ): Promise< { ok: boolean } >;
	focusWindow( windowId: string ): Promise< { ok: boolean } >;
	listFreedWindows(): Promise< { windowIds: string[] } >;
	handshake( args: {
		restUrl: string;
		nonce: string;
		siteUrl?: string;
	} ): Promise< ConnectionState >;
	getConnection(): Promise< ConnectionState >;
	disconnect(): Promise< { ok: boolean } >;
	onWindowDocked( cb: ( payload: { windowId: string } ) => void ): () => void;
	onWindowFreed( cb: ( payload: { windowId: string } ) => void ): () => void;
	onConnectionChange( cb: ( state: ConnectionState ) => void ): () => void;
}

/**
 * The global a *freed* window gets — a much smaller surface, and
 * deliberately so. A freed window cannot free further windows.
 */
export interface DesktopFrameBridge {
	isFreedWindow: true;
	platform: string;
	osLabel: string;
	getWindowId(): string;
	onReady( cb: ( windowId: string ) => void ): void;
}

/** The config blob `includes/assets.php` prints before the bundle. */
export interface AdapterConfig {
	enabled: boolean;
	restUrl: string;
	restRoot: string;
	namespace: string;
	interval: number;
	protocol: number;
	soloParam: string;
	last: {
		connected: boolean;
		hostId: string;
		platform: string;
		osLabel: string;
		appVersion: string;
		protocol: number;
		lastSeen: number;
		connectedAt: number;
	};
}

/** The adapter's own public surface, published at `wp.os.electron`. */
export interface ElectronAdapterApi {
	isAvailable(): boolean;
	getInfo(): HostInfo | null;
	getSendLabel(): string;
	getDockLabel(): string;
	isFreedWindow(): boolean;
	free( windowId: string ): Promise< boolean >;
	dock( windowId: string ): Promise< boolean >;
	listFreed(): string[];
	isFreed( windowId: string ): boolean;
	getConnection(): ConnectionState;
}
