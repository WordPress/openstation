/**
 * Desktop Mode — Widget type definitions.
 *
 * Widgets live in a right-side column that paints above the wallpaper
 * but beneath every window. They're small persistent chrome for
 * passive content — clock, pending-comments count, a Marvel quote —
 * not launchers, not interactive tools. Think macOS Notification
 * Center widgets.
 *
 * Lifecycle mirrors the canvas-wallpaper contract: `mount(container)`
 * returns a teardown function the layer calls when the widget is
 * removed, the user re-orders, or the shell is torn down.
 */

/** Teardown callback returned by `mount`. */
export type WidgetTeardown = () => void;

/**
 * Namespaced key/value store scoped to the widget id. Available via
 * `ctx.storage` on the execution context passed to `mount`. Backed
 * by `localStorage` under the key `desktop-mode.widget.<id>.<key>` so
 * two different widgets that both persist a "layout" setting can't
 * collide. All methods are best-effort: a disabled storage engine
 * (private mode, quota exceeded, etc.) makes `set` a silent no-op
 * and `get` return `null` — widgets should never depend on
 * persistence being successful.
 *
 * Values are round-tripped through `JSON.stringify` / `JSON.parse`,
 * so plain objects / arrays / primitives work; class instances,
 * Dates, and Maps do not. Use `.toISOString()` / `Array.from(map)`
 * on the caller side when you need those.
 *
 * @public
 */
export interface WidgetStorage {
	/**
	 * Read a previously-stored value. Returns `null` when the key
	 * doesn't exist, the stored JSON is malformed, or localStorage
	 * is unavailable. Callers typically pattern-match on `null` to
	 * apply defaults.
	 */
	get< T = unknown >( key: string ): T | null;
	/**
	 * Persist a value. Silent no-op on failure (quota, disabled
	 * storage). Overwrites any existing value under the same key.
	 */
	set< T = unknown >( key: string, value: T ): void;
	/** Remove a single key from this widget's namespace. */
	remove( key: string ): void;
	/** Remove every key in this widget's namespace. Other widgets' keys are never touched. */
	clear(): void;
}

/**
 * Execution context passed to `mount`. Kept intentionally minimal:
 * most widgets only need the plugin URL to locate their own asset
 * bundle plus a scratch-pad for persistent user preferences. Anything
 * requiring richer shell state goes through `window.wp.desktop` —
 * the widget context is for "I need this to render" essentials only.
 */
export interface WidgetContext {
	/** The widget's own id — handy for data-attribute scoping. */
	id: string;
	/** Absolute URL of the desktop-mode plugin (no trailing slash). */
	pluginUrl: string;
	/**
	 * Per-widget key/value store. Auto-namespaced under
	 * `desktop-mode.widget.<id>.<key>` in `localStorage` so two
	 * different widgets can both persist a `preferences` / `layout`
	 * value without colliding.
	 */
	storage: WidgetStorage;
}

/**
 * A registered widget definition.
 *
 * `mount` receives the card body (already styled with the glass
 * backdrop, rounded corners, 16 px inner padding) and paints its own
 * contents. It must return a teardown that reverses every side effect
 * — event listeners, intervals, observers, subscriptions.
 */
export interface WidgetDef {
	/**
	 * Unique identifier. Used both as the localStorage key for
	 * enabled widgets and as the default HTML id suffix.
	 * Plugin-namespacing is on the author (e.g. `jorvy/quote`).
	 */
	id: string;
	/** Human-readable label shown in the picker + used for a11y. */
	label: string;
	/** One-line description shown in the picker beneath the label. */
	description: string;
	/** Dashicons class name (e.g., `dashicons-clock`). */
	icon: string;
	/**
	 * Allow the user to drag the widget out of the right-side column
	 * and place it anywhere on the desktop. When `true`, a thin chrome
	 * header (grip + label + remove button) renders above the body;
	 * drag is only initiated from the chrome, so text inputs inside
	 * the widget body are unaffected. Default `false`.
	 */
	movable?: boolean;
	/**
	 * Allow the user to resize the widget. When combined with
	 * `movable: true`, renders 8 grip handles (corners + edges). When
	 * `false` / absent for movability, only the bottom edge is
	 * draggable so width stays locked to the column. Default `false`.
	 */
	resizable?: boolean;
	/** Minimum width the user can shrink the card to (px). */
	minWidth?: number;
	/** Minimum height the user can shrink the card to (px). */
	minHeight?: number;
	/** Optional upper bound on user-driven resizing (px). */
	maxWidth?: number;
	/** Optional upper bound on user-driven resizing (px). */
	maxHeight?: number;
	/**
	 * Initial size applied the first time the widget mounts floating.
	 * Ignored when the widget sits in the column (that's
	 * column-width-driven). Default falls back to a sensible minimum
	 * if unset.
	 */
	defaultWidth?: number;
	defaultHeight?: number;
	/**
	 * Paint the widget into `container`. Return a teardown. May be
	 * sync or async — async mounts are awaited and race-checked
	 * against a generation counter so a rapid add/remove doesn't
	 * leak a pending mount.
	 */
	mount: (
		container: HTMLElement,
		ctx: WidgetContext,
	) => WidgetTeardown | Promise<WidgetTeardown>;
}

/**
 * Persisted user geometry for a floating (liberated-from-column)
 * widget. Absent from storage for column-docked widgets — the column
 * drives their geometry directly.
 */
export interface WidgetGeometry {
	x: number;
	y: number;
	width: number;
	height: number;
}
