export const HOST_PROTOCOL_VERSION = 1;

export const CHANNELS = {

	INVOKE_HOST_INFO: 'openstation:host-info',

	INVOKE_FREE_WINDOW: 'openstation:free-window',

	INVOKE_DOCK_WINDOW: 'openstation:dock-window',

	INVOKE_FOCUS_WINDOW: 'openstation:focus-free-window',

	INVOKE_LIST_WINDOWS: 'openstation:list-free-windows',

	INVOKE_HANDSHAKE: 'openstation:handshake',

	INVOKE_CONNECTION: 'openstation:connection',

	INVOKE_DISCONNECT: 'openstation:disconnect',

	INVOKE_OPEN_WINDOW: 'openstation:open-window',

	INVOKE_CONNECT_SITE: 'openstation:connect-site',

	INVOKE_CONNECT_STATE: 'openstation:connect-state',

	EVENT_WINDOW_DOCKED: 'openstation:free-window-docked',

	EVENT_WINDOW_FREED: 'openstation:free-window-freed',

	EVENT_CONNECTION: 'openstation:connection-changed',

	EVENT_FRAME_INIT: 'openstation:frame-init',
} as const;

export type ConnectionPhase =
	| 'idle'
	| 'connecting'
	| 'connected'
	| 'error'
	| 'nonce-stale';

export interface ConnectionState {
	state: ConnectionPhase;
	siteUrl?: string;
	message?: string;
	interval?: number;
	lastBeat?: number;
	user?: string;
}

export interface HostInfo {
	isDesktopHost: true;
	protocol: number;
	platform: NodeJS.Platform;
	osLabel: string;
	appVersion: string;
	electronVersion: string;
	hostId: string;

	freedWindows: string[];
}

export interface FreeWindowRequest {
	windowId: string;
	url: string;
	title?: string;
	width?: number;
	height?: number;
	native?: boolean;
}

export interface FreeWindowResult {
	ok: boolean;
	windowId: string;
	reused: boolean;
	error?: string;
}

export interface HandshakeArgs {
	restUrl: string;
	nonce: string;
	siteUrl?: string;
}

export interface Bounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

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
