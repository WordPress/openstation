/**
 * Desktop Mode — Window.
 *
 * A single desktop window: title bar, iframe content, drag, resize,
 * state management. The class orchestrates — pointer math, tab
 * lifecycle, menu open/close, and postMessage routing live in sibling
 * modules under `src/window/*.ts`, keyed off a shared `Window`
 * instance threaded in as the first argument of each helper.
 *
 * Fields prefixed with `_` are package-internal: helpers in this
 * folder may touch them, but nothing outside `src/window/` should.
 * Kept `public` at the TypeScript level only because `private`
 * prevents the sibling modules from seeing them.
 *
 * @since 6.9.0
 */

import type { WindowConfig, WindowState } from './../types';
import { activity } from './../activity';
import { getSyntheticIframe } from './../connection';
import { HOOKS, applyFilters, doAction } from './../hooks';
import { __ } from './../i18n';
import {
	addParentSubscriber,
	clearWindowChannels,
	dispatchToNative,
	enqueueWindowSend,
	isWindowContentReady,
	markWindowContentLoading,
	markWindowContentReady,
	type WindowChannelCb,
} from './../window-channels';
// Register the window-chrome atoms — no named import needed, the
// side-effect `defineComponent(...)` calls wire them up.
import './../ui/components/wpd-window-button/wpd-window-button';
import './../ui/components/wpd-menu/wpd-menu';
import './../ui/components/wpd-tab-chip/wpd-tab-chip';

import { createWindowElement, updateFullscreenBodyClass } from './dom';
import { handleWindowMessage } from './iframe-bridge';
import {
	buttonsForWindow,
	subscribeTitleBarButtons,
	type TitleBarButtonDef,
} from './../title-bar-buttons/registry';
import { paintTitleBarButtonIcon } from './../title-bar-buttons/paint-icon';
import {
	applyWindowTheme,
	clearWindowTheme,
} from './../window-chrome/apply';
import { subscribeWindowThemes } from './../window-chrome/themes/registry';
import { subscribeWindowControls } from './../window-chrome/controls/registry';
import { paintWindowControls } from './../window-chrome/controls/render';
import { subscribeWindowSlots } from './../window-chrome/slots/registry';
import { paintWindowSlots } from './../window-chrome/slots/render';
import {
	subscribeWindowChromes,
	type ChromeRenderHandle,
} from './../window-chrome/chrome/registry';
import {
	captureChromeState,
	CUSTOM_CHROME_CLASS,
	mountWindowChrome,
	resolveChromeId,
	STANDARD_CHROME_ID,
} from './../window-chrome/chrome/apply';

/**
 * Origin snapshot taken at module load. Same-origin guards in this
 * module compare against this value so a plugin script that mutates
 * `window.location` after boot can't relax the check.
 *
 * @since 0.11.0
 */
const INITIAL_ORIGIN = window.location.origin;
import {
	addExternalTab,
	externalTabCount,
	externalTabsSnapshot,
	handleTabStripClick,
	syncActiveTab,
} from './tabs';
import {
	closeActionsMenu,
	flipStartupCheckOptimistically,
	openActionsMenu,
	refreshStartupCheckState,
	toggleActionsMenu,
} from './menus';
import { handleDragStart, handleResizeStart } from './pointer';

/** Animation mode accepted by `Window.requestAttention()`. */
export type WindowAttentionMode = 'pulse' | 'shake' | 'bounce' | null;

/** Options accepted by `Window.requestAttention()`. */
export interface WindowAttentionOptions {
	/** Auto-clear after this many ms. `0` = until cleared. Default 4000. */
	durationMs?: number;
	/** Animation intensity. Default `'normal'`. */
	intensity?: 'subtle' | 'normal' | 'strong';
}

/**
 * Desktop Window class.
 *
 * Manages a single window: its DOM element, iframe, drag/resize
 * behavior, and state.
 */
export class Window {
	public readonly id: string;
	public readonly config: WindowConfig;
	public readonly element: HTMLElement;
	/**
	 * Iframe for iframe-backed windows. Null for native windows, which
	 * render into the body directly via {@link WindowConfig.render}.
	 */
	public readonly iframe: HTMLIFrameElement | null;
	public state: WindowState = 'normal';

	/** @internal */
	public _titleBar: HTMLElement;
	/** @internal */
	public _titleEl: HTMLElement;
	/** @internal */
	public _isDragging = false;
	/** @internal */
	public _isResizing = false;
	/** @internal */
	public _isDestroyed = false;
	/** @internal */
	public _boundOnMessage: ( e: MessageEvent ) => void;
	/** @internal */
	public _dragOffsetX = 0;
	/** @internal */
	public _dragOffsetY = 0;
	/** @internal */
	public _resizeStartX = 0;
	/** @internal */
	public _resizeStartY = 0;
	/** @internal */
	public _resizeStartW = 0;
	/** @internal */
	public _resizeStartH = 0;

	/**
	 * Stored geometry before maximize/snap, for restore.
	 * @internal
	 */
	public _savedGeometry: { x: number; y: number; width: number; height: number } | null = null;

	/**
	 * Snapshot taken before entering fullscreen so we can restore the
	 * caller's previous state (normal or maximized) on exit.
	 * @internal
	 */
	public _savedFullscreenState: {
		state: WindowState;
		x: number;
		y: number;
		width: number;
		height: number;
	} | null = null;

	/**
	 * External-link sub-tabs keyed by a generated tab id. Each carries
	 * its own iframe, its label, and a cleanup hook for the readiness
	 * probe. Exists only for iframe windows — native windows skip the
	 * whole code path.
	 * @internal
	 */
	public _externalTabs: Map<
		string,
		{
			tabEl: HTMLElement;
			iframe: HTMLIFrameElement;
			url: string;
			label: string;
			cancelProbe: () => void;
		}
	> = new Map();

	/**
	 * Monotonic id generator for external tabs.
	 * @internal
	 */
	public _externalTabSeq = 0;

	/**
	 * Unsubscribe handle for the title-bar-button registry. Cleared
	 * on close so the closed window stops repainting on registry
	 * changes. Null until the constructor wires it up.
	 * @internal
	 */
	public _titleBarButtonsUnsubscribe: ( () => void ) | null = null;

	/**
	 * Unsubscribe handle for the window-theme registry. Cleared on
	 * close so the closed window stops re-applying theme tokens
	 * when other plugins register / unregister themes.
	 * @internal
	 * @since 0.6.0
	 */
	public _windowThemesUnsubscribe: ( () => void ) | null = null;

	/**
	 * Unsubscribe handle for the window-control registry. Cleared on
	 * close.
	 * @internal
	 * @since 0.6.0
	 */
	public _windowControlsUnsubscribe: ( () => void ) | null = null;

	/**
	 * Teardown handle returned by the most recent
	 * {@link paintWindowControls} call. Re-paint replaces it; close
	 * invokes the last one to drop event listeners on plugin-supplied
	 * `render` callbacks.
	 * @internal
	 * @since 0.6.0
	 */
	public _windowControlsTeardown: ( () => void ) | null = null;

	/**
	 * Unsubscribe handle for the window-slot registry. Cleared on
	 * close.
	 * @internal
	 * @since 0.6.0
	 */
	public _windowSlotsUnsubscribe: ( () => void ) | null = null;

	/**
	 * Teardown handle returned by the most recent
	 * {@link paintWindowSlots} call.
	 * @internal
	 * @since 0.6.0
	 */
	public _windowSlotsTeardown: ( () => void ) | null = null;

	/**
	 * Handle returned by the active custom chrome's `render()`.
	 * `null` when the window uses `'core/standard'` (the default —
	 * Layers 1-3 paint without a chrome handle). Tracked so window-
	 * state updates can flow into `handle.update()` and `close()`
	 * can call `handle.destroy()`.
	 *
	 * **Experimental** since 0.6.0.
	 *
	 * @internal
	 */
	public _chromeHandle: ChromeRenderHandle | null = null;

	/**
	 * Id of the chrome currently mounted (or `'core/standard'`).
	 *
	 * @internal
	 * @since 0.6.0
	 */
	public _chromeId: string = STANDARD_CHROME_ID;

	/**
	 * Unsubscribe handle for the chrome registry. Cleared on close.
	 *
	 * @internal
	 * @since 0.6.0
	 */
	public _windowChromesUnsubscribe: ( () => void ) | null = null;

	/**
	 * Teardown function returned by the native-window render callback
	 * (if any). Invoked on `close()` so plugin authors can dispose
	 * listeners, intervals, observers, and anything else tied to the
	 * window's lifecycle. Set in `hydrateNative()`.
	 * @internal
	 */
	public _nativeRenderTeardown: ( () => void ) | null = null;

	/**
	 * Which tab is currently foregrounded: 'primary' or a tab id.
	 * @internal
	 */
	public _activeTabId: 'primary' | string = 'primary';

	/** Callbacks for external events. */
	public onFocusRequest: ( ( win: Window ) => void ) | null = null;
	public onClose: ( ( win: Window ) => void ) | null = null;
	public onMinimize: ( ( win: Window ) => void ) | null = null;
	/**
	 * Invoked when the title-bar menu's "Open another" item is clicked.
	 * The window manager wires this to `openNew()`.
	 */
	public onOpenAnother: ( ( win: Window ) => void ) | null = null;

	/**
	 * Invoked when the title-bar menu's "Open on startup" item is
	 * toggled. The shell wires this to the public
	 * `wp.desktop.setDefaultWindow()` call, which writes the user's
	 * preference and fires the `default-window-changed` event.
	 */
	public onToggleStartup: ( ( win: Window ) => void ) | null = null;

	/**
	 * Resolver for the active snap-to-grid config. Wired by the
	 * window-manager on construction. Returns `enabled: false` when
	 * snap is off, otherwise the cell dimensions to round drag /
	 * resize values to.
	 */
	public snapConfigProvider:
		| ( () => { enabled: boolean; cellWidth: number; cellHeight: number } )
		| null = null;

	/**
	 * Called by the drag pointer-move handler on every frame with
	 * the current cursor position. The window-manager uses this to
	 * power edge-snap detection + preview.
	 */
	public onDragMove: ( ( win: Window, clientX: number, clientY: number ) => void ) | null = null;

	/**
	 * Called by the drag pointer-up handler when the drag ends.
	 * Returns `true` if the manager consumed the drop (e.g., snapped
	 * the window into a zone) and the pointer layer should SKIP
	 * emitting the usual `moved` / `drag-end` actions. Returns
	 * `false` to let the default flow run.
	 */
	public onDragEnd: ( ( win: Window ) => boolean ) | null = null;

	/**
	 * Bound handler used to close the actions menu on outside clicks.
	 * @internal
	 */
	public _boundOnDocumentPointerDown: ( ( e: PointerEvent ) => void ) | null = null;

	/**
	 * ResizeObserver watching the body element. Fires the inline
	 * `config.onResize` callback AND the `WINDOW_BODY_RESIZED` hook
	 * on every size change. Null when the environment lacks
	 * ResizeObserver (old browsers, jsdom without a shim).
	 * @internal
	 */
	public _bodyResizeObserver: ResizeObserver | null = null;

	constructor( config: WindowConfig ) {
		this.id = config.id;
		this.config = config;
		this.element = createWindowElement( config );
		this.iframe = config.native
			? null
			: ( this.element.querySelector( '.wp-desktop-window__iframe' ) as HTMLIFrameElement );
		this._titleBar = this.element.querySelector( '.wp-desktop-window__titlebar' ) as HTMLElement;
		this._titleEl = this.element.querySelector( '.wp-desktop-window__title' ) as HTMLElement;
		this._boundOnMessage = ( e: MessageEvent ) => handleWindowMessage( this, e );

		this.bindEvents();

		// Render any plugin-registered title-bar buttons that match
		// this window. Subscribe so registrations made AFTER this
		// window opens still take effect; the unsubscribe is wired
		// in `close()`.
		this.renderCustomTitleBarButtons();
		this._titleBarButtonsUnsubscribe = subscribeTitleBarButtons( () => {
			this.renderCustomTitleBarButtons();
		} );

		// Apply Layer-1 theme tokens (CSS variables) to the outer
		// element. Resolution order: explicit `appearance.theme`
		// override > registered theme whose `match` returns true >
		// no theme (empty token map). Re-applied whenever the theme
		// registry mutates so live activation paints immediately.
		applyWindowTheme( this, this.config.appearance?.theme );
		this._windowThemesUnsubscribe = subscribeWindowThemes( () => {
			if ( this._isDestroyed ) {
				return;
			}
			applyWindowTheme( this, this.config.appearance?.theme );
		} );

		// Layer-2 controls. The controls cluster is rendered from
		// the registry (built-ins + plugin entries) so plugins can
		// reorder, hide, or replace the close/min/max buttons via
		// `appearance.controls`. Re-paints whenever the registry
		// mutates so live activation appears immediately.
		this.repaintWindowControls();
		this._windowControlsUnsubscribe = subscribeWindowControls( () => {
			if ( this._isDestroyed ) {
				return;
			}
			this.repaintWindowControls();
		} );

		// Layer-3 slots. The title bar exposes named slot hosts
		// (icon, title, before-titlebar, …) that plugins can replace
		// or augment. Re-paints whenever the slot registry mutates.
		this.repaintWindowSlots();
		this._windowSlotsUnsubscribe = subscribeWindowSlots( () => {
			if ( this._isDestroyed ) {
				return;
			}
			this.repaintWindowSlots();
		} );

		// Layer-4 (Experimental) — custom chrome. Mounts when a
		// non-`core/standard` chrome resolves; otherwise the standard
		// title bar painted above stays put. Re-resolves on registry
		// mutation so a chrome registered AFTER this window opens
		// still takes effect.
		this.remountWindowChrome();
		this._windowChromesUnsubscribe = subscribeWindowChromes( () => {
			if ( this._isDestroyed ) {
				return;
			}
			// Only swap when the resolved id actually changed.
			const next = resolveChromeId( this );
			if ( next !== this._chromeId ) {
				this.remountWindowChrome();
			}
		} );

		// Native render is intentionally NOT run here. The window
		// manager calls {@link hydrateNative} AFTER appending the
		// element to the desktop, so the plugin's render callback
		// receives a body that's already connected to the document.
		// Custom elements upgrade on connection (HTML spec), so any
		// `<wpd-*>` the plugin creates or populates via declarative
		// setters (`.items = […]`, `.value = …`) hits a real class
		// setter rather than stashing an own data property that
		// would later shadow the prototype setter.

		// Body-resize observer — fires inline `onResize( w, h )` +
		// the `WINDOW_BODY_RESIZED` hook whenever the
		// `.wp-desktop-window__body` element's dimensions change.
		// Measured on the BODY (not the outer window) so subscribers
		// get the paintable area with title-bar + tab-strip already
		// subtracted, matching what a canvas inside the body reads.
		// Attached for both native and iframe windows — either kind
		// may host content that needs to react to size changes.
		this._bodyResizeObserver = this.installBodyResizeObserver();

		// Session-restored minimized windows must paint already-minimized
		// on the first frame — otherwise the user sees the opening fade-in
		// followed by the minimize transition (a visible flicker on every
		// page refresh). Apply the minimized class before the element is
		// in the DOM so no transition runs, skip the opening animation,
		// hide the iframe immediately, and bypass the emitChange save the
		// regular minimize() path would fire for state the server already
		// has.
		if ( config.initialState === 'minimized' ) {
			this.state = 'minimized';
			this.element.classList.add( 'wp-desktop-window--minimized' );
			if ( this.iframe ) {
				this.iframe.style.visibility = 'hidden';
			}
			return;
		}

		// Session-restored snapped windows need their class from
		// frame 1 so the flat inner corner paints correctly during
		// the opening animation — otherwise the window briefly shows
		// its full border-radius on all 4 corners, producing a
		// visible seam between two partner-snapped windows. Geometry
		// re-snap happens in `applyInitialState` so the current
		// viewport's `halfW` always wins (defending against viewport
		// changes between save + restore).
		if (
			config.initialState === 'snapped-left' ||
			config.initialState === 'snapped-right'
		) {
			this.element.classList.add(
				`wp-desktop-window--${ config.initialState }`,
			);
		}

		// Fresh open (or restored to a visible state). Play the opening
		// animation, then remove the class.
		this.element.classList.add( 'wp-desktop-window--opening' );
		this.element.addEventListener( 'animationend', () => {
			this.element.classList.remove( 'wp-desktop-window--opening' );
		}, { once: true } );

		// Maximized/fullscreen restores go through the class-driven path
		// after the geometry renders, so the state transition animates.
		// 'normal' is the default — applying it would echo a redundant
		// save.
		if ( config.initialState && config.initialState !== 'normal' ) {
			requestAnimationFrame( () => this.applyInitialState( config.initialState! ) );
		}
	}

	/**
	 * Run the plugin's render callback for a native window.
	 *
	 * Called by the window manager immediately after appending the
	 * window element to the desktop. At that point the element (and
	 * everything reachable inside it) is connected to the document,
	 * so custom elements upgrade synchronously — a prerequisite for
	 * the declarative component-kit API (`element.items = […]`) to
	 * reach the class setter instead of creating a shadowing own
	 * data property on the pre-upgrade instance.
	 *
	 * No-op for iframe windows.
	 *
	 * Per-event contract preserved from 0.10.x:
	 *   - `NATIVE_WINDOW_BEFORE_RENDER` filter fires, same args.
	 *   - `NATIVE_WINDOW_AFTER_RENDER` action fires, same args.
	 *   - `config.autofocus` is honoured with a `requestAnimationFrame`
	 *     defer so layout side-effects of `render()` settle before
	 *     `.focus()` resolves.
	 *
	 * @since 0.12.0
	 * @internal
	 */
	public hydrateNative(): void {
		if ( ! this.config.native || ! this.config.render ) {
			return;
		}
		const rawBody = this.element.querySelector(
			'.wp-desktop-window__body',
		) as HTMLElement | null;
		if ( ! rawBody ) {
			return;
		}
		// `before-render` filter — lets subscribers inject a wrapper
		// around the body (a surrounding `<wpd-panel>`, a theming
		// shim, a dev-time debug outline) before the plugin's own
		// render runs. Typed as returning `HTMLElement` so a filter
		// that returns garbage coerces back to the original body.
		const filtered = applyFilters(
			HOOKS.NATIVE_WINDOW_BEFORE_RENDER,
			rawBody,
			{ windowId: this.id, config: this.config },
		);
		const body = filtered instanceof HTMLElement ? filtered : rawBody;
		// Capture the optional teardown returned by the render callback
		// — invoked on `close()` so plugin authors can dispose
		// listeners, intervals, observers tied to this window's
		// lifecycle. Without this capture, returns from `render()`
		// were silently discarded and authors had no reliable
		// cleanup hook for native windows.
		const maybeTeardown = this.config.render( body );

		const captureTeardown = ( v: unknown ): void => {
			if ( typeof v === 'function' ) {
				this._nativeRenderTeardown = v as () => void;
			}
		};

		// Promise-returning render: defer the readiness signal until
		// the promise resolves. Callers that `return await fetch(...)`
		// from their render get spinner-while-loading for free, with
		// no manual `markReady()` plumbing. Rejections still mark the
		// window ready so a flake doesn't leave the spinner stuck —
		// the rejection itself is forwarded to `SHELL_ERROR` for
		// observability.
		if ( maybeTeardown instanceof Promise ) {
			maybeTeardown.then(
				( resolved ) => {
					if ( this._isDestroyed ) {
						return;
					}
					captureTeardown( resolved );
					markWindowContentReady( this.id );
				},
				( err ) => {
					if ( typeof console !== 'undefined' ) {
						console.error(
							`[wp-desktop-mode] native render rejected for "${ this.id }":`,
							err,
						);
					}
					doAction( HOOKS.SHELL_ERROR, {
						scope: 'window-open',
						id: this.id,
						error: err,
					} );
					if ( this._isDestroyed ) {
						return;
					}
					markWindowContentReady( this.id );
				},
			);
		} else {
			captureTeardown( maybeTeardown );
			// Synchronous render: schedule readiness on the next
			// animation frame so any DOM mutations made inside
			// `render()` settle (custom-element upgrades, layout
			// reads, ResizeObserver firing) before the fade-in
			// transition begins. Skipped if the window has already
			// been destroyed (open + close in the same frame).
			requestAnimationFrame( () => {
				if ( this._isDestroyed ) {
					return;
				}
				markWindowContentReady( this.id );
			} );
		}

		doAction( HOOKS.NATIVE_WINDOW_AFTER_RENDER, {
			windowId: this.id,
			body,
			config: this.config,
		} );

		// Auto-focus — deferred a frame so any layout side-effects
		// of `render()` (measuring, wiring, adding disabled attrs)
		// settle before `.focus()` resolves.
		// `true` focuses the body itself (body must be tabbable —
		// we bump its `tabIndex` temporarily). A string is a CSS
		// selector resolved against the body.
		const autofocus = this.config.autofocus;
		if ( autofocus ) {
			requestAnimationFrame( () => {
				if ( this._isDestroyed ) {
					return;
				}
				if ( typeof autofocus === 'string' ) {
					const target = body.querySelector< HTMLElement >(
						autofocus,
					);
					target?.focus();
					return;
				}
				const hadTabIndex = body.hasAttribute( 'tabindex' );
				if ( ! hadTabIndex ) {
					body.tabIndex = -1;
				}
				body.focus();
				// Leave `tabindex=-1` in place so the body stays
				// programmatically focusable — a -1 node is
				// reachable via `.focus()` but never lands in the
				// user's Tab order, which is exactly what
				// "autofocus the body" wants.
			} );
		}
	}

	/**
	 * Apply a state restored from the session. Called once, after
	 * construction.
	 */
	private applyInitialState( state: WindowState ): void {
		if ( state === 'minimized' ) {
			this.minimize();
		} else if ( state === 'maximized' ) {
			this.toggleMaximize();
		} else if ( state === 'fullscreen' ) {
			this.toggleFullscreen();
		} else if ( state === 'snapped-left' ) {
			this.applySnap( 'left' );
		} else if ( state === 'snapped-right' ) {
			this.applySnap( 'right' );
		}
	}

	/**
	 * Dispatch a `wp-desktop-window-changed` event so the session-save
	 * path can schedule a debounced write.
	 *
	 * Called after any state change that should end up persisted: drag
	 * end, resize end, minimize, restore, maximize toggle, fullscreen
	 * toggle. Exposed as `_emitChange` so sibling modules (tabs,
	 * pointer) can fire the same event.
	 *
	 * @internal
	 */
	public _emitChange( reason: 'moved' | 'resized' | 'state' ): void {
		document.dispatchEvent(
			new CustomEvent( 'wp-desktop-window-changed', {
				detail: { windowId: this.id, reason, state: this.state },
			} ),
		);
	}

	/**
	 * Round an `{ x, y, width, height }` rect onto the live snap grid
	 * when snap-to-grid is enabled, otherwise return it unchanged.
	 *
	 * Used by both the un-maximize restore (so geometry saved while
	 * snap was off doesn't leave the window off-grid when snap is on)
	 * and any other code path that wants "the current geometry, but
	 * grid-aligned." Width/height are floored to whole cells to avoid
	 * crossing the EDGE_MARGIN constraint after rounding up.
	 */
	private snapGeometry( g: { x: number; y: number; width: number; height: number } ): {
		x: number;
		y: number;
		width: number;
		height: number;
	} {
		const snap = this.snapConfigProvider?.();
		if ( ! snap || ! snap.enabled ) {
			return g;
		}
		const width = Math.max(
			this.config.minWidth,
			Math.round( g.width / snap.cellWidth ) * snap.cellWidth,
		);
		const height = Math.max(
			this.config.minHeight,
			Math.round( g.height / snap.cellHeight ) * snap.cellHeight,
		);
		return {
			x: Math.round( g.x / snap.cellWidth ) * snap.cellWidth,
			y: Math.round( g.y / snap.cellHeight ) * snap.cellHeight,
			width,
			height,
		};
	}

	/**
	 * Returns the current resolved URL of the iframe — preferring the
	 * content window's location (reflects in-window navigation) and
	 * falling back to the iframe's src attribute for cases where the
	 * content document isn't yet reachable (cross-origin edge, early
	 * load).
	 */
	public getCurrentUrl(): string {
		if ( ! this.iframe ) {
			// Native windows default to a `#<id>` URL when the
			// caller didn't supply one. `getCurrentUrl()` is read
			// by session persistence + bookmarkable-state paths
			// that need SOMETHING to persist.
			return this.config.url || `#${ this.id }`;
		}
		try {
			const href = this.iframe.contentWindow?.location.href;
			if ( href && href !== 'about:blank' ) {
				return href;
			}
		} catch {
			/* Cross-origin read rejected — fall through. */
		}
		return this.iframe.src;
	}

	/** Bind all DOM event handlers. */
	private bindEvents(): void {
		// Focus on click anywhere in the window. Skipped while in
		// overview mode — there, the window-manager's own capture-phase
		// listener owns the click surface, and touching focus here
		// would reorder z-index mid-grid and fire a spurious
		// `window.focused` action for a press the user may never
		// intend to commit (they might release on a different
		// thumbnail or the backdrop).
		this.element.addEventListener( 'pointerdown', () => {
			if ( this.element.classList.contains( 'wp-desktop-window--overview' ) ) {
				return;
			}
			this.onFocusRequest?.( this );
		} );

		// Keyboard / tab-into-iframe path: `focusin` bubbles when the
		// iframe ELEMENT itself receives focus in the parent's DOM
		// (Tab key from outside, or the first keyboard focus of the
		// session). Does NOT cover mouse clicks inside the iframe —
		// those are handled by the shell-level window.blur listener
		// that inspects document.activeElement.
		this.element.addEventListener( 'focusin', () => {
			if ( this.element.classList.contains( 'wp-desktop-window--overview' ) ) {
				return;
			}
			this.onFocusRequest?.( this );
		} );

		// Title bar drag.
		this._titleBar.addEventListener( 'pointerdown', ( e: PointerEvent ) =>
			handleDragStart( this, e ),
		);

		// Resize handle.
		// Each corner handle gets its own pointerdown listener. The
		// handler reads `data-dir` off the target to know which axes
		// to move during the drag.
		const resizeHandles = this.element.querySelectorAll<HTMLElement>(
			'.wp-desktop-window__resize-handle',
		);
		resizeHandles.forEach( ( handle ) => {
			handle.addEventListener( 'pointerdown', ( e: PointerEvent ) =>
				handleResizeStart( this, e ),
			);
		} );

		// Window control buttons (close / minimize / maximize / focus
		// / detach) are now rendered from the Layer-2 control registry
		// via `paintWindowControls()` — click handlers are wired at
		// render time directly on each button. The constructor-level
		// `repaintWindowControls()` call sets them up before this
		// `bindEvents()` runs, so the controls cluster is live before
		// drag / resize bindings.

		// Title-bar actions menu (iframe windows only).
		const menuBtn = this.element.querySelector<HTMLElement>(
			'.wp-desktop-window__menu-btn',
		);
		const menuPanel = this.element.querySelector<HTMLElement>(
			'.wp-desktop-window__menu-panel',
		);
		if ( menuBtn && menuPanel ) {
			menuBtn.addEventListener( 'click', ( e: Event ) => {
				e.stopPropagation();
				toggleActionsMenu( this );
			} );
			const openAnother = menuPanel.querySelector(
				'.wp-desktop-window__menu-item--open-another',
			);
			if ( openAnother ) {
				// `<wpd-menu-item>` emits `wpd-menu-item-click` on
				// selection — listen for that rather than raw click
				// so other click-based inner DOM (focus rings, etc.)
				// don't double-fire.
				openAnother.addEventListener( 'wpd-menu-item-click', ( e: Event ) => {
					e.stopPropagation();
					closeActionsMenu( this );
					this.onOpenAnother?.( this );
				} );
			}
			// "Open on startup" — checkable menu item. Hydrate its
			// checked state from the shared public API, and wire the
			// click handler to toggle via `setDefaultWindow`. The
			// callback is injected by the window manager so we don't
			// couple the Window class to wp.desktop directly.
			const startup = menuPanel.querySelector<HTMLElement>(
				'.wp-desktop-window__menu-item--startup',
			);
			if ( startup ) {
				refreshStartupCheckState( this, startup );
				// `<wpd-menu-item>` emits `wpd-menu-item-click` on its
				// button click; listen there (not on the plain `click`)
				// so we catch the check toggle without racing the item's
				// own internal state update.
				startup.addEventListener( 'wpd-menu-item-click', ( e: Event ) => {
					// Keep the menu open — a checkbox item is a toggle,
					// not a one-shot action. Users commonly want to
					// verify the new state without reopening the menu,
					// and the REST round-trip is fast enough that the
					// optimistic flip + the server-confirmation refresh
					// feels instant.
					e.stopPropagation();
					flipStartupCheckOptimistically( startup );
					this.onToggleStartup?.( this );
				} );
				// Refresh the check state whenever the public
				// default-window preference changes — this is the
				// authoritative signal (fired after the REST save
				// succeeds). If the REST failed, this event doesn't
				// fire and the optimistic flip stays until the next
				// menu open, where the canonical state from config
				// takes over.
				document.addEventListener(
					'wp-desktop-default-window-changed',
					() => {
						refreshStartupCheckState( this, startup );
					},
				);
			}
			// Escape closes the menu, returning focus to the trigger so
			// keyboard users don't lose their place.
			menuPanel.addEventListener( 'keydown', ( e: Event ) => {
				const kev = e as KeyboardEvent;
				if ( kev.key === 'Escape' ) {
					e.stopPropagation();
					closeActionsMenu( this );
					menuBtn.focus();
				}
			} );
		}

		// Double-click title bar to toggle maximize.
		this._titleBar.addEventListener( 'dblclick', () => {
			this.toggleMaximize();
		} );

		// Iframe-only wiring: tab strip, load listener, and
		// postMessage bridge all presuppose an iframe. Native windows
		// have none of those affordances, so skip this whole block.
		if ( this.iframe ) {
			const iframe = this.iframe;

			const tabs = this.element.querySelector( '.wp-desktop-window__tabs' );
			if ( tabs ) {
				tabs.addEventListener( 'click', ( e: Event ) =>
					handleTabStripClick( this, e ),
				);
			}

			// Sync the active tab whenever the iframe finishes a
			// navigation. Reading iframe.contentWindow.location is safe
			// because we only allow same-origin URLs; cross-origin
			// would have thrown earlier.
			iframe.addEventListener( 'load', () => {
				try {
					const href = iframe.contentWindow?.location.href;
					if ( href ) {
						syncActiveTab( this, href );
					}
				} catch {
					/* Cross-origin or detached frame — ignore. */
				}
			} );

			// Listen for postMessage from iframe.
			window.addEventListener( 'message', this._boundOnMessage );
		}
	}

	/** Add a closeable+detachable sub-tab hosting an external URL. */
	public addExternalTab( url: string, label: string ): void {
		addExternalTab( this, url, label );
	}

	/** Set the z-index of this window. */
	public setZIndex( z: number ): void {
		this.element.style.zIndex = String( z );
	}

	/** Mark this window as focused or unfocused. */
	public setFocused( focused: boolean ): void {
		this.element.classList.toggle( 'wp-desktop-window--focused', focused );
		this._notifyChromeStateChanged();
	}

	/** Update the window title. */
	public setTitle( title: string ): void {
		this._titleEl.textContent = title;
		this.config.title = title;
		doAction( HOOKS.WINDOW_TITLE_CHANGED, { windowId: this.id, title } );
		this._notifyChromeStateChanged();
	}

	/**
	 * Re-render the controls cluster from the Layer-2 registry +
	 * the per-window `appearance.controls` block. Idempotent. The
	 * old buttons (and any plugin-supplied render() teardowns) are
	 * cleaned up before the new ones mount.
	 *
	 * @internal
	 * @since 0.6.0
	 */
	public repaintWindowControls(): void {
		const controlsHost = this.element.querySelector< HTMLElement >(
			'.wp-desktop-window__controls',
		);
		if ( ! controlsHost ) {
			return;
		}
		if ( this._windowControlsTeardown ) {
			try {
				this._windowControlsTeardown();
			} catch {
				// Teardown failures shouldn't block the repaint.
			}
			this._windowControlsTeardown = null;
		}
		this._windowControlsTeardown = paintWindowControls( this, controlsHost );
	}

	/**
	 * Apply (or clear) a per-window controls config at runtime.
	 * Mutates `this.config.appearance.controls` and re-paints. Pass
	 * `null` or `undefined` to clear the override and fall back to
	 * the registry-only resolution.
	 *
	 * @since 0.6.0
	 */
	public setAppearanceControls(
		override: import( '../types' ).WindowControlsConfig | null | undefined,
	): void {
		this.config.appearance = {
			...( this.config.appearance ?? {} ),
			controls: override ?? undefined,
		};
		this.repaintWindowControls();
	}

	/**
	 * Re-render every Layer-3 title-bar slot from the registry +
	 * the per-window `appearance.slots` block. Idempotent. Plugin-
	 * supplied teardowns from the previous paint run before the new
	 * paint.
	 *
	 * @internal
	 * @since 0.6.0
	 */
	public repaintWindowSlots(): void {
		if ( this._windowSlotsTeardown ) {
			try {
				this._windowSlotsTeardown();
			} catch {
				// see notes in repaintWindowControls.
			}
			this._windowSlotsTeardown = null;
		}
		this._windowSlotsTeardown = paintWindowSlots( this );
	}

	/**
	 * Tear down the active custom chrome (if any) and mount the
	 * resolved one. No-op when both old and new resolve to
	 * `'core/standard'`. Idempotent.
	 *
	 * @internal
	 * @since 0.6.0
	 */
	public remountWindowChrome(): void {
		if ( this._chromeHandle ) {
			try {
				this._chromeHandle.destroy();
			} catch {
				// Plugin teardown failures shouldn't block remount.
			}
			this._chromeHandle = null;
		}
		// Drop the marker class while no chrome is mounted — the
		// default chrome should be visible during the brief window
		// between teardown and the next mount. `mountWindowChrome`
		// re-adds the class on success.
		this.element.classList.remove( CUSTOM_CHROME_CLASS );
		const mounted = mountWindowChrome( this );
		if ( mounted ) {
			this._chromeHandle = mounted.handle;
			this._chromeId = mounted.id;
		} else {
			this._chromeId = STANDARD_CHROME_ID;
		}
	}

	/**
	 * Set the chrome id at runtime. Pass `null` / `undefined` to
	 * fall back to the standard chrome.
	 *
	 * **Experimental** since 0.6.0 — the chrome render contract may
	 * change in future minor versions.
	 */
	public setAppearanceChrome( chromeId: string | null | undefined ): void {
		this.config.appearance = {
			...( this.config.appearance ?? {} ),
			chrome: chromeId ?? undefined,
		};
		this.remountWindowChrome();
	}

	/**
	 * Push the current window state into the active custom chrome
	 * (if any). Called from {@link setTitle}, {@link setFocused}, and
	 * the maximize / minimize / fullscreen transitions so chrome
	 * implementations don't have to subscribe to lifecycle events to
	 * keep their visual in sync.
	 *
	 * @internal
	 * @since 0.6.0
	 */
	public _notifyChromeStateChanged(): void {
		// Belt-and-braces: a window mid-close (or fully torn down)
		// must NEVER re-enter the plugin's `update()`. A plugin's
		// update implementation might re-render from scratch — if it
		// fires during the close fade, the user could briefly see a
		// half-rebuilt chrome (or, worse, the default chrome
		// underneath if the plugin's render races). Block the call
		// at the source.
		if ( this._isDestroyed ) {
			return;
		}
		if ( ! this._chromeHandle?.update ) {
			return;
		}
		try {
			this._chromeHandle.update( captureChromeState( this ) );
		} catch {
			// see notes in repaintWindowControls.
		}
	}

	/**
	 * Apply (or clear) per-window slot overrides at runtime.
	 * `slot === null` removes the named override; `slots === null`
	 * clears all per-window slot overrides at once.
	 *
	 * @since 0.6.0
	 */
	public setAppearanceSlot(
		slot: import( '../types' ).WindowSlotName,
		config: import( '../types' ).WindowSlotConfig | undefined,
	): void {
		const existing = this.config.appearance?.slots ?? {};
		const next = { ...existing };
		if ( config === undefined ) {
			delete next[ slot ];
		} else {
			next[ slot ] = config;
		}
		this.config.appearance = {
			...( this.config.appearance ?? {} ),
			slots: next,
		};
		this.repaintWindowSlots();
	}

	/**
	 * Apply (or clear) a per-window theme override at runtime. Accepts
	 * three shapes for ergonomics:
	 *
	 *   - `string` — interpreted as a registered theme id.
	 *   - `Record< string, string >` — interpreted as inline tokens.
	 *   - `WindowThemeRef` — explicit `{ themeId }` or `{ tokens }`.
	 *   - `null` / `undefined` — clear the override; the window falls
	 *     back to whatever the registry's match resolves to.
	 *
	 * Calls through to {@link applyWindowTheme}. The override is
	 * also written to `this.config.appearance.theme` so the next
	 * registry-driven re-apply preserves the runtime choice.
	 *
	 * @since 0.6.0
	 */
	public setAppearanceTheme(
		override:
			| import( '../types' ).WindowThemeRef
			| Record< string, string >
			| string
			| null
			| undefined,
	): void {
		let resolved: import( '../types' ).WindowThemeRef | undefined;
		if ( override === null || override === undefined ) {
			resolved = undefined;
		} else if ( typeof override === 'string' ) {
			resolved = { themeId: override };
		} else if (
			typeof override === 'object' &&
			(
				'themeId' in override ||
				'tokens' in override
			)
		) {
			resolved = override as import( '../types' ).WindowThemeRef;
		} else if ( typeof override === 'object' ) {
			// Plain `{ "--foo": "bar" }` map.
			resolved = { tokens: override as Record< string, string > };
		}
		this.config.appearance = {
			...( this.config.appearance ?? {} ),
			theme: resolved,
		};
		applyWindowTheme( this, resolved );
	}

	/** Minimize the window. */
	/**
	 * Write the half-screen snap geometry for `zone` and apply the
	 * corresponding state class. Shared by session-restore (which
	 * calls it from `applyInitialState`) and the manager's live-snap
	 * commit path so both enter the "snapped" state via identical
	 * geometry math — and the ResizeObserver that reflows stateful
	 * windows on desktop-area size changes.
	 */
	public applySnap( zone: 'left' | 'right' ): void {
		const parent = this.element.parentElement;
		if ( ! parent ) {
			return;
		}
		const halfW = Math.floor( parent.clientWidth / 2 );
		const height = parent.clientHeight;
		this.element.classList.remove(
			'wp-desktop-window--maximized',
			'wp-desktop-window--snapped-left',
			'wp-desktop-window--snapped-right',
		);
		this.element.classList.add( `wp-desktop-window--snapped-${ zone }` );
		this.element.style.left = zone === 'left' ? '0px' : `${ halfW }px`;
		this.element.style.top = '0px';
		this.element.style.width = `${ halfW }px`;
		this.element.style.height = `${ height }px`;
		this.state = zone === 'left' ? 'snapped-left' : 'snapped-right';
		this._emitChange( 'state' );
	}

	/**
	 * Predicate: is this window currently minimized?
	 *
	 * Equivalent to `state === 'minimized'`, but expressed as a
	 * method so callers don't have to grep for the canonical
	 * state-string values. The state machine is:
	 * `'normal' | 'minimized' | 'maximized' | 'fullscreen' |
	 * 'snapped-left' | 'snapped-right'`.
	 *
	 * @public
	 * @since 0.18.0
	 */
	public isMinimized(): boolean {
		return this.state === 'minimized';
	}

	/** Predicate: is this window currently maximized? @since 0.18.0 */
	public isMaximized(): boolean {
		return this.state === 'maximized';
	}

	/** Predicate: is this window in fullscreen mode? @since 0.18.0 */
	public isFullscreen(): boolean {
		return this.state === 'fullscreen';
	}

	/**
	 * Predicate: is this window currently snapped to a screen edge?
	 * Returns `true` for both half-screen positions; pass an explicit
	 * side string if you need to distinguish.
	 *
	 * @since 0.18.0
	 */
	public isSnapped( side?: 'left' | 'right' ): boolean {
		if ( side === 'left' ) {
			return this.state === 'snapped-left';
		}
		if ( side === 'right' ) {
			return this.state === 'snapped-right';
		}
		return (
			this.state === 'snapped-left' || this.state === 'snapped-right'
		);
	}

	/**
	 * Predicate: is this window currently the focused (top of stack)
	 * window? Reads the `wp-desktop-window--focused` class the manager
	 * toggles in `focus()` so the result matches what's visible.
	 *
	 * @since 0.18.0
	 */
	public isFocused(): boolean {
		return this.element.classList.contains( 'wp-desktop-window--focused' );
	}

	public minimize(): void {
		this.state = 'minimized';
		this.element.classList.add( 'wp-desktop-window--minimized' );

		// After the transition completes, hide the iframe to save
		// resources. Native windows don't have an iframe to hide —
		// opacity: 0 on the window element already stops paint work.
		if ( this.iframe ) {
			const iframe = this.iframe;
			this.element.addEventListener( 'transitionend', ( e: TransitionEvent ) => {
				if ( e.propertyName === 'opacity' && this.state === 'minimized' ) {
					iframe.style.visibility = 'hidden';
				}
			}, { once: true } );
		}

		this.onMinimize?.( this );
		this._emitChange( 'state' );
		doAction( HOOKS.WINDOW_MINIMIZED, { windowId: this.id } );
	}

	/** Restore the window from minimized state. */
	public restore(): void {
		// Restore iframe visibility before the animation starts.
		if ( this.iframe ) {
			this.iframe.style.visibility = '';
		}

		const wasMinimized = this.state === 'minimized';
		this.element.classList.remove( 'wp-desktop-window--minimized' );
		if ( wasMinimized ) {
			this.state = 'normal';
		}
		this.onFocusRequest?.( this );
		this._emitChange( 'state' );
		if ( wasMinimized ) {
			doAction( HOOKS.WINDOW_RESTORED, { windowId: this.id } );
		}
	}

	/**
	 * Enter maximized state idempotently.
	 *
	 * Different from `toggleMaximize` in that it's a one-way: a caller
	 * that wants the window maximized can call this without worrying
	 * about the current state. No-op if already maximized.
	 *
	 * Used by the Overview-exit path so clicking a thumbnail can
	 * animate directly from the grid position to maximized in one
	 * co-animation, rather than the two chained animations a
	 * `toggleMaximize` call would produce (first back-to-normal, then
	 * normal-to-maximized).
	 */
	public maximize(): void {
		if ( this.state === 'maximized' ) {
			return;
		}
		const parent = this.element.parentElement;
		if ( ! parent ) {
			return;
		}
		// `offsetLeft` / `offsetWidth` etc. ignore CSS transforms, so
		// even if the caller has applied an overview transform, the
		// saved geometry captures the pre-transform inline position
		// that un-maximize will later restore to.
		this._savedGeometry = {
			x: this.element.offsetLeft,
			y: this.element.offsetTop,
			width: this.element.offsetWidth,
			height: this.element.offsetHeight,
		};
		this.element.classList.add( 'wp-desktop-window--maximized' );
		this.element.style.left = '0px';
		this.element.style.top = '0px';
		this.element.style.width = `${ parent.clientWidth }px`;
		this.element.style.height = `${ parent.clientHeight }px`;
		this.state = 'maximized';
		this._emitChange( 'state' );
		doAction( HOOKS.WINDOW_MAXIMIZED, { windowId: this.id } );
	}

	/** Toggle between maximized and normal states. */
	public toggleMaximize(): void {
		const parent = this.element.parentElement;
		if ( ! parent ) {
			return;
		}

		if ( this.state === 'maximized' ) {
			// Restore to saved geometry. The maximized class is removed
			// *after* the next frame so the class-driven border-radius
			// animates in sync.
			this.element.classList.remove( 'wp-desktop-window--maximized' );
			if ( this._savedGeometry ) {
				const restored = this.snapGeometry( this._savedGeometry );
				this.element.style.left = `${ restored.x }px`;
				this.element.style.top = `${ restored.y }px`;
				this.element.style.width = `${ restored.width }px`;
				this.element.style.height = `${ restored.height }px`;
				// Update the savedGeometry IN PLACE to the snapped
				// values so a subsequent maximize → un-maximize round
				// trip stays on the grid (otherwise the geometry would
				// re-snap by a few pixels every other cycle, drifting
				// until the user notices).
				this._savedGeometry = restored;
			}
			this.state = 'normal';
			this._emitChange( 'state' );
			doAction( HOOKS.WINDOW_UNMAXIMIZED, { windowId: this.id } );
		} else {
			// Save current geometry, then animate to the desktop
			// area's bounds.
			this._savedGeometry = {
				x: this.element.offsetLeft,
				y: this.element.offsetTop,
				width: this.element.offsetWidth,
				height: this.element.offsetHeight,
			};
			this.element.classList.add( 'wp-desktop-window--maximized' );
			this.element.style.left = '0px';
			this.element.style.top = '0px';
			this.element.style.width = `${ parent.clientWidth }px`;
			this.element.style.height = `${ parent.clientHeight }px`;
			this.state = 'maximized';
			this._emitChange( 'state' );
			doAction( HOOKS.WINDOW_MAXIMIZED, { windowId: this.id } );
		}
	}

	/**
	 * Toggle fullscreen ("focus") mode — the window covers the entire
	 * viewport, hiding the admin bar and dock behind it.
	 *
	 * This is the equivalent of macOS's green zoom-to-fullscreen: an
	 * immersive mode distinct from maximize (which only fills the
	 * desktop area, respecting the dock inset).
	 */
	public toggleFullscreen(): void {
		if ( this.state === 'fullscreen' ) {
			// Restore whichever state the window was in before
			// fullscreen.
			this.element.classList.remove( 'wp-desktop-window--fullscreen' );
			if ( this._savedFullscreenState ) {
				const s = this._savedFullscreenState;
				this.element.style.left = `${ s.x }px`;
				this.element.style.top = `${ s.y }px`;
				this.element.style.width = `${ s.width }px`;
				this.element.style.height = `${ s.height }px`;
				this.element.classList.toggle(
					'wp-desktop-window--maximized',
					s.state === 'maximized',
				);
				this.state = s.state;
				this._savedFullscreenState = null;
			} else {
				this.state = 'normal';
			}
		} else {
			this._savedFullscreenState = {
				state: this.state,
				x: this.element.offsetLeft,
				y: this.element.offsetTop,
				width: this.element.offsetWidth,
				height: this.element.offsetHeight,
			};
			this.element.classList.add( 'wp-desktop-window--fullscreen' );
			this.state = 'fullscreen';
		}
		updateFullscreenBodyClass();
		this.updateFocusButtonState();
		this._emitChange( 'state' );
		doAction(
			this.state === 'fullscreen'
				? HOOKS.WINDOW_FULLSCREEN_ENTERED
				: HOOKS.WINDOW_FULLSCREEN_EXITED,
			{ windowId: this.id },
		);
	}

	/**
	 * Reflect fullscreen state on the focus-mode button (active class,
	 * aria-pressed, and label).
	 */
	private updateFocusButtonState(): void {
		const btn = this.element.querySelector<HTMLButtonElement>(
			'.wp-desktop-window__btn--focus',
		);
		if ( ! btn ) {
			return;
		}
		const isFullscreen = this.state === 'fullscreen';
		btn.classList.toggle( 'wp-desktop-window__btn--active', isFullscreen );
		btn.setAttribute( 'aria-pressed', isFullscreen ? 'true' : 'false' );
		btn.setAttribute(
			'aria-label',
			isFullscreen ? __( 'Exit fullscreen' ) : __( 'Enter fullscreen' ),
		);
	}

	/**
	 * Open the window's current URL in a new browser tab as classic
	 * wp-admin.
	 *
	 * Strips the chromeless `wp_desktop` flag and the transient
	 * `desktop_mode_portal` flag, and tags the URL with
	 * `desktop_mode_classic=1` so the server-side admin_init redirect
	 * (which otherwise forwards plain admin URLs to `/wp-desktop/`)
	 * lets the request through. The tag only has to survive the first
	 * request; once the browser renders the page, the user's in-tab
	 * navigation returns to normal admin flow.
	 *
	 * The desktop window itself stays open — detach is a branch, not
	 * a move. If the user wants to close it afterwards, they can.
	 */
	public detach(): void {
		const current = this.getCurrentUrl();
		let url: URL;
		try {
			url = new URL( current, INITIAL_ORIGIN );
		} catch {
			return;
		}
		if ( url.origin !== INITIAL_ORIGIN ) {
			return;
		}
		url.searchParams.delete( 'wp_desktop' );
		url.searchParams.delete( 'desktop_mode_portal' );
		url.searchParams.set( 'desktop_mode_classic', '1' );

		// `noopener` is required for security (tabs should not be able
		// to reach back into window.opener), and it also lets the
		// browser move the new tab to its own process.
		window.open( url.toString(), '_blank', 'noopener' );
		doAction( HOOKS.WINDOW_DETACHED, { windowId: this.id, url: url.toString() } );
	}

	/**
	 * (Re)render plugin-registered title-bar buttons that match this
	 * window. Called once from the constructor and again whenever
	 * the registry changes. Cheap — clears each slot then walks the
	 * filtered list; matching N predicates against this single
	 * window is O(N).
	 *
	 * @internal
	 */
	public renderCustomTitleBarButtons(): void {
		const leftSlot = this.element.querySelector< HTMLElement >(
			'.wp-desktop-window__custom-buttons--left',
		);
		const rightSlot = this.element.querySelector< HTMLElement >(
			'.wp-desktop-window__custom-buttons--right',
		);
		if ( ! leftSlot || ! rightSlot ) {
			return;
		}
		leftSlot.innerHTML = '';
		rightSlot.innerHTML = '';

		const { left, right } = buttonsForWindow( this );
		const fill = ( slot: HTMLElement, defs: TitleBarButtonDef[] ): void => {
			for ( const def of defs ) {
				const host = document.createElement( 'wpd-window-button' );
				paintTitleBarButtonIcon( host, def.icon );
				host.setAttribute( 'aria-label', def.label );
				host.setAttribute( 'title', def.label );
				host.classList.add( 'wp-desktop-window__btn' );
				host.classList.add( 'wp-desktop-window__btn--custom' );
				host.dataset.buttonId = def.id;
				slot.appendChild( host );

				if ( typeof def.render === 'function' ) {
					try {
						def.render( host, this );
					} catch ( err ) {
						if ( typeof console !== 'undefined' ) {
							console.error(
								'[wp-desktop-mode] title-bar-button render threw:',
								def.id,
								err,
							);
						}
					}
				} else if ( typeof def.onClick === 'function' ) {
					// Listen for `wpd-button-activate` — the once-per-
					// gesture CustomEvent the component fires. Using
					// the named event (not raw `click`) means the
					// contract is "fires exactly once per user
					// activation, never racy with the title-bar
					// drag handler". The drag-handler exclusion in
					// `src/window/pointer.ts` makes raw `click`
					// reliable too, but plugin authors should reach
					// for the named event for clarity.
					host.addEventListener( 'wpd-button-activate', ( ev ) => {
						try {
							def.onClick!( this, ev as unknown as MouseEvent );
						} catch ( err ) {
							if ( typeof console !== 'undefined' ) {
								console.error(
									'[wp-desktop-mode] title-bar-button onClick threw:',
									def.id,
									err,
								);
							}
						}
					} );
				}
			}
		};
		fill( leftSlot, left );
		fill( rightSlot, right );
	}

	/**
	 * Publish a payload on a named channel into this window's
	 * content. The unified abstraction over iframe `postMessage` and
	 * native render-callback dispatch — plugin authors write the
	 * same call regardless of how the window is rendered.
	 *
	 * **Iframe windows** (real iframes OR `iframeContent` natives):
	 * the payload is delivered as `wp-desktop-window-send` via
	 * `postMessage` and surfaces inside the iframe via
	 * `wp.desktop.on( channel, cb )` (the iframe-bridge installs
	 * the API on `wp.desktop`). Calls made before the iframe has
	 * announced itself ready are queued in FIFO order and flushed
	 * once the bridge connects — `Window.send` is safe the moment
	 * the window object exists.
	 *
	 * **Pure native windows**: the payload is delivered in-process
	 * to subscribers the render callback registered through its
	 * `windowApi.on( channel, cb )` (the second argument the render
	 * receives). Always considered ready — no async boundary.
	 *
	 * Plugin authors never branch on window type — same call, same
	 * channel, same payload.
	 *
	 * @since 0.5.5
	 *
	 * @param channel Slash- or dot-separated identifier (e.g.
	 *                `'reload'`, `'editor/insert-block'`).
	 * @param payload Anything `postMessage` can serialise.
	 */
	public send< T = unknown >( channel: string, payload?: T ): void {
		if ( typeof channel !== 'string' || channel === '' ) {
			return;
		}
		// Resolve the iframe target: real iframe attached to this
		// Window OR a synthesised iframe registered by an
		// `iframeContent` native window. Pure native windows have
		// neither — they fall through to `dispatchToNative()`.
		const target = this.iframe ?? getSyntheticIframe( this.id );
		if ( ! target ) {
			dispatchToNative( this.id, channel, payload );
			return;
		}
		const sendNow = (): void => {
			try {
				target.contentWindow?.postMessage(
					{
						type: 'wp-desktop-window-send',
						channel,
						payload,
					},
					INITIAL_ORIGIN,
				);
			} catch ( err ) {
				if ( typeof console !== 'undefined' ) {
					console.error(
						'[wp-desktop-mode] Window.send: postMessage failed',
						err,
					);
				}
			}
		};
		// Buffer until the iframe announces it's ready. For real
		// iframes that's `wp-desktop-ready` from the chromeless
		// bridge; for synthetic iframes it's the iframe's `load`
		// event. Both paths call `markWindowContentReady()` which
		// flushes the queue in FIFO order.
		if ( isWindowContentReady( this.id ) ) {
			sendNow();
			return;
		}
		enqueueWindowSend( this.id, channel, payload, sendNow );
	}

	/**
	 * Subscribe to a named channel published BY this window's
	 * content. Mirror of {@link send} for the inbound direction.
	 *
	 * Iframe content publishes via `wp.desktop.send( channel,
	 * payload )` (installed by the iframe bridge); native render
	 * code publishes via `windowApi.send( channel, payload )`. Both
	 * land here.
	 *
	 * Use the literal `'*'` to wildcard-subscribe to every channel
	 * this window publishes.
	 *
	 * @since 0.5.5
	 *
	 * @return Unsubscribe handle. Idempotent.
	 */
	public on< T = unknown >(
		channel: string,
		cb: ( payload: T, meta: { channel: string; windowId: string } ) => void,
	): () => void {
		if ( typeof channel !== 'string' || channel === '' || typeof cb !== 'function' ) {
			return () => undefined;
		}
		return addParentSubscriber(
			this.id,
			channel,
			cb as WindowChannelCb,
		);
	}

	/**
	 * Re-show the loading-spinner overlay over this window's body
	 * and fade the content out. Mirror of {@link markContentLoaded}
	 * for the entry edge — plugins call this before kicking off an
	 * async refetch so the user sees the same affordance they saw
	 * at first paint, and call `markContentLoaded()` once the work
	 * resolves.
	 *
	 * The shell:
	 *   - Adds the `wp-desktop-window__body--loading` modifier to
	 *     the body (CSS fades the content out, fades the overlay
	 *     in).
	 *   - Re-attaches the overlay element if it was already torn
	 *     down by a prior `markContentLoaded` call.
	 *   - Fires the {@link HOOKS.WINDOW_CONTENT_LOADING} action +
	 *     dispatches `wp-desktop-window-content-loading` on
	 *     `document` (idempotent — no re-fire when already
	 *     loading).
	 *
	 * Idempotent. Cheap to call repeatedly.
	 *
	 * @since 0.6.0
	 */
	public markContentLoading(): void {
		markWindowContentLoading( this.id );
	}

	/**
	 * Tell the shell this window's body content is ready — fades
	 * the spinner overlay out, fades the content in, removes the
	 * overlay element after the transition lands.
	 *
	 * Iframe windows mark themselves ready automatically on the
	 * `wp-desktop-ready` postMessage from the chromeless bridge.
	 * Native windows mark themselves ready automatically after
	 * their `render( body )` callback (or its returned `Promise`)
	 * resolves. Plugins only call this directly when:
	 *
	 *   - They're doing event-listener-based async loading the
	 *     framework can't observe.
	 *   - They re-armed loading via {@link markContentLoading}
	 *     and need to clear it again.
	 *
	 * Idempotent. Fires the {@link HOOKS.WINDOW_CONTENT_LOADED}
	 * action only on a loading → ready transition.
	 *
	 * @since 0.6.0
	 */
	public markContentLoaded(): void {
		markWindowContentReady( this.id );
	}

	/**
	 * Toggle a visual highlight on the window. Used by plugins that
	 * need to point at a window from outside it — e.g. a "connect to"
	 * dropdown that highlights candidate windows on hover.
	 *
	 *   - `'preview'`     — temporary ring; caller is expected to
	 *                       clear on `mouseleave`. Multiple plugins
	 *                       can hover-preview without stomping each
	 *                       other (last write wins).
	 *   - `'persistent'`  — sticky ring; caller is responsible for
	 *                       clearing it.
	 *   - `null` / unset  — clear all highlight state.
	 *
	 * Override the colour per-call via `opts.color`, or globally
	 * via the `--wp-window-highlight-color` custom property.
	 *
	 * @since 0.17.0
	 */
	/**
	 * Request a visual "attention" signal on this window's tile in
	 * the dock or taskbar — pulse, shake, or bounce. Used by plugins
	 * that need to grab the user's eye when the window is closed or
	 * unfocused (incoming chat message, long task finished, etc.).
	 *
	 * Resolution order:
	 *   1. If a tile exists for this window's id on either rail
	 *      (`wp.desktop.dock` or `wp.desktop.taskbar`), call
	 *      `Dock.setAttention( id, mode, opts )`.
	 *   2. Otherwise (e.g. `placement: 'none'`) fall back to
	 *      `setHighlight('persistent')` on the window itself, auto-
	 *      cleared after `opts.durationMs`. No-op if the window has
	 *      no rendered chrome.
	 *
	 * The mode + opts pass through the `wp-desktop.window.attention`
	 * filter first so plugins (or a Do-Not-Disturb preference) can
	 * mute (`return null`) or modify the request.
	 *
	 * Animations are gated on `prefers-reduced-motion`; reduced-motion
	 * users see a static accent ring for the same duration so the
	 * affordance still works.
	 *
	 * @since 0.22.0
	 */
	public requestAttention(
		mode: 'pulse' | 'shake' | 'bounce' | null,
		opts: WindowAttentionOptions = {},
	): void {
		// Primary policy hook (since 0.5.5): plugins filter
		// `wp-desktop/window-attention-requested` to cancel
		// (`cancel: true`) for DND modes / reduced-motion, scale
		// `durationMs`/`intensity`, or audit. The pre-0.5.5
		// `wp-desktop.window.attention` filter still runs below
		// for back-compat.
		const intent = activity.filter(
			'wp-desktop/window-attention-requested',
			{
				windowId: this.id,
				mode,
				durationMs: opts.durationMs,
				intensity: opts.intensity,
			},
			opts,
		);
		if ( ! intent || intent.cancel === true ) {
			return;
		}
		const intentMode = ( intent.mode ?? mode ) as WindowAttentionMode;
		const intentOpts: WindowAttentionOptions = {
			...opts,
			durationMs:
				typeof intent.durationMs === 'number'
					? intent.durationMs
					: opts.durationMs,
			intensity:
				typeof intent.intensity === 'string'
					? ( intent.intensity as WindowAttentionOptions[ 'intensity' ] )
					: opts.intensity,
		};

		const filtered = applyFilters<
			WindowAttentionMode,
			[ { windowId: string; opts: WindowAttentionOptions } ]
		>(
			'wp-desktop.window.attention',
			intentMode,
			{ windowId: this.id, opts: intentOpts },
		);

		// Resolve the docks via the public API so a plugin shell
		// implementation that swaps Dock instances at runtime still
		// gets the latest reference.
		const wp = ( window as unknown as {
			wp?: { desktop?: { dock?: unknown; taskbar?: unknown } };
		} ).wp;
		type SetAttentionFn = (
			id: string,
			m: WindowAttentionMode,
			o: WindowAttentionOptions,
		) => void;
		const dockApi = wp?.desktop?.dock as
			| { setAttention?: SetAttentionFn }
			| null
			| undefined;
		const taskbarApi = wp?.desktop?.taskbar as
			| { setAttention?: SetAttentionFn }
			| null
			| undefined;

		let routed = false;
		if ( typeof dockApi?.setAttention === 'function' ) {
			dockApi.setAttention( this.id, filtered, intentOpts );
			routed = true;
		}
		if ( typeof taskbarApi?.setAttention === 'function' ) {
			taskbarApi.setAttention( this.id, filtered, intentOpts );
			routed = true;
		}

		// Fallback for windows without a rail tile (placement: 'none').
		// Use the existing highlight ring auto-cleared after the same
		// duration so the API has meaningful behavior everywhere.
		if ( ! routed && filtered !== null ) {
			this.setHighlight( 'persistent' );
			const duration = intentOpts.durationMs ?? 4000;
			if ( duration > 0 ) {
				window.setTimeout( () => {
					this.setHighlight( null );
				}, duration );
			}
		} else if ( ! routed && filtered === null ) {
			this.setHighlight( null );
		}
	}

	/**
	 * Briefly jiggle the window element horizontally — the classic
	 * MSN-Messenger nudge affordance. Plugins can request "look at
	 * me" attention on their own window programmatically (e.g. a
	 * chat plugin on inbound nudge, a CI plugin on a broken build).
	 *
	 * Composes with the inline `left`/`top` the window manager
	 * writes (the shake is a CSS `transform`, not a position
	 * change). Auto-clears the class on `animationend`. If a second
	 * shake is requested while one is mid-flight, the class is
	 * removed and re-added so the animation restarts.
	 *
	 * Reduced-motion fallback: a static accent ring for the same
	 * duration. Authors who want a different visual can listen on
	 * the JS filter `wp-desktop.window.shake` and return falsy to mute.
	 *
	 * @since 0.22.11
	 */
	public shake(): void {
		const filtered = applyFilters< boolean, [ { windowId: string } ] >(
			'wp-desktop.window.shake',
			true,
			{ windowId: this.id },
		);
		if ( filtered === false ) {
			return;
		}
		const el = this.element;
		el.classList.remove( 'wp-desktop-window--shaking' );
		// Force reflow so removing then re-adding the class re-triggers
		// the animation. Reading `offsetWidth` is the canonical hack.
		void el.offsetWidth;
		el.classList.add( 'wp-desktop-window--shaking' );
		const onEnd = (): void => {
			el.classList.remove( 'wp-desktop-window--shaking' );
			el.removeEventListener( 'animationend', onEnd );
		};
		el.addEventListener( 'animationend', onEnd );
	}

	public setHighlight(
		mode: 'preview' | 'persistent' | null,
		opts?: { color?: string },
	): void {
		const el = this.element;
		if ( ! el ) {
			return;
		}
		el.classList.remove(
			'wp-window--highlight-preview',
			'wp-window--highlight-persistent',
		);
		if ( mode === 'preview' ) {
			el.classList.add( 'wp-window--highlight-preview' );
		} else if ( mode === 'persistent' ) {
			el.classList.add( 'wp-window--highlight-persistent' );
		}
		if ( opts?.color ) {
			el.style.setProperty( '--wp-window-highlight-color', opts.color );
		} else if ( mode === null ) {
			el.style.removeProperty( '--wp-window-highlight-color' );
		}
		// Surface the change on the hook bus so onboarding /
		// drag-bridge / guidance plugins can react without
		// observing DOM mutations. Pure-additive: handlers that
		// don't subscribe see no behaviour change.
		doAction( HOOKS.WINDOW_HIGHLIGHT_CHANGED, {
			windowId: this.id,
			mode,
			color: opts?.color,
		} );
	}

	/**
	 * Close and destroy the window.
	 *
	 * Plays a subtle closing animation before removing the element.
	 */
	public close(): void {
		if ( this._isDestroyed ) {
			return;
		}

		// Cancellable pre-close filter — ONLY for native windows.
		// Return `false` from the filter to abort the close; any
		// other return (undefined, true) lets the close proceed.
		// Iframe windows don't go through this: their close is
		// typically triggered by the user closing the UI and
		// cancelling it would be confusing.
		if ( this.config.native ) {
			const proceed = applyFilters< boolean, [ { windowId: string; config: WindowConfig } ] >(
				HOOKS.NATIVE_WINDOW_BEFORE_CLOSE,
				true,
				{ windowId: this.id, config: this.config },
			);
			if ( proceed === false ) {
				return;
			}
		}

		this._isDestroyed = true;

		// Drop the title-bar-button subscription so a closed window
		// stops repainting on registry changes.
		if ( this._titleBarButtonsUnsubscribe ) {
			this._titleBarButtonsUnsubscribe();
			this._titleBarButtonsUnsubscribe = null;
		}

		// Drop the window-theme subscription pre-animation — no
		// visible effect; just stops registry-change callbacks from
		// firing while the window is animating away. The actual
		// theme-variable wipe (`clearWindowTheme`) is deferred into
		// `onDone()` because it MUTATES inline CSS — running it
		// pre-animation snaps the window back to the default theme
		// (border, shadow, bg, fg, accent, …) the instant the user
		// clicks close, before the fade has a chance to run. With
		// the wipe deferred, the window keeps its themed appearance
		// for the entire fade-out.
		if ( this._windowThemesUnsubscribe ) {
			this._windowThemesUnsubscribe();
			this._windowThemesUnsubscribe = null;
		}

		// Subscription teardowns that have no visible effect happen
		// pre-animation. The matching plugin-supplied teardowns
		// (which CAN mutate visible DOM — destroy() the chrome,
		// remove control buttons, drop slot content, clear native-
		// window body, wipe theme CSS variables) are deferred into
		// `onDone()` below so the window's fade-out doesn't reveal
		// the default chrome / a blank body / missing buttons /
		// reset theme mid-animation.
		if ( this._windowControlsUnsubscribe ) {
			this._windowControlsUnsubscribe();
			this._windowControlsUnsubscribe = null;
		}
		if ( this._windowSlotsUnsubscribe ) {
			this._windowSlotsUnsubscribe();
			this._windowSlotsUnsubscribe = null;
		}
		if ( this._windowChromesUnsubscribe ) {
			this._windowChromesUnsubscribe();
			this._windowChromesUnsubscribe = null;
		}

		// Tear down the body resize observer now rather than on
		// element.remove() — subscribers shouldn't see a phantom
		// `body-resized` fire as the window animates out.
		this._bodyResizeObserver?.disconnect();
		this._bodyResizeObserver = null;

		// Drop every channel-bus subscriber bound to this window so
		// stale callbacks don't fire if the same id is reopened.
		clearWindowChannels( this.id );

		// Fire the inline `config.onClose` hook — per-window, NOT
		// the broadcast `window.closing` hook (that fires via the
		// manager's remove path, after this callback returns).
		try {
			this.config.onClose?.();
		} catch ( err ) {
			doAction( HOOKS.SHELL_ERROR, {
				scope: 'native-window-close',
				id: this.id,
				error: err,
			} );
		}

		// Fire the callback immediately so the window manager updates
		// its stack.
		this.onClose?.( this );

		this.element.classList.add( 'wp-desktop-window--closing' );

		let removed = false;
		const onDone = (): void => {
			if ( removed ) {
				return;
			}
			removed = true;

			// Visible-DOM teardowns deferred from above — run them
			// here, after the closing animation has faded the window
			// to opacity 0, so a custom chrome unmounting (or a
			// plugin slot / control / native body teardown) can't
			// flash the default chrome through the live pixels
			// mid-fade. The window leaves the DOM in the next step
			// regardless; whatever the children look like during
			// these calls is invisible.
			if ( this._windowControlsTeardown ) {
				try {
					this._windowControlsTeardown();
				} catch {
					// see notes in repaintWindowControls.
				}
				this._windowControlsTeardown = null;
			}
			if ( this._windowSlotsTeardown ) {
				try {
					this._windowSlotsTeardown();
				} catch {
					// see notes in repaintWindowSlots.
				}
				this._windowSlotsTeardown = null;
			}
			if ( this._chromeHandle ) {
				try {
					this._chromeHandle.destroy();
				} catch {
					// Plugin teardown failures shouldn't take the close down.
				}
				this._chromeHandle = null;
			}
			// Theme CSS-variable wipe — also deferred so the themed
			// appearance survives the entire fade-out. The element is
			// about to leave the DOM regardless; the wipe is purely
			// belt-and-braces against retained references.
			clearWindowTheme( this );
			if ( this._nativeRenderTeardown ) {
				try {
					this._nativeRenderTeardown();
				} catch ( err ) {
					doAction( HOOKS.SHELL_ERROR, {
						scope: 'native-window-teardown',
						id: this.id,
						error: err,
					} );
				}
				this._nativeRenderTeardown = null;
			}

			window.removeEventListener( 'message', this._boundOnMessage );
			if ( this._boundOnDocumentPointerDown ) {
				document.removeEventListener(
					'pointerdown',
					this._boundOnDocumentPointerDown,
					true,
				);
			}
			this.element.remove();
			// If this was the last fullscreen window, drop the body
			// class so the admin bar and shell top-offset come back
			// cleanly.
			updateFullscreenBodyClass();
		};

		const onTransitionEnd = ( e: TransitionEvent ): void => {
			if ( e.propertyName === 'opacity' ) {
				this.element.removeEventListener( 'transitionend', onTransitionEnd );
				onDone();
			}
		};
		this.element.addEventListener( 'transitionend', onTransitionEnd );

		// Safety net: if transitionend never fires (reduced-motion or
		// no transition), remove after a generous timeout so the
		// element doesn't linger.
		setTimeout( onDone, 300 );
	}

	/**
	 * Wire up a ResizeObserver on the body element. Fires the
	 * inline `config.onResize` callback AND the
	 * `WINDOW_BODY_RESIZED` hook on every size change. Returns the
	 * observer so `close()` can disconnect it; returns null when
	 * the body element is missing or the environment has no
	 * ResizeObserver (jsdom without a shim, older browsers).
	 */
	private installBodyResizeObserver(): ResizeObserver | null {
		const body = this.element.querySelector(
			'.wp-desktop-window__body',
		) as HTMLElement | null;
		if ( ! body ) {
			return null;
		}
		if ( typeof ResizeObserver === 'undefined' ) {
			return null;
		}
		const observer = new ResizeObserver( ( entries ) => {
			const entry = entries[ 0 ];
			if ( ! entry ) {
				return;
			}
			const cr = entry.contentRect;
			const width = Math.round( cr.width );
			const height = Math.round( cr.height );
			// Inline callback first — isolates per-window logic from
			// the broadcast hook subscribers and lets a plugin
			// short-circuit its own expensive re-layout even when
			// other subscribers are disabled.
			try {
				this.config.onResize?.( width, height );
			} catch ( err ) {
				doAction( HOOKS.SHELL_ERROR, {
					scope: 'native-window-resize',
					id: this.id,
					error: err,
				} );
			}
			doAction( HOOKS.WINDOW_BODY_RESIZED, {
				windowId: this.id,
				width,
				height,
			} );
		} );
		observer.observe( body );
		return observer;
	}

	/** Get a snapshot of the window state for persistence. */
	public getSnapshot(): { id: string; x: number; y: number; width: number; height: number; state: WindowState } {
		// `offsetLeft / offsetTop / offsetWidth / offsetHeight` all
		// return 0 when the element (or any ancestor) is
		// `display: none` — which is exactly the state every window
		// on a non-active virtual desktop sits in. Without this
		// fallback, snapshot() would serialise those windows as
		// (0, 0, 0, 0) and the next hard reload would restore them
		// at defaults. `offsetParent` is null under the same
		// conditions, so we use it as the "am I hidden?" signal and
		// fall back to parsing the inline style strings, which survive
		// `display: none` unchanged.
		const isHidden = this.element.offsetParent === null;
		if ( isHidden ) {
			const parse = ( raw: string ): number => {
				const n = parseFloat( raw );
				return Number.isFinite( n ) ? Math.round( n ) : 0;
			};
			return {
				id: this.id,
				x: parse( this.element.style.left ),
				y: parse( this.element.style.top ),
				width: parse( this.element.style.width ),
				height: parse( this.element.style.height ),
				state: this.state,
			};
		}
		return {
			id: this.id,
			x: this.element.offsetLeft,
			y: this.element.offsetTop,
			width: this.element.offsetWidth,
			height: this.element.offsetHeight,
			state: this.state,
		};
	}

	/** Number of external sub-tabs currently open on this window. */
	public getExternalTabCount(): number {
		return externalTabCount( this );
	}

	/** Serializable snapshot of this window's external sub-tabs. */
	public getExternalTabsSnapshot(): { url: string; label: string }[] {
		return externalTabsSnapshot( this );
	}

	/**
	 * Toggle the actions menu from an external caller (e.g., keyboard
	 * shortcut). Kept here so the panel-focus + outside-click wiring
	 * lives in a single place.
	 */
	public toggleActionsMenu(): void {
		toggleActionsMenu( this );
	}

	/** Close the actions menu from an external caller. */
	public closeActionsMenu(): void {
		closeActionsMenu( this );
	}

	/** Open the actions menu from an external caller. */
	public openActionsMenu(): void {
		openActionsMenu( this );
	}
}

