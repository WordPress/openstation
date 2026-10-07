export interface ConfirmSpec {
	title?: string;
	message: string;
	label?: string;
	danger?: boolean;
}

export interface ControlDef {
	id: string;
	label: string;
	action: string;
	icon: string;
	order: number;
	confirm: ConfirmSpec | null;
	args: Record< string, unknown >;
	placement?: 'left' | 'right';
}

export interface AppearanceDef {
	theme?: Record< string, string >;
	controls?: Record< string, unknown >;
	slots?: Record< string, { html: string } >;
}

export interface TabDef {
	value: string;
	label: string;
	position: number;
}

export interface AppConfig {
	osApp: true;
	id: string;
	title: string;
	endpoint: string;

	restRoot?: string;
	restNonce?: string;
	state: Record< string, unknown >;
	titleBarButtons: ControlDef[];
	windowActions: ControlDef[];
	appearance: AppearanceDef;
	extra: Record< string, unknown >;

	actions?: string[];

	lifecycle?: string[];

	channels?: Record< string, string >;

	watch?: string[];
	tabs?: TabDef[];

	client?: boolean;

	data?: unknown;
}

export function appAnnounceSource( windowId: string ): string {
	return `openstation-app-runtime:${ windowId }`;
}

export interface MenuItemDef {
	id: string;
	label: string;
	action: string;
	args: Record< string, unknown >;
	icon: string;
	danger: boolean;
	disabled: boolean;
}

export type Effect =
	| { type: 'toast'; message: string }
	| { type: 'title'; title: string }
	| { type: 'close' }
	| { type: 'open'; window: string }
	| { type: 'open_url'; url: string; title?: string; icon?: string }
	| { type: 'badge'; count: number }
	| { type: 'icon'; icon: string }
	| { type: 'announce'; contentType: string; action: string; ids: number[] }
	| { type: 'menu'; items: MenuItemDef[] }
	| { type: 'send'; channel: string; payload?: unknown }
	| { type: 'refresh_menu' }
	| { type: string; [ key: string ]: unknown };

export interface DispatchResponse {
	ok: true;
	state: Record< string, unknown >;
	html: string;

	data?: unknown;
	effects: Effect[];
}

export interface Binding {

	action: string;

	args: Record< string, unknown >;

	bind: string | null;

	debounce: number;
	confirm: ConfirmSpec | null;
}

export interface RuntimeHost {
	fetch: (
		input: string,
		init?: RequestInit,
		opts?: { windowId?: string; source?: string; silent?: boolean },
	) => Promise< Response >;
	confirm?: ( options: ConfirmSpec & { confirmLabel?: string } ) => Promise< boolean >;

	toast?: ( options: { message: string; duration?: number; type?: string } ) => void;
	setTitle?: ( windowId: string, title: string ) => void;
	closeWindow?: ( windowId: string ) => void;
	openWindow?: ( id: string ) => void;

	openUrl?: ( url: string, title: string, icon?: string ) => void;
	setBadge?: ( appId: string, count: number ) => void;

	setIcon?: ( appId: string, art: string ) => void;
	announce?: ( contentType: string, action: string, ids: number[] ) => void;
	menu?: (
		position: { x: number; y: number },
		items: MenuItemDef[],
		pick: ( item: MenuItemDef ) => void,
	) => void;
	send?: ( channel: string, payload: unknown ) => void;

	refreshMenu?: () => void;

	onBroadcast?: ( topic: string, cb: ( firedTopic: string, payload?: unknown ) => void ) => () => void;
	loadComponents?: ( tags: string[] ) => Promise< void >;
	applyAppearance?: ( windowId: string, appearance: AppearanceDef ) => void;
}
