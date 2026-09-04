/**
 * App Framework runtime — wire shapes.
 *
 * Mirrors what `includes/framework/wordpress.php` puts in a window's
 * config blob (`openstation_apps_client_config()`) and what
 * `App\Runtime::dispatch()` returns.
 *
 * @public
 */

/** Confirmation the shell asks for before a control dispatches. */
export interface ConfirmSpec {
	title?: string;
	message: string;
	label?: string;
	danger?: boolean;
}

/** A title-bar button or a ⋯-menu row declared in PHP. */
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

/** Per-window chrome declared in PHP. */
export interface AppearanceDef {
	theme?: Record< string, string >;
	controls?: Record< string, unknown >;
	slots?: Record< string, { html: string } >;
}

/** An extra tab declared in PHP; its panel is a second mount root. */
export interface TabDef {
	value: string;
	label: string;
	position: number;
}

/** The config blob `wp.os.getWindowConfig( id )` returns for an app. */
export interface AppConfig {
	osApp: true;
	id: string;
	title: string;
	endpoint: string;
	/** The site's REST root — what `ctx.fetch` resolves relative paths against. */
	restRoot?: string;
	restNonce?: string;
	state: Record< string, unknown >;
	titleBarButtons: ControlDef[];
	windowActions: ControlDef[];
	appearance: AppearanceDef;
	extra: Record< string, unknown >;
	/** Every declared action name. */
	actions?: string[];
	/** Declared lifecycle handlers: `resize` | `show` | `hide` | `focus` | `blur` | `reopen`. */
	lifecycle?: string[];
	/** Channel → action subscriptions. */
	channels?: Record< string, string >;
	/** Content types whose `os.<type>.changed` broadcasts re-render the app. */
	watch?: string[];
	tabs?: TabDef[];
	/** The app ships a `.os.ts` client view (loaded with the window). */
	client?: boolean;
	/**
	 * `App::data()` computed at registration (`App::prefetch()`), so a
	 * client view paints from the declared state before the `mount`
	 * round trip instead of behind a spinner for its duration.
	 */
	data?: unknown;
}

/**
 * The `source` tag every content-change broadcast an app window
 * produces carries — through the `announce` effect or `ctx.host.announce`
 * — so the same window's `watch()` can tell its own echo from a change
 * made elsewhere and skip the redundant refresh: the dispatch that
 * announced already returned the fresh `data()`.
 */
export function appAnnounceSource( windowId: string ): string {
	return `openstation-app-runtime:${ windowId }`;
}

/** One item of a `menu` effect. */
export interface MenuItemDef {
	id: string;
	label: string;
	action: string;
	args: Record< string, unknown >;
	icon: string;
	danger: boolean;
	disabled: boolean;
}

/** One side effect an action queued. */
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

/** A successful dispatch. */
export interface DispatchResponse {
	ok: true;
	state: Record< string, unknown >;
	html: string;
	/** What `App::data()` returned — the client view's input. */
	data?: unknown;
	effects: Effect[];
}

/** What a trigger element resolved to. */
export interface Binding {
	/** Action to dispatch; `set` when only `os-bind` is present. */
	action: string;
	/** Arguments: `os-arg-*` attributes plus the event's detail. */
	args: Record< string, unknown >;
	/** State key `os-bind` writes before dispatching. */
	bind: string | null;
	/** Milliseconds to coalesce rapid triggers; 0 = immediate. */
	debounce: number;
	confirm: ConfirmSpec | null;
}

/**
 * The slice of the shell the runtime needs. `index.ts` builds it
 * from `wp.os`; tests hand in a stub.
 */
export interface RuntimeHost {
	fetch: (
		input: string,
		init?: RequestInit,
		opts?: { windowId?: string; source?: string; silent?: boolean },
	) => Promise< Response >;
	confirm?: ( options: ConfirmSpec & { confirmLabel?: string } ) => Promise< boolean >;
	/** A toast; `duration` in ms overrides the shell's default dwell. */
	toast?: ( options: { message: string; duration?: number } ) => void;
	setTitle?: ( windowId: string, title: string ) => void;
	closeWindow?: ( windowId: string ) => void;
	openWindow?: ( id: string ) => void;
	/** Open an admin URL in an iframe window; `icon` falls back to the shell's generic glyph. */
	openUrl?: ( url: string, title: string, icon?: string ) => void;
	setBadge?: ( appId: string, count: number ) => void;
	/**
	 * Swap the art on every rail hosting the app's tile (dock,
	 * taskbar, desktop icon) — state-driven icons, the Recycle Bin's
	 * empty/full swap being the canonical case. `art` is an SVG data
	 * URI or image URL.
	 */
	setIcon?: ( appId: string, art: string ) => void;
	announce?: ( contentType: string, action: string, ids: number[] ) => void;
	menu?: (
		position: { x: number; y: number },
		items: MenuItemDef[],
		pick: ( item: MenuItemDef ) => void,
	) => void;
	send?: ( channel: string, payload: unknown ) => void;
	/**
	 * Rebuild the shell's registries from a fresh menu payload — the
	 * `refresh_menu` effect, for an action that changed what the
	 * server registers.
	 */
	refreshMenu?: () => void;
	/**
	 * Subscribe to a shell broadcast topic (`'*'` = all); returns the
	 * unsubscribe. The callback also receives the payload, so a watch
	 * can skip a broadcast this very window produced.
	 */
	onBroadcast?: ( topic: string, cb: ( firedTopic: string, payload?: unknown ) => void ) => () => void;
	loadComponents?: ( tags: string[] ) => Promise< void >;
	applyAppearance?: ( windowId: string, appearance: AppearanceDef ) => void;
}
