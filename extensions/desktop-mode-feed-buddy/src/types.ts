export interface FeedBuddyConfig {
	restBase: string;
	restNonce: string;
	pollMs: number;
}

export interface FeedSubscription {
	id: string;
	url: string;
	title: string;
	group: string;
	order: number;
	addedAt: string;
}

export type FeedStatus = 'online' | 'error';

export interface FeedSummary {
	id: string;
	status: FeedStatus;
	unread: number;
	lastFetchedAt: string | null;
	error: string | null;
}

export interface FeedItem {
	id: string;
	feedId: string;
	feedTitle: string;
	title: string;
	url: string;
	author: string;
	publishedAt: string | null;
	excerpt: string;
	unread: boolean;
}

export interface FeedBuddyServerState {
	subscriptions: FeedSubscription[];
	summaries: FeedSummary[];
	groups: string[];
	preferences: {
		soundEnabled: boolean;
	};
}

export interface FeedItemsPage {
	items: FeedItem[];
	nextCursor: string | null;
}

export interface FeedBuddyClientState {
	server: FeedBuddyServerState | null;
	selectedFeedId: string | null;
	items: FeedItem[];
	itemsForFeedId: string | null;
	itemsLoading: boolean;
	stateLoading: boolean;
	error: string | null;
	managerOpen: boolean;
	newFeedIds: string[];
	presenceMode: 'online' | 'away';
	retroMode: boolean;
}

export interface SharedStore< T > {
	state: T;
	getState(): Readonly< T >;
	notify(): void;
	subscribe( callback: ( state: Readonly< T > ) => void ): () => void;
}

export interface NativeRenderContext {
	signal: AbortSignal;
	onResize( callback: ( width: number, height: number ) => void ): () => void;
	onHide( callback: () => void ): () => void;
	onShow( callback: () => void ): () => void;
	markLoading(): void;
	markReady(): void;
	window: {
		send< T = unknown >( channel: string, payload?: T ): void;
		on< T = unknown >(
			channel: string,
			callback: ( payload: T ) => void,
		): () => void;
	};
}

export interface WidgetContext {
	id: string;
	pluginUrl: string;
	storage: {
		get< T = unknown >( key: string ): T | null;
		set< T = unknown >( key: string, value: T ): void;
		remove( key: string ): void;
		clear(): void;
	};
}

export interface DesktopWindowInstance {
	send< T = unknown >( channel: string, payload?: T ): void;
}

export interface DesktopApi {
	ready( callback: () => void ): void;
	getWindowConfig( id: string ): FeedBuddyConfig | undefined;
	createSharedStore< T >( key: string, initial: () => T ): SharedStore< T >;
	fetch(
		input: RequestInfo | URL,
		init?: RequestInit,
		options?: { windowId?: string; source?: string; silent?: boolean },
	): Promise< Response >;
	openWindow( id: string, options?: { source?: string } ): boolean;
	applyWindowTheme(
		id: string,
		theme: { tokens: Record< string, string > } | null,
	): void;
	confirm( options: {
		title: string;
		message: string;
		confirmLabel?: string;
		cancelLabel?: string;
		danger?: boolean;
	} ): Promise< boolean >;
	windowManager: {
		getById( id: string ): DesktopWindowInstance | undefined;
	};
}

declare global {
	interface Window {
		wp?: {
			os?: DesktopApi;
			i18n?: {
				__( text: string, domain?: string ): string;
				sprintf( format: string, ...values: Array< string | number > ): string;
			};
		};
		openStationWidgets?: Record<
			string,
			(
				container: HTMLElement,
				context: WidgetContext,
			) => void | ( () => void ) | Promise< void | ( () => void ) >
		>;
		openStationNativeWindows?: Record<
			string,
			(
				container: HTMLElement,
				context: NativeRenderContext,
			) => void | ( () => void ) | Promise< void | ( () => void ) >
		>;
	}
}
