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
	platform: string;

	osLabel: string;
	appVersion: string;
	electronVersion?: string;
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

export interface DesktopFrameBridge {
	isFreedWindow: true;
	platform: string;
	osLabel: string;
	getWindowId(): string;
	onReady( cb: ( windowId: string ) => void ): void;

	openWindow?( req: FreeWindowRequest ): Promise< { ok: boolean; error?: string } >;
}

export interface AgentPairing {

	url: string;

	token?: string;
	hasAgent: boolean;
	osLabel?: string;
	platform?: string;
}

export interface AdapterConfig {
	enabled: boolean;
	restUrl: string;
	restRoot: string;
	namespace: string;
	interval: number;
	protocol: number;
	soloParam: string;
	agent?: AgentPairing;
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
