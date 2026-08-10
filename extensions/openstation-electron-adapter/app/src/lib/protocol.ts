/**
 * OpenStation Desktop — IPC channel names, protocol version, shared types.
 *
 * The single source of truth shared by the main process, all three
 * preloads, and (by name only) the adapter's shell bundle in
 * `../../../src/electron-adapter.ts`. Channel strings are namespaced
 * `openstation:` so they can never collide with anything Electron or a
 * future embedded page defines.
 *
 * `HOST_PROTOCOL_VERSION` is what the shell negotiates against. Bump it
 * when an IPC payload changes shape in a way an older shell cannot
 * read; the shell then degrades to "no host" rather than calling into a
 * contract it does not understand.
 */

/** Protocol version the shell checks before using the bridge. */
export const HOST_PROTOCOL_VERSION = 1;

/**
 * IPC channels.
 *
 * `INVOKE_*` are renderer→main request/response (`ipcRenderer.invoke`).
 * `EVENT_*` are main→renderer pushes (`webContents.send`).
 */
export const CHANNELS = {
	/** Renderer asks for platform / version / host identity. */
	INVOKE_HOST_INFO: 'openstation:host-info',
	/** Renderer asks the main process to open a freed native window. */
	INVOKE_FREE_WINDOW: 'openstation:free-window',
	/** Renderer asks to close a freed window (the "dock it back" path). */
	INVOKE_DOCK_WINDOW: 'openstation:dock-window',
	/** Renderer asks to focus an already-freed window. */
	INVOKE_FOCUS_WINDOW: 'openstation:focus-free-window',
	/** Renderer asks for the list of currently freed window ids. */
	INVOKE_LIST_WINDOWS: 'openstation:list-free-windows',
	/** Renderer hands the main process REST root + nonce for heartbeats. */
	INVOKE_HANDSHAKE: 'openstation:handshake',
	/** Renderer asks for the last handshake / heartbeat result. */
	INVOKE_CONNECTION: 'openstation:connection',
	/** Renderer asks to forget the site and show the connect screen. */
	INVOKE_DISCONNECT: 'openstation:disconnect',

	/**
	 * A *freed* window asks for another window to open as its own
	 * native window rather than inside itself.
	 *
	 * It does the same thing as `INVOKE_FREE_WINDOW`; what differs is
	 * who may call it. This one lives on the freed-window preload,
	 * where nothing else does. A freed window is a single-window
	 * surface — the shell inside it paints exactly one window and has
	 * no dock or taskbar — so a second window opened *inside* it stacks
	 * on the first with no way back to either. Launching a game from a
	 * freed Games window is exactly that case.
	 *
	 * The result is a sibling, not a child: freed windows are peers,
	 * and closing one says nothing about the others.
	 */
	INVOKE_OPEN_WINDOW: 'openstation:open-window',

	/** The connect screen asks the app to remember a site and load it. */
	INVOKE_CONNECT_SITE: 'openstation:connect-site',
	/** The connect screen asks for the current site + app description. */
	INVOKE_CONNECT_STATE: 'openstation:connect-state',

	/** Main tells the shell a freed window closed (dock it back). */
	EVENT_WINDOW_DOCKED: 'openstation:free-window-docked',
	/** Main tells the shell a freed window finished opening. */
	EVENT_WINDOW_FREED: 'openstation:free-window-freed',
	/** Main tells the shell the server connection state changed. */
	EVENT_CONNECTION: 'openstation:connection-changed',
	/** Main tells a freed window which OpenStation window it is. */
	EVENT_FRAME_INIT: 'openstation:frame-init',
} as const;

/** Connection phases reported by the server heartbeat. */
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

/** What `openstation:host-info` answers with. */
export interface HostInfo {
	isDesktopHost: true;
	protocol: number;
	platform: NodeJS.Platform;
	osLabel: string;
	appVersion: string;
	electronVersion: string;
	hostId: string;
	/**
	 * Ids of windows currently freed onto the desktop.
	 *
	 * Non-empty after a shell reload is normal and important: native
	 * windows outlive the page that created them, so the shell has to
	 * re-adopt them on boot rather than assume a clean slate.
	 */
	freedWindows: string[];
}

/** Request to free one OpenStation window onto the real desktop. */
export interface FreeWindowRequest {
	windowId: string;
	url: string;
	title?: string;
	width?: number;
	height?: number;
	native?: boolean;
}

/** What the main process answers a free request with. */
export interface FreeWindowResult {
	ok: boolean;
	windowId: string;
	reused: boolean;
	error?: string;
}

/** REST coordinates the shell hands the main process. */
export interface HandshakeArgs {
	restUrl: string;
	nonce: string;
	siteUrl?: string;
}

/** Window geometry remembered between sessions. */
export interface Bounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Human-readable name for the host OS, used to build the menu label
 * ("Send to your Mac"). It lives here rather than in the shell so a new
 * platform only needs this app updated.
 *
 * @param platform `process.platform`.
 * @return Display name.
 */
export function osLabelFor( platform: NodeJS.Platform | string ): string {
	switch ( platform ) {
		case 'darwin':
			return 'Mac';
		case 'win32':
			return 'Windows PC';
		default:
			return 'Linux desktop';
	}
}
