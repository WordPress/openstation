/**
 * OpenStation — Window.
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
 */

import type { WindowConfig, WindowState } from './../types';
import { activity } from './../activity';
import { getSyntheticIframe } from './../connection';
import { HOOKS, applyFilters, doAction } from './../hooks';
import { __, sprintf } from './../i18n';
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
// Window-chrome component classes (`<os-window-button>`,
// `<os-menu>` + `<os-menu-item>`, `<os-tab-chip>`) are not
// leaf-imported here: the shell pre-loads them
// via the `shell-overlays[.min].js` bundle right after first paint
// (see `src/shell-overlays/loader.ts`). By the time the user opens
// any window and the constructor runs, the custom-element classes
// are registered and the chrome upgrades synchronously. Registration
// inventory lives in `src/shell-overlays/entry.ts`.

import { _buildNativeRenderContext } from './../native-windows';
import {
	createWindowElement,
	updateFullscreenBodyClass,
	withChromelessParam,
} from './dom';
import {
	adoptPageTitle,
	handleFinishedScreenHandoff,
	handleWindowMessage,
} from './iframe-bridge';
import { noteFrameLoaded } from '../plugin-presence';
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
import { paintThemedControlIcon } from './../window-chrome/controls/paint-themed-icon';
import { renderIcon } from '../icon';
import { slotForTileId } from '../desktop-themes/slots';
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
 */
const INITIAL_ORIGIN = window.location.origin;

/**
 * The `@keyframes` name behind `.os-window--opening` in
 * `window-states.css`. `animationend` BUBBLES, so the listener that
 * clears the class has to check this — a spinner, skeleton shimmer
 * or holo drift finishing anywhere inside the window body would
 * otherwise consume the once-only listener and cut the open
 * animation short.
 */
const OPENING_ANIMATION_NAME = 'os-window-open';

/**
 * Deadline for clearing `.os-window--opening` regardless of what the
 * compositor did — the CSS animation is 0.2s, this leaves margin.
 *
 * Why a timer at all: CSS animations do not advance while the
 * document is hidden, so `animationend` never fires for a window
 * opened in a backgrounded tab (session restore the user tabs away
 * from, an `os-open-requested` from another surface, automation).
 * The class is what applies `opacity: 0` / `scale(0.92)` via the
 * animation's `from` frame, so a stuck class means a window that is
 * in the DOM, focused, and invisible. Background tabs also throttle
 * timers to >=1s, so this fires late there rather than on time —
 * late still unsticks it, which is the whole point.
 */
const OPENING_FALLBACK_MS = 300;

import {
	activatePanelTab,
	addExternalTab,
	externalTabCount,
	externalTabsSnapshot,
	handleTabStripClick,
	handleTabStripKeydown,
	observeTabOverflow,
	setPanelTabs,
	syncActiveTab,
} from './tabs';
import type { PanelTabEntry } from './tabs';
import {
	closeActionsMenu,
	flipMenuItemCheckOptimistically,
	openActionsMenu,
	refreshStartupCheckState,
	toggleActionsMenu,
} from './menus';
import { handleDragStart, handleResizeStart } from './pointer';
import { speculateDocument } from '../pwa/speculate';

/**
 * Ask the service worker to fetch a submenu tab's screen ahead of the
 * click, when the user has opted into hover prewarming.
 *
 * The URL has to be the one the iframe will actually request — the
 * worker matches exactly, and a tab's raw `data-url` is missing the
 * chromeless flag `withChromelessParam()` adds on navigation.
 *
 * @param rawUrl The tab's declared admin URL.
 */
function speculateTabDocument( rawUrl: string ): void {
	const os = (
		window as unknown as {
			wp?: {
				os?: {
					getOsSettings?: () => { windowPrewarmEnabled?: boolean };
				};
			};
		}
	).wp?.os;
	if ( ! os?.getOsSettings?.().windowPrewarmEnabled ) {
		return;
	}
	const target = withChromelessParam( rawUrl );
	if ( target ) {
		speculateDocument( target );
	}
}

/**
 * How long the pointer must rest on a submenu tab before its document
 * is speculated.
 *
 * `pointerover` fires on every crossing, so without a dwell a pointer
 * sweeping across a strip of tabs on its way somewhere else asked for
 * every one — and each ask holds a fully rendered admin page for 30 s.
 * Intent looks like stopping. Short enough that a deliberate hover
 * still buys most of the fetch before the click lands.
 */
const TAB_SPECULATE_DWELL_MS = 120;

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
	 *
	 * Reassigned ONLY by {@link swapReload}, which replaces the frame
	 * element wholesale during a double-buffered refresh — treat it as
	 * read-only everywhere else, and don't cache the element across
	 * awaits when a swap may be in flight.
	 */
	public iframe: HTMLIFrameElement | null;
	public state: WindowState = 'normal';

	/** @internal */
	public _titleBar: HTMLElement;
	/** @internal */
	public _titleEl: HTMLElement;

	/**
	 * In-flight async operation count. `markActivityStart()` /
	 * `markActivitySettled()` increment / decrement; the phase reads
	 * `pending` while > 0. Counter (not boolean) so concurrent fetches
	 * don't fight: two-in-flight + one-settled still reads "saving".
	 *
	 * @internal
	 */
	public _activityCount = 0;

	/**
	 * This window's activity phase. Driven by `markActivity()` /
	 * `trackActivity()` / `wp.os.fetch()`. Nothing renders it unless
	 * an indicator has been mounted — see
	 * {@link _paintActivityIndicator}.
	 *
	 * @internal
	 */
	public _activityPhase: 'idle' | 'pending' | 'saving' | 'saved' | 'failed' =
		'idle';

	/**
	 * Last error message — surfaced on the indicator's `error`
	 * attribute (which becomes its `title` tooltip in `dot` mode).
	 *
	 * @internal
	 */
	public _activityError: string | null = null;

	/**
	 * Auto-clear timer for `saved` / `failed` phases. The indicator
	 * fades back to `idle` after a short hold. Cleared and restarted
	 * on every transition.
	 *
	 * @internal
	 */
	public _activityClearTimer: number | null = null;

	/**
	 * Wall-clock timestamp (ms since epoch) of when the most recent
	 * `saving` phase started. Used to enforce a minimum-display
	 * duration so the modem-blink animation has time to register
	 * even when a fetch resolves in <100 ms.
	 *
	 * @internal
	 */
	public _activitySavingStartedAt = 0;

	/**
	 * Pending settled-transition timer. When a fetch resolves before
	 * the minimum-display duration has elapsed, the transition to
	 * `saved` / `failed` is queued so the dot keeps blinking until
	 * the animation has had time to be seen.
	 *
	 * @internal
	 */
	public _activitySettleTimer: number | null = null;

	/**
	 * Where a submitted form has got to. `settled` is a state rather
	 * than a cleared flag because the answering document reports from
	 * its head, and its `os-ready` follows a beat later with a reset
	 * that must not wipe the outcome just settled.
	 *
	 * @internal
	 */
	public _navigationActivity: 'none' | 'pending' | 'settled' = 'none';
	/** @internal */
	public _navigationActivityTimer: number | null = null;
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
	 * The underlying state the window was in before {@link minimize}
	 * captured it. {@link restore} returns the window here instead of
	 * unconditionally landing in 'normal' — so a `maximize → minimize →
	 * restore` round-trip lands back in maximized (and its class +
	 * inline geometry stay coherent with `state`).
	 *
	 * `null` whenever the window isn't currently minimized.
	 *
	 * @internal
	 */
	private _stateBeforeMinimize: WindowState | null = null;

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
	 */
	public _windowThemesUnsubscribe: ( () => void ) | null = null;

	/**
	 * Unsubscribe handle for the window-control registry. Cleared on
	 * close.
	 * @internal
	 */
	public _windowControlsUnsubscribe: ( () => void ) | null = null;

	/**
	 * Teardown handle returned by the most recent
	 * {@link paintWindowControls} call. Re-paint replaces it; close
	 * invokes the last one to drop event listeners on plugin-supplied
	 * `render` callbacks.
	 * @internal
	 */
	public _windowControlsTeardown: ( () => void ) | null = null;

	/**
	 * Unsubscribe handle for the window-slot registry. Cleared on
	 * close.
	 * @internal
	 */
	public _windowSlotsUnsubscribe: ( () => void ) | null = null;

	/**
	 * Teardown handle returned by the most recent
	 * {@link paintWindowSlots} call.
	 * @internal
	 */
	public _windowSlotsTeardown: ( () => void ) | null = null;

	/**
	 * Handle returned by the active custom chrome's `render()`.
	 * `null` when the window uses `'core/standard'` (the default —
	 * Layers 1-3 paint without a chrome handle). Tracked so window-
	 * state updates can flow into `handle.update()` and `close()`
	 * can call `handle.destroy()`.
	 *
	 * **Experimental**.
	 *
	 * @internal
	 */
	public _chromeHandle: ChromeRenderHandle | null = null;

	/**
	 * Id of the chrome currently mounted (or `'core/standard'`).
	 *
	 * @internal
	 */
	public _chromeId: string = STANDARD_CHROME_ID;

	/**
	 * Unsubscribe handle for the chrome registry. Cleared on close.
	 *
	 * @internal
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
	 * Disposer for the framework-built `NativeRenderContext` —
	 * unwires the per-window hook subscriptions (`onResize`,
	 * `onHide`, `onShow`) AND aborts the `signal` so in-flight
	 * `wp.os.fetch( …, { signal } )` calls cancel. Runs at
	 * close BEFORE the user-returned teardown, so async paths see
	 * the abort first. Set in `hydrateNative()` for native windows.
	 *
	 * @internal
	 */
	public _nativeRenderCtxDispose: ( () => void ) | null = null;

	/**
	 * Safety-net timer scheduled by `close()` so the window is
	 * finalised even when `transitionend` never fires (reduced-
	 * motion, no transition declared). Captured on the instance so
	 * `_finalizeClose()` can cancel it on the normal path AND so
	 * `destroy()` can cancel + run finalize synchronously.
	 *
	 * @internal
	 */
	public _closeSafetyNetTimer: ReturnType< typeof setTimeout > | null = null;

	/**
	 * Teardown for `_armOpeningClassRemoval()` — cancels its fallback
	 * timer and detaches its two animation listeners. Captured on the
	 * instance so `_finalizeClose()` can run it: a window destroyed
	 * inside the fallback deadline used to leave a live timer behind,
	 * pointed at a document that was already going away.
	 *
	 * `null` once it has run (or before the window ever opened).
	 *
	 * @internal
	 */
	private _clearOpeningClassRemoval: ( () => void ) | null = null;

	/**
	 * Bound `transitionend` listener installed by `close()` so the
	 * normal animation path can finalise. Captured so
	 * `_finalizeClose()` can detach it (the previous closure-only
	 * shape couldn't be removed if `destroy()` short-circuited).
	 *
	 * @internal
	 */
	public _onCloseTransitionEnd: ( ( e: TransitionEvent ) => void ) | null = null;

	/**
	 * `true` once `_finalizeClose()` has run. Idempotency guard so
	 * the safety-net timer + the `transitionend` listener + an
	 * explicit `destroy()` call all converge to a single finalise.
	 *
	 * @internal
	 */
	public _isFinalized: boolean = false;

	/**
	 * Tracks whether the iframe bridge has announced readiness.
	 * Required to know if we can safely send the pre-close query.
	 *
	 * @internal
	 */
	public _iframeBridgeReady: boolean = false;

	/**
	 * Safety-net timer for the pre-close iframe query. If the iframe
	 * bridge fails to ack, this timer forces the close to proceed.
	 *
	 * @internal
	 */
	public _iframeCloseTimeout: ReturnType< typeof setTimeout > | null = null;

	/**
	 * Guards against re-entering the iframe pre-close query while one is
	 * in-flight. Prevents duplicate queries and orphaned safety timers
	 * when `close()` is called multiple times before a response arrives.
	 *
	 * @internal
	 */
	public _closePending: boolean = false;

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
	 * Invoked after this window comes back from minimized. The manager
	 * wires it to bring any child windows back with their owner — the
	 * counterpart to the cascade in `onMinimize`.
	 */
	public onRestore: ( ( win: Window ) => void ) | null = null;
	/**
	 * Invoked when the title-bar menu's "Open another" item is clicked.
	 * The window manager wires this to `openNew()`.
	 */
	public onOpenAnother: ( ( win: Window ) => void ) | null = null;

	/**
	 * Invoked when the title-bar menu's "Open in new window" item is
	 * clicked. Like `onOpenAnother`, but the manager opens the new
	 * window at the *current* iframe URL (post-navigation), not the
	 * original page URL.
	 */
	public onOpenInNewWindow: ( ( win: Window ) => void ) | null = null;

	/**
	 * Invoked when the title-bar menu's "Open on startup" item is
	 * toggled. The shell wires this to the public
	 * `wp.os.setDefaultWindow()` call, which writes the user's
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
	 * Live subscription that repaints the ⋯ menu while it is open, so
	 * an action registered a moment after opening still appears. Held
	 * only for the lifetime of one open menu. @internal
	 */
	public _unsubscribeWindowActions: ( () => void ) | null = null;

	/**
	 * ResizeObserver watching the body element. Fires the inline
	 * `config.onResize` callback AND the `WINDOW_BODY_RESIZED` hook
	 * on every size change. Null when the environment lacks
	 * ResizeObserver (old browsers, jsdom without a shim).
	 * @internal
	 */
	public _bodyResizeObserver: ResizeObserver | null = null;

	/**
	 * Teardown for the tab strip's overflow watcher — the thing that
	 * decides whether either edge fade is painted. Null on native
	 * windows (no strip) and once the window has closed.
	 * @internal
	 */
	public _tabOverflowTeardown: ( () => void ) | null = null;

	/** Pending submenu-tab speculation, while the pointer rests. */
	public _tabSpeculateTimer: number | null = null;

	constructor( config: WindowConfig ) {
		this.id = config.id;
		this.config = config;
		this.element = createWindowElement( config );
		this.iframe = config.native
			? null
			: ( this.element.querySelector( '.os-window__iframe' ) as HTMLIFrameElement );
		this._titleBar = this.element.querySelector( '.os-window__titlebar' ) as HTMLElement;
		this._titleEl = this.element.querySelector( '.os-window__title' ) as HTMLElement;
		this._boundOnMessage = ( e: MessageEvent ) => handleWindowMessage( this, e );

		this.bindEvents();
		if ( this.iframe ) {
			this._wireContentFocusForwarder( this.iframe );
		}

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
		// `<os-*>` the plugin creates or populates via declarative
		// setters (`.items = […]`, `.value = …`) hits a real class
		// setter rather than stashing an own data property that
		// would later shadow the prototype setter.

		// Body-resize observer — fires inline `onResize( w, h )` +
		// the `WINDOW_BODY_RESIZED` hook whenever the
		// `.os-window__body` element's dimensions change.
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
			this.element.classList.add( 'os-window--minimized' );
			if ( this.iframe ) {
				this.iframe.style.visibility = 'hidden';
			}
			// No minimize transition will fire for pre-minimized
			// windows, so apply the render-work suppression the
			// transitionend handler in minimize() would otherwise add.
			this.element.style.setProperty( 'content-visibility', 'hidden' );
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
				`os-window--${ config.initialState }`,
			);
		}

		// Fresh open (or restored to a visible state). Play the opening
		// animation, then remove the class.
		//
		// Nothing to animate for a document nobody is looking at, and
		// a hidden document never advances the animation — so skip the
		// class entirely rather than open invisible and wait for the
		// fallback timer to rescue it.
		if ( ! document.hidden ) {
			this.element.classList.add( 'os-window--opening' );
			this._armOpeningClassRemoval();
		}

		// Maximized/fullscreen restores go through the class-driven path
		// after the geometry renders, so the state transition animates.
		// 'normal' is the default — applying it would echo a redundant
		// save.
		if ( config.initialState && config.initialState !== 'normal' ) {
			requestAnimationFrame( () => this.applyInitialState( config.initialState! ) );
		}
	}

	/**
	 * Clear `.os-window--opening` once the open animation is done —
	 * belt and braces, because the class is not cosmetic. Its
	 * animation's `from` frame is what makes the window transparent
	 * and undersized, so a class that never comes off is a window
	 * that never becomes visible.
	 *
	 * Three ways out, because the animation alone is not a guarantee:
	 *   - `animationend`, filtered on `animationName` + `target` so a
	 *     bubbling animation from the window's own content can't
	 *     claim it (see `OPENING_ANIMATION_NAME`).
	 *   - `animationcancel`, for a class or stylesheet swap that
	 *     tears the animation down mid-flight.
	 *   - a `setTimeout` deadline, for the case where no animation
	 *     event is ever coming (see `OPENING_FALLBACK_MS`).
	 *
	 * Whichever fires first wins and detaches the other two — and
	 * `_finalizeClose()` runs the same teardown if the window is torn
	 * down before any of them, so the deadline never outlives the
	 * window it was arming.
	 */
	private _armOpeningClassRemoval(): void {
		const el = this.element;
		let timer: number | null = null;
		let cleared = false;

		const clear = (): void => {
			if ( cleared ) {
				return;
			}
			cleared = true;
			this._clearOpeningClassRemoval = null;
			// `null` when the deadline itself is the caller: it has
			// already fired, so there is nothing to cancel — and
			// reaching for `window` from a timer that outlived its
			// document is precisely the failure this avoids.
			if ( timer !== null ) {
				window.clearTimeout( timer );
				timer = null;
			}
			el.removeEventListener( 'animationend', onAnimationDone );
			el.removeEventListener( 'animationcancel', onAnimationDone );
			el.classList.remove( 'os-window--opening' );
		};

		const onAnimationDone = ( event: AnimationEvent ): void => {
			if (
				event.target !== el ||
				event.animationName !== OPENING_ANIMATION_NAME
			) {
				return;
			}
			clear();
		};

		el.addEventListener( 'animationend', onAnimationDone );
		el.addEventListener( 'animationcancel', onAnimationDone );
		timer = window.setTimeout( () => {
			timer = null;
			clear();
		}, OPENING_FALLBACK_MS );
		this._clearOpeningClassRemoval = clear;
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
	 * Per-event contract:
	 *   - `NATIVE_WINDOW_BEFORE_RENDER` filter fires, same args.
	 *   - `NATIVE_WINDOW_AFTER_RENDER` action fires, same args.
	 *   - `config.autofocus` is honoured with a `requestAnimationFrame`
	 *     defer so layout side-effects of `render()` settle before
	 *     `.focus()` resolves.
	 *
	 * @internal
	 */
	public hydrateNative(): void {
		if ( ! this.config.native || ! this.config.render ) {
			return;
		}
		const rawBody = this.element.querySelector(
			'.os-window__body',
		) as HTMLElement | null;
		if ( ! rawBody ) {
			return;
		}
		// `before-render` filter — lets subscribers inject a wrapper
		// around the body (a surrounding `<os-panel>`, a theming
		// shim, a dev-time debug outline) before the plugin's own
		// render runs. Typed as returning `HTMLElement` so a filter
		// that returns garbage coerces back to the original body.
		const filtered = applyFilters(
			HOOKS.NATIVE_WINDOW_BEFORE_RENDER,
			rawBody,
			{ windowId: this.id, config: this.config },
		);
		const body = filtered instanceof HTMLElement ? filtered : rawBody;

		// Build the per-render `NativeRenderContext` — channel API
		// (`window.send/on`), `markLoading`/`markReady` (also at the
		// top level), `signal` that aborts on close, and
		// `onResize`/`onHide`/`onShow` subscribers wired to the
		// per-window hooks. The disposer tears every subscription
		// down + aborts the controller; we capture it on the
		// instance so `close()` can fire it before the user-returned
		// teardown runs.
		const { ctx, dispose } = _buildNativeRenderContext(
			this.id,
			this.config.params ?? {},
		);
		this._nativeRenderCtxDispose = dispose;

		// Capture the optional teardown returned by the render callback
		// — invoked on `close()` so plugin authors can dispose
		// listeners, intervals, observers tied to this window's
		// lifecycle. Without this capture, returns from `render()`
		// were silently discarded and authors had no reliable
		// cleanup hook for native windows.
		const maybeTeardown = this.config.render( body, ctx );

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
							`[openstation] native render rejected for "${ this.id }":`,
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
	 * Dispatch a `os-window-changed` event so the session-save
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
			new CustomEvent( 'os-window-changed', {
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
			if ( this.element.classList.contains( 'os-window--overview' ) ) {
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
			if ( this.element.classList.contains( 'os-window--overview' ) ) {
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
			'.os-window__resize-handle',
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

		// Title-bar actions menu (all windows; some items are iframe-only).
		const menuBtn = this.element.querySelector<HTMLElement>(
			'.os-window__menu-btn',
		);
		const menuPanel = this.element.querySelector<HTMLElement>(
			'.os-window__menu-panel',
		);
		if ( menuBtn && menuPanel ) {
			menuBtn.addEventListener( 'click', ( e: Event ) => {
				e.stopPropagation();
				toggleActionsMenu( this );
			} );
			const openAnother = menuPanel.querySelector(
				'.os-window__menu-item--open-another',
			);
			if ( openAnother ) {
				// `<os-menu-item>` emits `os-menu-item-click` on
				// selection — listen for that rather than raw click
				// so other click-based inner DOM (focus rings, etc.)
				// don't double-fire.
				openAnother.addEventListener( 'os-menu-item-click', ( e: Event ) => {
					e.stopPropagation();
					closeActionsMenu( this );
					this.onOpenAnother?.( this );
				} );
			}
			const openInNew = menuPanel.querySelector(
				'.os-window__menu-item--open-in-new-window',
			);
			if ( openInNew ) {
				openInNew.addEventListener( 'os-menu-item-click', ( e: Event ) => {
					e.stopPropagation();
					closeActionsMenu( this );
					this.onOpenInNewWindow?.( this );
				} );
			}
			// "Reload" + "Open in browser tab" moved here from the
			// title-bar controls cluster. Both call straight
			// into the existing `Window` API — no new manager wiring
			// needed. Click closes the menu first so the iframe
			// reload doesn't compete with a still-painted popover.
			const reload = menuPanel.querySelector(
				'.os-window__menu-item--reload',
			);
			if ( reload ) {
				reload.addEventListener( 'os-menu-item-click', ( e: Event ) => {
					e.stopPropagation();
					closeActionsMenu( this );
					this.reload();
				} );
			}
			const openExternal = menuPanel.querySelector(
				'.os-window__menu-item--open-external',
			);
			if ( openExternal ) {
				openExternal.addEventListener( 'os-menu-item-click', ( e: Event ) => {
					e.stopPropagation();
					closeActionsMenu( this );
					this.detach();
				} );
			}
			// "Open on startup" — checkable menu item. Hydrate its
			// checked state from the shared public API, and wire the
			// click handler to toggle via `setDefaultWindow`. The
			// callback is injected by the window manager so we don't
			// couple the Window class to wp.os directly.
			const startup = menuPanel.querySelector<HTMLElement>(
				'.os-window__menu-item--startup',
			);
			if ( startup ) {
				refreshStartupCheckState( this, startup );
				// `<os-menu-item>` emits `os-menu-item-click` on its
				// button click; listen there (not on the plain `click`)
				// so we catch the check toggle without racing the item's
				// own internal state update.
				startup.addEventListener( 'os-menu-item-click', ( e: Event ) => {
					// Keep the menu open — a checkbox item is a toggle,
					// not a one-shot action. Users commonly want to
					// verify the new state without reopening the menu,
					// and the REST round-trip is fast enough that the
					// optimistic flip + the server-confirmation refresh
					// feels instant.
					e.stopPropagation();
					flipMenuItemCheckOptimistically( startup );
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
					'os-default-window-changed',
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

		// Double-click title bar to toggle maximize. Bail when the
		// event came from an interactive descendant (control buttons,
		// the ⋯ kebab itself, kebab menu items, plugin-registered
		// title-bar buttons, screen-meta buttons) — otherwise a
		// second-too-quick click on any title-bar button accidentally
		// maximizes the window.
		this._titleBar.addEventListener( 'dblclick', ( e: MouseEvent ) => {
			const target = e.target as Element | null;
			if (
				target?.closest(
					'button, [role="button"], [role="menuitem"], [role="menuitemcheckbox"], os-window-button, os-menu, os-menu-item, .os-window__menu-panel, .os-window__custom-buttons, input, select, textarea, a',
				)
			) {
				return;
			}
			this.toggleMaximize();
		} );

		/*
		 * Tab-strip wiring, for BOTH window kinds. It used to sit
		 * inside the iframe-only block below, which is why native
		 * windows could not have a strip at all. Nothing in here
		 * presupposes an iframe: the click handler dispatches on the
		 * tab's own `data-kind`, and the keyboard and overflow
		 * observers are pure geometry.
		 */
		const tabs = this.element.querySelector< HTMLElement >(
			'.os-window__tabs',
		);
		if ( tabs ) {
			tabs.addEventListener( 'click', ( e: Event ) =>
				handleTabStripClick( this, e ),
			);
			/*
			 * One delegated listener rather than one per tab: tabs come
			 * and go (external tabs open and close, `setTabs()`
			 * re-declares a native window's), and a per-tab listener
			 * would have to be re-attached on every one of those.
			 */
			tabs.addEventListener( 'keydown', ( e: Event ) =>
				handleTabStripKeydown( tabs, e ),
			);
			/*
			 * Hover intent → ask the service worker to fetch that
			 * screen's document now. A submenu tab is a real page load
			 * (the window navigates in place), and on a live install
			 * the server rendering that page is the majority of the
			 * wait — the part no cache can remove, because admin HTML
			 * carries nonces. Fetching it while the pointer is still
			 * on the tab moves that wait off the click.
			 *
			 * Delegated like the handlers above, and pointer-only:
			 * touch has no hover, so there is no intent to read.
			 *
			 * `pointerover` rather than `pointerenter` is deliberate:
			 * `pointerenter` does not bubble, so it cannot be used from
			 * a delegated listener, and the tabs come and go too often
			 * to bind per tab. The cost is that this fires again as the
			 * pointer crosses a tab's icon and label; both the shell's
			 * ask-throttle and the worker's own de-duplication absorb
			 * that, so the extra events are noise rather than work.
			 */
			tabs.addEventListener( 'pointerover', ( e: Event ) => {
				const ev = e as PointerEvent;
				if ( ev.pointerType !== 'mouse' ) {
					return;
				}
				const tab = ( ev.target as HTMLElement | null )?.closest?.(
					'.os-window__tab[data-url]',
				) as HTMLElement | null;
				const href = tab?.dataset.url;
				if ( ! href ) {
					return;
				}
				// The tab already on screen is not a prediction. It was
				// speculated like any other, and the held copy then
				// answered the next navigation TO it — which is how a
				// list the user had just acted on could come back
				// stale. There is nothing to warm here: the document is
				// already in the iframe.
				if ( tab?.classList.contains( 'is-active' ) ) {
					return;
				}
				// Require a dwell. `pointerover` fires on every crossing
				// — sweeping the pointer across a strip of tabs on the
				// way somewhere else used to ask for every one of them,
				// and each ask holds a rendered admin page for 30 s.
				// Intent looks like stopping.
				if ( this._tabSpeculateTimer ) {
					window.clearTimeout( this._tabSpeculateTimer );
				}
				this._tabSpeculateTimer = window.setTimeout( () => {
					this._tabSpeculateTimer = null;
					speculateTabDocument( href );
				}, TAB_SPECULATE_DWELL_MS );
			} );
			tabs.addEventListener( 'pointerleave', () => {
				if ( this._tabSpeculateTimer ) {
					window.clearTimeout( this._tabSpeculateTimer );
					this._tabSpeculateTimer = null;
				}
			} );
			// Paint the edge fades only where scrolling would
			// actually reveal another tab.
			this._tabOverflowTeardown = observeTabOverflow( tabs );
		}

		// Iframe-only wiring: the load listener and the postMessage
		// bridge both presuppose an iframe. Native windows have
		// neither, so skip this whole block.
		if ( this.iframe ) {
			const iframe = this.iframe;

			// Sync the active tab whenever the iframe finishes a
			// navigation.
			this._wireTabNavSync( iframe );

			// Listen for postMessage from iframe.
			window.addEventListener( 'message', this._boundOnMessage );
		}
	}

	/** Add a closeable+detachable sub-tab hosting an external URL. */
	public addExternalTab( url: string, label: string ): void {
		addExternalTab( this, url, label );
	}

	/**
	 * Declare this native window's tabs in the window chrome.
	 *
	 * Each entry's `value` matches the `for` attribute of an
	 * `<os-tabpanel>` in the window body; the shell shows one pane and
	 * hides the rest. Panes are toggled, never re-rendered, so a pane
	 * that owns a canvas or a live preview keeps it across tab
	 * changes.
	 *
	 * ```js
	 * win.setTabs( [
	 *   { value: 'calc',    label: 'Calc' },
	 *   { value: 'convert', label: 'Convert' },
	 * ] );
	 * ```
	 *
	 * Safe to call again whenever the list changes: it reconciles by
	 * `value` rather than rebuilding, so the user stays on the tab
	 * they were on and the keyboard keeps its place. Pass
	 * `activeValue` only to override that deliberately.
	 *
	 * Listen for `os-window-tab-change` on the window element (it
	 * bubbles) to react to the user's choice.
	 */
	public setTabs(
		entries: readonly PanelTabEntry[],
		activeValue?: string,
	): void {
		setPanelTabs( this.element, entries, activeValue );
	}

	/** Show one of this window's panel tabs programmatically. */
	public activateTab( value: string ): void {
		activatePanelTab( this.element, value );
	}

	/** Set the z-index of this window. */
	public setZIndex( z: number ): void {
		this.element.style.zIndex = String( z );
	}

	/** Mark this window as focused or unfocused. */
	public setFocused( focused: boolean ): void {
		this.element.classList.toggle( 'os-window--focused', focused );
		this._notifyChromeStateChanged();
	}

	/** Update the window title. */
	public setTitle( title: string ): void {
		const titleEl = this.element.querySelector< HTMLElement >(
			'.os-window__title',
		);
		if ( titleEl ) {
			this._titleEl = titleEl;
			titleEl.textContent = title;
		}
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
	 */
	public repaintWindowControls(): void {
		const controlsHost = this.element.querySelector< HTMLElement >(
			'.os-window__controls',
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
	 * Repaint the parts of this window's chrome that a desktop theme
	 * can substitute but `repaintWindowControls()` does not cover:
	 * the title-bar icon (an `APP:<id>` / `DEFAULT_APP_ICON` slot)
	 * and the leading ⋯ menu button (`WINDOW_CONTROL_MENU`).
	 *
	 * Both are built once in `buildWindowDom()` rather than by the
	 * control-registry painter, so a live theme switch would leave
	 * them showing the previous theme's artwork until the window was
	 * reopened. Called from the shell's
	 * `os-desktop-theme-changed` listener.
	 *
	 * @internal
	 */
	public repaintThemedChrome(): void {
		const iconHost = this.element.querySelector< HTMLElement >(
			'.os-window__slot--icon',
		);
		if ( iconHost ) {
			const existing = iconHost.querySelector(
				'.os-window__icon',
			);
			if ( existing ) {
				existing.replaceWith(
					renderIcon( this.config.icon, {
						title: this.config.title,
						className: 'os-window__icon',
						slot: slotForTileId( this.config.id ),
					} ),
				);
			}
		}

		const menuBtn = this.element.querySelector< HTMLElement >(
			'.os-window__menu-btn',
		);
		if ( menuBtn ) {
			// Drop whatever the previous theme (or the default) left
			// behind — a light-DOM dashicon span and/or the mask attr —
			// before asking the current theme again.
			menuBtn
				.querySelectorAll( ':scope > .dashicons' )
				.forEach( ( el ) => el.remove() );
			menuBtn.removeAttribute( 'icon-src' );
			menuBtn.setAttribute( 'icon', 'menu' );
			paintThemedControlIcon( menuBtn, 'core/menu' );
		}
	}

	/**
	 * Apply (or clear) a per-window controls config at runtime.
	 * Mutates `this.config.appearance.controls` and re-paints. Pass
	 * `null` or `undefined` to clear the override and fall back to
	 * the registry-only resolution.
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
	 * **Experimental** — the chrome render contract may
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
		if ( ! this._applySnapVisuals( zone ) ) {
			return;
		}
		this.state = zone === 'left' ? 'snapped-left' : 'snapped-right';
		this._emitChange( 'state' );
	}

	/**
	 * Apply the snap-zone visuals (state class + inline geometry). Does
	 * NOT mutate `state`, save geometry, emit a change event, or fire
	 * any action — callers own all of those side-effects so the same
	 * helper can power both the public {@link applySnap} (which emits +
	 * sets state) and the fullscreen-exit-to-snapped path in
	 * {@link toggleFullscreen} (which emits + fires hooks exactly once
	 * across the transition).
	 *
	 * @return `true` when geometry was applied; `false` when the
	 *         element has no parent and we can't size against it.
	 * @internal
	 */
	private _applySnapVisuals( zone: 'left' | 'right' ): boolean {
		const parent = this.element.parentElement;
		if ( ! parent ) {
			return false;
		}
		// Half the desktop area, full height — the whole area, dock
		// band included. Snapping is an explicit ask for the edge, and
		// the band under the dock is the user's to use on purpose; only
		// DEFAULT placement (open, restore, cascade, tile) stays out of
		// it. See `workAreaRectOf` in `src/work-area`.
		const halfW = Math.floor( parent.clientWidth / 2 );
		const height = parent.clientHeight;
		this.element.classList.remove(
			'os-window--maximized',
			'os-window--fullscreen',
			'os-window--snapped-left',
			'os-window--snapped-right',
		);
		this.element.classList.add( `os-window--snapped-${ zone }` );
		this.element.style.left = zone === 'left' ? '0px' : `${ halfW }px`;
		this.element.style.top = '0px';
		this.element.style.width = `${ halfW }px`;
		this.element.style.height = `${ height }px`;
		return true;
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
	 */
	public isMinimized(): boolean {
		return this.state === 'minimized';
	}

	/** Predicate: is this window currently maximized? */
	public isMaximized(): boolean {
		return this.state === 'maximized';
	}

	/** Predicate: is this window in fullscreen mode? */
	public isFullscreen(): boolean {
		return this.state === 'fullscreen';
	}

	/**
	 * Predicate: is this window currently snapped to a screen edge?
	 * Returns `true` for both half-screen positions; pass an explicit
	 * side string if you need to distinguish.
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
	 * window? Reads the `os-window--focused` class the manager
	 * toggles in `focus()` so the result matches what's visible.
	 */
	public isFocused(): boolean {
		return this.element.classList.contains( 'os-window--focused' );
	}

	public minimize(): void {
		// Re-entering minimize from minimize would clobber the saved
		// underlying state, leaking the 'minimized' value into the
		// restore target.
		if ( this.state === 'minimized' ) {
			return;
		}
		this._stateBeforeMinimize = this.state;
		this.state = 'minimized';
		this.element.classList.add( 'os-window--minimized' );

		// After the transition completes, stop the hidden window doing
		// rendering work. `opacity: 0` alone leaves the subtree in the
		// render tree: the iframe keeps compositing and its rAF loops
		// keep firing, and with several minimized wp-admin pages that's
		// real background cost. `visibility: hidden` on the iframe plus
		// `content-visibility: hidden` on the window root skip paint,
		// layout, and in-iframe rAF entirely while preserving all DOM /
		// iframe state for an instant restore. (Timers and Heartbeat
		// inside the iframe still run — stopping those would require
		// unloading the page.) Browsers without content-visibility
		// ignore the property and keep today's behavior.
		this.element.addEventListener( 'transitionend', ( e: TransitionEvent ) => {
			if (
				e.propertyName === 'opacity' &&
				this.state === 'minimized' &&
				! this.element.classList.contains( 'os-window--overview' )
			) {
				if ( this.iframe ) {
					this.iframe.style.visibility = 'hidden';
				}
				this.element.style.setProperty( 'content-visibility', 'hidden' );
			}
		}, { once: true } );

		this.onMinimize?.( this );
		this._emitChange( 'state' );
		doAction( HOOKS.WINDOW_MINIMIZED, {
			windowId: this.id,
			element: this.element,
		} );

		if ( this._stateBeforeMinimize === 'fullscreen' ) {
			updateFullscreenBodyClass();
		}
	}

	/**
	 * Restore the window from minimized state. Returns the window to
	 * whichever underlying state it occupied before {@link minimize} —
	 * so a previously-maximized window comes back maximized rather than
	 * silently dropping into 'normal' while the `--maximized` class
	 * (still on the element from before minimize) leaves the visual
	 * out of sync with `this.state`.
	 */
	public restore(): void {
		// Restore renderability before the animation starts — the
		// un-minimize transition needs the subtree painting again.
		this.element.style.removeProperty( 'content-visibility' );
		if ( this.iframe ) {
			this.iframe.style.visibility = '';
		}

		const wasMinimized = this.state === 'minimized';
		this.element.classList.remove( 'os-window--minimized' );
		if ( wasMinimized ) {
			// `null` fallback covers windows whose state was already
			// minimized at construction time (session restore) — no
			// prior state was captured for those, so 'normal' is the
			// only sensible default.
			this.state = this._stateBeforeMinimize ?? 'normal';
			this._stateBeforeMinimize = null;
			// Re-sync UI pieces that key off `state === 'fullscreen'`.
			// The fullscreen body class (admin-bar hide) and the focus
			// button's pressed/aria-label state were set when the
			// window first entered fullscreen; if anything during the
			// minimized window's lifetime re-rendered the title-bar
			// controls (control re-registration, theme swap, plugin
			// re-render) the button comes back showing the "Enter
			// fullscreen" label even though the window is about to
			// reappear in fullscreen. Idempotent calls — safe to fire
			// for non-fullscreen restored states too, but guarded so
			// we don't pointlessly walk the DOM on the common
			// `restore-to-normal` path.
			if ( this.state === 'fullscreen' ) {
				updateFullscreenBodyClass();
				this.updateFocusButtonState();
			}
		}
		if ( wasMinimized ) {
			// Bring owned child windows back BEFORE requesting focus.
			// Ordering is load-bearing: while the children are still
			// minimized none of them blocks, so a focus request here
			// would land on this window and then have to be corrected
			// once they reappear — two focus changes for one user
			// action. Restore first and the single request below
			// resolves straight to the child that should hold focus.
			this.onRestore?.( this );
		}
		this.onFocusRequest?.( this );
		this._emitChange( 'state' );
		if ( wasMinimized ) {
			// After `onRestore`, so a subscriber that inspects the
			// desktop sees this window's children already back rather
			// than a half-restored ownership group.
			doAction( HOOKS.WINDOW_RESTORED, {
				windowId: this.id,
				element: this.element,
			} );
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
		// Capture floating geometry exactly once per "trip" out of
		// 'normal'. If we're already in another alternate state
		// (fullscreen, snapped-*), the caller that originally took us
		// out of 'normal' has already saved the pre-flight geometry —
		// re-saving now would overwrite it with the alternate-state
		// rect (e.g. fullscreen's 100vw/100vh), losing the user's
		// real floating position. `offsetLeft` / `offsetWidth` etc.
		// ignore CSS transforms, so overview-transform callers still
		// land the pre-transform inline position when state is
		// 'normal'.
		if ( this.state === 'normal' ) {
			this._savedGeometry = {
				x: this.element.offsetLeft,
				y: this.element.offsetTop,
				width: this.element.offsetWidth,
				height: this.element.offsetHeight,
			};
		}
		if ( ! this._applyMaximizeVisuals() ) {
			return;
		}
		this.state = 'maximized';
		this._emitChange( 'state' );
		doAction( HOOKS.WINDOW_MAXIMIZED, {
			windowId: this.id,
			element: this.element,
		} );
	}

	/**
	 * Apply the maximize visuals (state class + inline geometry against
	 * the live parent bounds). Mirror of {@link _applySnapVisuals} —
	 * does NOT mutate `state`, save geometry, emit a change event, or
	 * fire any action. Callers control all of that so the same helper
	 * powers {@link maximize}, {@link toggleMaximize}'s fullscreen
	 * branch, and {@link toggleFullscreen}'s exit-to-maximized branch
	 * without duplicating the class+geometry math AND without the
	 * idempotency-guard / save-geometry interlock that bit the
	 * exit-to-maximized path before this refactor.
	 *
	 * @return `true` when geometry was applied; `false` when the
	 *         element has no parent and we can't size against it.
	 * @internal
	 */
	private _applyMaximizeVisuals(): boolean {
		const parent = this.element.parentElement;
		if ( ! parent ) {
			return false;
		}
		// Mutually-exclusive state classes — strip the others so the
		// element never carries two at once (e.g. `--fullscreen` would
		// keep its `!important` 100vw/100vh in force and silently
		// nullify the maximize visuals).
		this.element.classList.remove(
			'os-window--fullscreen',
			'os-window--snapped-left',
			'os-window--snapped-right',
		);
		this.element.classList.add( 'os-window--maximized' );
		// The whole desktop area, dock band included. Maximizing is an
		// explicit ask for everything, and a dock the user wants out of
		// the way of a maximized window is what the `dynamic` dock
		// behavior is for. Only DEFAULT placement stays clear of the
		// dock (see `workAreaRectOf` in `src/work-area`).
		this.element.style.left = '0px';
		this.element.style.top = '0px';
		this.element.style.width = `${ parent.clientWidth }px`;
		this.element.style.height = `${ parent.clientHeight }px`;
		return true;
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
			this.element.classList.remove( 'os-window--maximized' );
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
			doAction( HOOKS.WINDOW_UNMAXIMIZED, {
				windowId: this.id,
				element: this.element,
			} );
			return;
		}

		if ( this.state === 'fullscreen' ) {
			// Fullscreen → maximize is the case the user lands on when
			// they click "Maximize" while the focus/fullscreen button
			// has put the window in immersive mode. Without this branch
			// the generic `else` below would stack `--maximized` on top
			// of `--fullscreen` — fullscreen's `!important` rules win,
			// so the user sees no visual change while `state` silently
			// flips, breaking every subsequent click.
			//
			// Use the visuals-only helper rather than calling
			// `maximize()` so we keep tight control over the side-
			// effects:
			//   - state is set to `'maximized'` BEFORE either action
			//     fires (so subscribers reading `win.state` see the
			//     post-transition value).
			//   - `_savedGeometry` is left untouched — the original
			//     floating geometry was saved when the user first left
			//     'normal' and must survive this transition.
			//   - Single `_emitChange` and a deterministic hook order
			//     (FULLSCREEN_EXITED before MAXIMIZED, matching the
			//     symmetric `toggleFullscreen` exit-to-maximized path).
			this._savedFullscreenState = null;
			this._applyMaximizeVisuals();
			this.state = 'maximized';
			updateFullscreenBodyClass();
			this.updateFocusButtonState();
			this._emitChange( 'state' );
			doAction( HOOKS.WINDOW_FULLSCREEN_EXITED, {
				windowId: this.id,
				element: this.element,
			} );
			doAction( HOOKS.WINDOW_MAXIMIZED, {
				windowId: this.id,
				element: this.element,
			} );
			return;
		}

		// Normal or snapped-* → maximize. `maximize()` already strips
		// the other alternate-state classes and only re-captures the
		// floating geometry when coming from 'normal'.
		this.maximize();
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
			// fullscreen. The exit branch handles every restore path
			// itself rather than reusing `maximize()` / `applySnap()`,
			// because those would (a) re-save `_savedGeometry` from the
			// stale inline rect and (b) fire their own `_emitChange` —
			// producing a double state-change event AND, in the
			// exit-to-maximized case, clobbering the real floating
			// geometry with the maximized 0,0,parentW,parentH.
			this.element.classList.remove( 'os-window--fullscreen' );
			const s = this._savedFullscreenState;
			this._savedFullscreenState = null;
			let landedOnMaximize = false;
			if ( s && s.state === 'maximized' ) {
				this._applyMaximizeVisuals();
				this.state = 'maximized';
				landedOnMaximize = true;
			} else if (
				s && ( s.state === 'snapped-left' || s.state === 'snapped-right' )
			) {
				const zone: 'left' | 'right' =
					s.state === 'snapped-left' ? 'left' : 'right';
				this._applySnapVisuals( zone );
				this.state = s.state;
			} else if ( s ) {
				// Pre-fullscreen state was normal — restore that exact
				// inline geometry.
				this.element.style.left = `${ s.x }px`;
				this.element.style.top = `${ s.y }px`;
				this.element.style.width = `${ s.width }px`;
				this.element.style.height = `${ s.height }px`;
				this.state = 'normal';
			} else {
				this.state = 'normal';
			}
			updateFullscreenBodyClass();
			this.updateFocusButtonState();
			this._emitChange( 'state' );
			doAction( HOOKS.WINDOW_FULLSCREEN_EXITED, {
				windowId: this.id,
				element: this.element,
			} );
			if ( landedOnMaximize ) {
				// Re-entering maximized as a side-effect of exiting
				// fullscreen — fire the MAXIMIZED hook so subscribers
				// see the same sequence as the symmetric
				// `toggleMaximize` from-fullscreen path.
				doAction( HOOKS.WINDOW_MAXIMIZED, {
					windowId: this.id,
					element: this.element,
				} );
			}
			return;
		}

		// Enter fullscreen.
		// Capture floating geometry exactly once — same rule as
		// `maximize()`. If the user reaches fullscreen via
		// normal → maximize → fullscreen the maximize call already
		// saved their real floating rect, so we mustn't overwrite it
		// here with the maximized 0,0,parentW,parentH.
		if ( this.state === 'normal' ) {
			this._savedGeometry = {
				x: this.element.offsetLeft,
				y: this.element.offsetTop,
				width: this.element.offsetWidth,
				height: this.element.offsetHeight,
			};
		}
		this._savedFullscreenState = {
			state: this.state,
			x: this.element.offsetLeft,
			y: this.element.offsetTop,
			width: this.element.offsetWidth,
			height: this.element.offsetHeight,
		};
		// Strip the other alternate-state classes so only
		// `--fullscreen` is active. Without this a snapped-* or
		// maximized window would carry two state classes and the
		// fullscreen-exit restore would land in an inconsistent visual.
		this.element.classList.remove(
			'os-window--maximized',
			'os-window--snapped-left',
			'os-window--snapped-right',
		);
		this.element.classList.add( 'os-window--fullscreen' );
		this.state = 'fullscreen';
		updateFullscreenBodyClass();
		this.updateFocusButtonState();
		this._emitChange( 'state' );
		doAction( HOOKS.WINDOW_FULLSCREEN_ENTERED, {
			windowId: this.id,
			element: this.element,
		} );
	}

	/**
	 * Reflect fullscreen state on the focus-mode button (active class,
	 * aria-pressed, and label).
	 */
	private updateFocusButtonState(): void {
		const btn = this.element.querySelector<HTMLButtonElement>(
			'.os-window__btn--focus',
		);
		if ( ! btn ) {
			return;
		}
		const isFullscreen = this.state === 'fullscreen';
		btn.classList.toggle( 'os-window__btn--active', isFullscreen );
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
	 * Strips the chromeless `openstation_chromeless` flag and the transient
	 * `desktop_mode_portal` flag, and tags the URL with
	 * `desktop_mode_classic=1` so the server-side admin_init redirect
	 * (which otherwise forwards plain admin URLs to `/openstation/`)
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
		url.searchParams.delete( 'openstation_chromeless' );
		url.searchParams.delete( 'desktop_mode_portal' );
		url.searchParams.set( 'desktop_mode_classic', '1' );

		// `noopener` is required for security (tabs should not be able
		// to reach back into window.opener), and it also lets the
		// browser move the new tab to its own process.
		window.open( url.toString(), '_blank', 'noopener' );
		doAction( HOOKS.WINDOW_DETACHED, { windowId: this.id, url: url.toString() } );
	}

	/**
	 * Reload the active iframe of this window. If an external sub-tab
	 * is foregrounded, that iframe is reloaded instead of the primary
	 * one. Same-origin iframes use `location.reload()` for a clean
	 * reload that preserves scroll position semantics; cross-origin
	 * external tabs fall back to re-assigning `iframe.src`.
	 *
	 * Native windows reload too — see {@link _reloadNative}. They have
	 * no frame to refresh, so the equivalent is tearing the previous
	 * render down and running the render callback again.
	 */
	public reload(): void {
		// Guard against double-clicks during an in-flight reload — a
		// second `location.reload()` while the first is still hydrating
		// can desync the chromeless bridge's `os-ready`
		// handshake. The body's `--loading` class is the upstream
		// signal set by `markContentLoading()` and cleared on the
		// next `os-ready` postMessage. Native windows are held to the
		// same rule: a promise-returning render is still in flight
		// while the class is on, and re-entering would leave its
		// resolution writing into a body a newer render owns.
		const body = this.element.querySelector( '.os-window__body' );
		if ( body?.classList.contains( 'os-window__body--loading' ) ) {
			return;
		}
		if ( this.config.native ) {
			this._reloadNative();
			return;
		}
		// Resolve the target surface and its URL up-front, before any
		// observable side effect — so an unexpected null iframe or
		// missing external-tab entry returns silently instead of
		// arming the loading overlay with no actual reload behind it
		// (which would leave the spinner stuck forever).
		let reloadedUrl: string;
		let triggerReload: () => void;
		if ( this._activeTabId === 'primary' ) {
			if ( ! this.iframe ) {
				return;
			}
			const iframe = this.iframe;
			reloadedUrl = this.getCurrentUrl();
			triggerReload = () => {
				try {
					iframe.contentWindow?.location.reload();
				} catch {
					// Cross-origin or detached frame — re-assign src
					// as a fallback. The current src is what's already
					// loaded, so re-setting it triggers a fresh load.
					iframe.src = iframe.src;
				}
			};
		} else {
			const entry = this._externalTabs.get( this._activeTabId );
			if ( ! entry ) {
				return;
			}
			reloadedUrl = entry.url;
			triggerReload = () => {
				try {
					entry.iframe.contentWindow?.location.reload();
				} catch {
					entry.iframe.src = entry.url;
				}
			};
		}
		// Click feedback first (independent of network latency), then
		// arm the loading overlay (will be cleared by `os-ready`),
		// then fire the actual reload, then notify subscribers.
		this._spinReloadButton();
		this.markContentLoading();
		triggerReload();
		doAction( HOOKS.WINDOW_RELOADED, {
			windowId: this.id,
			url: reloadedUrl,
		} );
	}

	/**
	 * Reload a native window by re-running its render callback.
	 *
	 * A native window has no frame to refresh, so "reload" means the
	 * closest honest equivalent: dispose the render context, run the
	 * teardown the previous render returned, empty the body, and call
	 * {@link hydrateNative} again. What the plugin author gets is the
	 * same lifecycle a fresh open runs — `NATIVE_WINDOW_BEFORE_RENDER`,
	 * `render( body, ctx )` with a **new** `ctx` (new `signal`, new
	 * channel subscriptions), `NATIVE_WINDOW_AFTER_RENDER` — against
	 * the same live `Window`. The window itself does not close and
	 * reopen: id, geometry, focus, z-order, params and session entry
	 * all survive, and no `WINDOW_CLOSED` / `WINDOW_OPENED` pair fires
	 * for something the user experienced as a refresh.
	 *
	 * Teardown runs before the body is emptied, not after, so a
	 * teardown that reads its own DOM (detaching a listener, reading a
	 * final scroll offset) still finds it. Both callbacks are
	 * contained: a throwing teardown reports through `SHELL_ERROR` and
	 * the reload proceeds, because a plugin's cleanup bug must not
	 * cost the user the reload they asked for.
	 *
	 * The loading overlay is armed here and cleared by the readiness
	 * signal `hydrateNative()` already emits — immediately on the next
	 * frame for a synchronous render, on settle for a promise-returning
	 * one. So a render that refetches shows a spinner for exactly as
	 * long as the refetch takes, with no extra plumbing.
	 */
	private _reloadNative(): void {
		if ( ! this.config.render ) {
			return;
		}
		const body = this.element.querySelector(
			'.os-window__body',
		) as HTMLElement | null;
		if ( ! body ) {
			return;
		}

		if ( this._nativeRenderCtxDispose ) {
			try {
				this._nativeRenderCtxDispose();
			} catch ( err ) {
				doAction( HOOKS.SHELL_ERROR, {
					scope: 'native-window-ctx-dispose',
					id: this.id,
					error: err,
				} );
			}
			this._nativeRenderCtxDispose = null;
		}
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

		body.replaceChildren();

		// Click feedback first (independent of how long the render
		// takes), then arm the overlay, then render, then notify —
		// the same order the iframe path uses.
		this._spinReloadButton();
		this.markContentLoading();
		this.hydrateNative();
		doAction( HOOKS.WINDOW_RELOADED, {
			windowId: this.id,
			url: this.config.url ?? '',
		} );
	}

	/**
	 * Navigate the window's primary iframe to a new admin URL.
	 *
	 * Used by `WindowManager.open()` when a caller re-opens an
	 * existing window with a URL it isn't already showing — e.g. the
	 * post-install "Activate" link
	 * (`plugins.php?action=activate&plugin=…&_wpnonce=…`) clicked
	 * while a Plugins window is already open. The URL gets the
	 * chromeless flag appended via `withChromelessParam()`, which
	 * doubles as the same-origin gate. Navigation prefers
	 * `location.assign()` so the iframe keeps a real session-history
	 * entry (Back still works), falling back to `iframe.src` when the
	 * content window is torn down or inaccessible.
	 *
	 * Returns `true` when a navigation was started, `false` for
	 * native windows, missing iframes, or cross-origin URLs.
	 */
	public navigateTo( url: string ): boolean {
		if ( this.config.native || ! this.iframe ) {
			return false;
		}
		const target = withChromelessParam( url );
		if ( ! target ) {
			return false;
		}
		// Arm the loading overlay before re-pointing the iframe — the
		// same affordance the submenu tab strip shows for in-place
		// navigation. Cleared by `os-ready` / the iframe
		// `load` event, exactly like a fresh open.
		this.markContentLoading();
		const inner = this.iframe.contentWindow;
		if ( inner ) {
			try {
				inner.location.assign( target );
				return true;
			} catch {
				// Torn-down frame — fall through to the never-throwing
				// `src` assignment.
			}
		}
		this.iframe.src = target;
		return true;
	}

	/**
	 * Forward pointerdowns inside a same-origin, BRIDGE-LESS iframe
	 * document to the shell's focus path.
	 *
	 * Clicks inside an iframe never bubble to the parent document.
	 * Chromeless admin pages escalate them through the bridge's own
	 * pointerdown → `os-focus-request` postMessage, and the
	 * manager's window-blur fallback catches the parent → iframe
	 * transition — but a click moving focus from one IFRAME to
	 * another (editor ↔ preview) fires neither: the parent is already
	 * blurred and a front-end document carries no bridge. This
	 * forwarder closes that gap for same-origin non-admin content
	 * (the editor-preview companion, the home-page default window) by
	 * listening directly inside the frame's document — re-attached on
	 * every `load`, since each navigation creates a fresh document.
	 *
	 * Admin documents are skipped: the bridge already escalates
	 * there, and a second forwarder would double-fire the focus
	 * hooks. Cross-origin documents are unreachable and silently
	 * skipped (they keep the blur-fallback behavior).
	 *
	 * @internal
	 */
	private _wireContentFocusForwarder( iframe: HTMLIFrameElement ): void {
		const attach = (): void => {
			let doc: Document | null = null;
			try {
				doc = iframe.contentDocument;
			} catch {
				return; // Cross-origin.
			}
			if ( ! doc ) {
				return;
			}
			if ( doc.location && doc.location.pathname.indexOf( '/wp-admin/' ) !== -1 ) {
				return; // Bridge territory.
			}
			doc.addEventListener(
				'pointerdown',
				() => {
					if (
						this.element.classList.contains(
							'os-window--overview',
						)
					) {
						return;
					}
					this.onFocusRequest?.( this );
				},
				{ capture: true, passive: true },
			);
		};
		iframe.addEventListener( 'load', attach );
		// Attach to the CURRENT document too — the swap-promotion
		// call site runs after the twin's load already fired.
		attach();
	}

	/**
	 * Per-navigation upkeep for the frame: hand off if this window's
	 * screen has finished, otherwise adopt the new page's title (when
	 * ours was only a guess) and keep the submenu tab strip lit.
	 *
	 * Reading `contentWindow.location` is safe because only
	 * same-origin URLs are allowed; cross-origin would have thrown
	 * earlier. Wired to the primary iframe at construction and
	 * re-wired to the twin {@link swapReload} promotes — listeners
	 * don't travel between elements.
	 *
	 * @internal
	 */
	private _wireTabNavSync( iframe: HTMLIFrameElement ): void {
		iframe.addEventListener( 'load', () => {
			try {
				const href = iframe.contentWindow?.location.href;
				if ( ! href ) {
					return;
				}
				// A handoff closes this window, so nothing below it
				// has anything left to act on.
				if ( handleFinishedScreenHandoff( this, href ) ) {
					return;
				}
				adoptPageTitle( this );
				syncActiveTab( this, href );
			} catch {
				/* Cross-origin or detached frame — ignore. */
			}
		} );
	}

	/**
	 * In-flight double-buffer frame for {@link swapReload}, plus its
	 * abandon timer. One buffer at most — a newer swap request
	 * discards the previous buffer and starts over.
	 *
	 * @internal
	 */
	private _swapBuffer: HTMLIFrameElement | null = null;

	/** @internal */
	private _swapBufferTimer: number | null = null;

	/**
	 * Discard the in-flight swap buffer (if any): cancel the abandon
	 * timer, remove the buffered frame, and restore the visible
	 * frame's swap elevation. Safe to call at any time.
	 *
	 * @internal
	 */
	private _discardSwapBuffer(): void {
		if ( this._swapBufferTimer !== null ) {
			window.clearTimeout( this._swapBufferTimer );
			this._swapBufferTimer = null;
		}
		if ( this._swapBuffer ) {
			this._swapBuffer.remove();
			this._swapBuffer = null;
			this.iframe?.classList.remove(
				'os-window__iframe--swap-front',
			);
		}
	}

	/**
	 * Silent, double-buffered reload of the primary iframe — refresh
	 * the content with NO loading overlay, NO blank frame, and NO
	 * scroll jump.
	 *
	 * {@link reload} is the right affordance for a user-initiated
	 * reload: it arms the loading overlay and repaints from scratch.
	 * For high-frequency programmatic refreshes (the editor-preview
	 * companion re-rendering after every typing pause) that treatment
	 * strobes. This method instead loads the target URL into a twin
	 * iframe stacked UNDERNEATH the visible one at full opacity — a
	 * normal, fully-rasterized paint target, covered by the opaque
	 * old frame while it loads (never `opacity: 0`-on-top or
	 * `visibility: hidden`: browsers defer rasterizing invisible
	 * iframes and revealing one flashes its blank background first).
	 * When the twin finishes loading, the scroll position is carried
	 * across and the old frame is removed in the same tick — an
	 * instant, animation-free cut to the ready-painted new content.
	 * There is no moment where unpainted content is the only thing
	 * on screen.
	 *
	 * Semantics and guards:
	 *  - Primary tab only. On an active external sub-tab this
	 *    delegates to {@link reload} (sub-tabs are transient surfaces;
	 *    buffering them isn't worth the bookkeeping).
	 *  - One buffer at most: a newer call discards an in-flight
	 *    buffer and restarts with the newest URL. The visible frame
	 *    is never touched until a buffered load actually lands.
	 *  - A buffer that never fires `load` is abandoned after 20 s —
	 *    the visible frame simply stays as it was.
	 *  - When `url` is given it passes through the same
	 *    `withChromelessParam()` same-origin gate as
	 *    {@link navigateTo}; cross-origin URLs are ignored.
	 *  - Scroll restoration is same-origin only (a cross-origin
	 *    preview frame silently starts at the top).
	 *  - Fires `HOOKS.WINDOW_RELOADED` with `silent: true` on swap
	 *    completion.
	 *
	 * @param url Optional same-origin URL to load; omit to refresh
	 *            the current URL in place.
	 */
	public swapReload( url?: string ): void {
		if ( this.config.native || ! this.iframe || this._isDestroyed ) {
			return;
		}
		if ( this._activeTabId !== 'primary' ) {
			this.reload();
			return;
		}
		const target = url ? withChromelessParam( url ) : this.getCurrentUrl();
		if ( ! target ) {
			return;
		}

		// A newer request supersedes any in-flight buffer.
		this._discardSwapBuffer();

		const current = this.iframe;
		// Elevate the visible frame above the buffer for the swap's
		// duration — positioned elements otherwise paint above the
		// static primary regardless of DOM order.
		current.classList.add( 'os-window__iframe--swap-front' );
		const buffer = document.createElement( 'iframe' );
		buffer.className =
			'os-window__iframe os-window__iframe--buffer';
		buffer.setAttribute( 'aria-hidden', 'true' );
		buffer.setAttribute( 'name', `os-frame-${ this.id }-buffer` );

		this._swapBuffer = buffer;
		this._swapBufferTimer = window.setTimeout( () => {
			// Hung or endless load — abandon quietly; the visible
			// frame was never touched.
			if ( this._swapBuffer === buffer ) {
				this._discardSwapBuffer();
			}
		}, 20000 );

		buffer.addEventListener(
			'load',
			() => {
				if ( this._swapBuffer !== buffer || this._isDestroyed ) {
					// Superseded by a newer swap (or the window died)
					// while loading — this buffer is already detached
					// or about to be.
					return;
				}
				this._swapBuffer = null;
				if ( this._swapBufferTimer !== null ) {
					window.clearTimeout( this._swapBufferTimer );
					this._swapBufferTimer = null;
				}

				// Carry the scroll position across BEFORE the swap so
				// the new frame never paints at the top. Same-origin
				// only — cross-origin reads throw and we skip.
				let scrollX = 0;
				let scrollY = 0;
				try {
					scrollX = current.contentWindow?.scrollX ?? 0;
					scrollY = current.contentWindow?.scrollY ?? 0;
				} catch {
					/* cross-origin */
				}
				if ( scrollX || scrollY ) {
					try {
						buffer.contentWindow?.scrollTo( scrollX, scrollY );
					} catch {
						/* cross-origin */
					}
				}

				// Instant cut: dropping the old frame exposes the
				// ready-painted twin beneath in the same compositor
				// frame (see the CSS comment on `--buffer` for why
				// under, not over). No animation by design.
				buffer.classList.remove(
					'os-window__iframe--buffer',
				);
				buffer.removeAttribute( 'aria-hidden' );
				buffer.setAttribute(
					'name',
					`os-frame-${ this.id }`,
				);
				current.remove();
				this.iframe = buffer;

				// The swap may have replaced a frame whose FIRST load
				// never finished (a companion refreshed right after
				// opening) — its pending load event died with it, and
				// the boot overlay it armed would never clear. The
				// buffer's load HAS completed, so the window provably
				// has ready content: mark it so. A no-op in the common
				// case where the overlay already cleared.
				markWindowContentReady( this.id );
				noteFrameLoaded( buffer );

				// Keep the overlay contract alive for FUTURE classic
				// reloads: the original frame got this wiring in
				// `dom.ts` at build time; the twin needs it too or a
				// later `reload()` would arm an overlay nothing
				// clears.
				buffer.addEventListener( 'load', () => {
					markWindowContentReady( this.id );
					noteFrameLoaded( buffer );
				} );

				// Same for the focus forwarder — the click-to-focus
				// listener lived inside the OLD frame's document; the
				// twin's document needs its own (attaches to the
				// current document immediately, this load already
				// fired).
				this._wireContentFocusForwarder( buffer );

				// And the tab-strip sync: the submenu-highlight
				// listener from construction also lived on the old
				// frame. Sync once for THIS navigation (its load
				// already fired), then re-wire for future ones.
				this._wireTabNavSync( buffer );
				syncActiveTab( this, target );

				doAction( HOOKS.WINDOW_RELOADED, {
					windowId: this.id,
					url: target,
					silent: true,
				} );
			},
			{ once: true },
		);

		// Insert BEFORE assigning src — a detached iframe doesn't
		// start loading.
		current.insertAdjacentElement( 'afterend', buffer );
		buffer.src = target;
	}

	/**
	 * Trigger the one-shot 360° rotation on the title-bar reload
	 * button. Force-restart the animation by removing the class,
	 * flushing a reflow, then re-adding it; otherwise a click during
	 * an in-flight animation would be a no-op (CSS ignores re-applying
	 * the same animation to an unchanged class). Pattern mirrors
	 * {@link shake} for the same restart-on-repeat reason.
	 *
	 * Silent no-op when the title bar has been replaced by a custom
	 * chrome layer that doesn't render the standard reload button.
	 *
	 * @internal
	 */
	private _spinReloadButton(): void {
		const btn = this.element.querySelector(
			'.os-window__btn--reload',
		);
		if ( ! ( btn instanceof HTMLElement ) ) {
			return;
		}
		btn.classList.remove( 'os-window__btn--spinning' );
		void btn.offsetWidth;
		btn.classList.add( 'os-window__btn--spinning' );
		btn.addEventListener(
			'animationend',
			() => {
				btn.classList.remove( 'os-window__btn--spinning' );
			},
			{ once: true },
		);
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
			'.os-window__custom-buttons--left',
		);
		const rightSlot = this.element.querySelector< HTMLElement >(
			'.os-window__custom-buttons--right',
		);
		if ( ! leftSlot || ! rightSlot ) {
			return;
		}
		leftSlot.innerHTML = '';
		rightSlot.innerHTML = '';

		const { left, right } = buttonsForWindow( this );
		const fill = ( slot: HTMLElement, defs: TitleBarButtonDef[] ): void => {
			for ( const def of defs ) {
				const host = document.createElement( 'os-window-button' );
				paintTitleBarButtonIcon( host, def.icon );
				host.setAttribute( 'aria-label', def.label );
				host.setAttribute( 'title', def.label );
				host.classList.add( 'os-window__btn' );
				host.classList.add( 'os-window__btn--custom' );
				host.dataset.buttonId = def.id;
				slot.appendChild( host );

				if ( typeof def.render === 'function' ) {
					try {
						def.render( host, this );
					} catch ( err ) {
						if ( typeof console !== 'undefined' ) {
							console.error(
								'[openstation] title-bar-button render threw:',
								def.id,
								err,
							);
						}
					}
				} else if ( typeof def.onClick === 'function' ) {
					// Listen for `os-button-activate` — the once-per-
					// gesture CustomEvent the component fires. Using
					// the named event (not raw `click`) means the
					// contract is "fires exactly once per user
					// activation, never racy with the title-bar
					// drag handler". The drag-handler exclusion in
					// `src/window/pointer.ts` makes raw `click`
					// reliable too, but plugin authors should reach
					// for the named event for clarity.
					host.addEventListener( 'os-button-activate', ( ev ) => {
						try {
							def.onClick!( this, ev as unknown as MouseEvent );
						} catch ( err ) {
							if ( typeof console !== 'undefined' ) {
								console.error(
									'[openstation] title-bar-button onClick threw:',
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
	 * the payload is delivered as `os-window-send` via
	 * `postMessage` and surfaces inside the iframe via
	 * `wp.os.on( channel, cb )` (the iframe-bridge installs
	 * the API on `wp.os`). Calls made before the iframe has
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
						type: 'os-window-send',
						channel,
						payload,
					},
					INITIAL_ORIGIN,
				);
			} catch ( err ) {
				if ( typeof console !== 'undefined' ) {
					console.error(
						'[openstation] Window.send: postMessage failed',
						err,
					);
				}
			}
		};
		// Buffer until the iframe announces it's ready. For real
		// iframes that's `os-ready` from the chromeless
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
	 * Iframe content publishes via `wp.os.send( channel,
	 * payload )` (installed by the iframe bridge); native render
	 * code publishes via `windowApi.send( channel, payload )`. Both
	 * land here.
	 *
	 * Use the literal `'*'` to wildcard-subscribe to every channel
	 * this window publishes.
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
	 *   - Adds the `os-window__body--loading` modifier to
	 *     the body (CSS fades the content out).
	 *   - Re-attaches the overlay element if it was already torn
	 *     down by a prior `markContentLoaded` call. The spinner
	 *     only fades in past the show delay, so a quick refetch
	 *     never paints one.
	 *   - Fires the {@link HOOKS.WINDOW_CONTENT_LOADING} action +
	 *     dispatches `os-window-content-loading` on
	 *     `document` (idempotent — no re-fire when already
	 *     loading).
	 *
	 * Idempotent. Cheap to call repeatedly.
	 */
	public markContentLoading(): void {
		markWindowContentLoading( this.id );
	}

	/**
	 * Tell the shell this window's body content is ready — fades the
	 * spinner out, then fades the content in, and removes the overlay
	 * once the transition lands. The two run back to back, never
	 * together. A spinner that never painted is dropped in the same
	 * tick, so the content appears with no wait.
	 *
	 * Iframe windows mark themselves ready automatically on the
	 * `os-ready` postMessage from the chromeless bridge.
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
	 */
	public markContentLoaded(): void {
		markWindowContentReady( this.id );
	}

	/**
	 * Resolve when this window's content is ready to receive sends.
	 * Returns a Promise that resolves immediately for windows that
	 * are already ready, and otherwise waits for the next
	 * {@link HOOKS.WINDOW_CONTENT_LOADED} matching this window's id.
	 *
	 * Backstop for the iframe bridge handshake race: plugin authors
	 * coordinating with an `iframeContent: { bridge: true }` native
	 * window can `await win.whenContentReady()` before issuing the
	 * first send/connect, instead of wiring iframe.load themselves
	 * or hoping that {@link HOOKS.IFRAME_READY} has fired by their
	 * boot.
	 *
	 * Resolves regardless of whether the content path was an iframe
	 * `load`, the chromeless `os-ready` postMessage, or a
	 * native render's synchronous `markContentLoaded()` — all three
	 * end up calling {@link markWindowContentReady}.
	 *
	 * @public
	 */
	public whenContentReady(): Promise< void > {
		if ( isWindowContentReady( this.id ) ) {
			return Promise.resolve();
		}
		return new Promise< void >( ( resolve ) => {
			const expectedId = this.id;
			const onLoaded = ( e: Event ): void => {
				const detail = ( e as CustomEvent< { windowId?: string } > )
					.detail;
				if ( ! detail || detail.windowId !== expectedId ) {
					return;
				}
				document.removeEventListener(
					'os-window-content-loaded',
					onLoaded,
				);
				resolve();
			};
			document.addEventListener(
				'os-window-content-loaded',
				onLoaded,
			);
		} );
	}

	/**
	 * Set the activity indicator's phase explicitly. Most callers
	 * should prefer {@link trackActivity} (or `wp.os.fetch()`
	 * which calls it internally) — this is the escape hatch for code
	 * paths that aren't a single Promise (event-listener-driven
	 * loaders, Heartbeat polls, manual save buttons that want to
	 * pulse "Saved" without a wrapped fetch).
	 *
	 * Phases:
	 *
	 *   - `idle`    — clear. Indicator fades out.
	 *   - `pending` / `saving` — modem-blink while a request is in flight.
	 *   - `saved`   — green flash; auto-clears to `idle` after ~2.2s.
	 *   - `failed`  — red dot with `opts.error` as tooltip text;
	 *                 auto-clears after ~6s.
	 *
	 * Idempotent: setting the same phase twice is a no-op except for
	 * resetting the auto-clear timer.
	 */
	public markActivity(
		phase: 'idle' | 'pending' | 'saving' | 'saved' | 'failed',
		opts: { error?: string } = {},
	): void {
		this._activityPhase = phase;
		this._activityError = opts.error ?? null;
		this._paintActivityIndicator();
	}

	/**
	 * Drop everything in flight and return the indicator to `idle`.
	 *
	 * For the one case the reference count cannot survive: the
	 * document that started the requests is gone. An iframe that
	 * navigates mid-request takes its pending `end` messages with it,
	 * and a counter that can only go down when someone reports back
	 * would leave the ring lit for the rest of the window's life.
	 *
	 * Deliberately NOT called on a failure — a failed phase is meant
	 * to persist until the next request starts.
	 *
	 * @internal
	 */
	public _resetActivity(): void {
		if ( this._activitySettleTimer !== null ) {
			window.clearTimeout( this._activitySettleTimer );
			this._activitySettleTimer = null;
		}
		if ( this._activityClearTimer !== null ) {
			window.clearTimeout( this._activityClearTimer );
			this._activityClearTimer = null;
		}
		this._activityCount = 0;
		this._activityPhase = 'idle';
		this._activityError = null;
		this._paintActivityIndicator();
	}

	/**
	 * How long a submit has to produce a document before the ring
	 * gives up: `wp_die()` output runs no admin hooks, so nothing on
	 * it ever reports back.
	 *
	 * @internal
	 */
	public static readonly NAVIGATION_ACTIVITY_TIMEOUT_MS = 30000;

	/**
	 * Note that the iframe submitted a form — the one save the ring
	 * cannot see for itself, a submit being a navigation rather than
	 * a `fetch`. The outgoing document reports the start; the document
	 * that answers it is the end.
	 *
	 * @internal
	 */
	public _noteNavigationActivity(): void {
		this._navigationActivity = 'pending';
		if ( this._navigationActivityTimer !== null ) {
			window.clearTimeout( this._navigationActivityTimer );
		}
		this._navigationActivityTimer = window.setTimeout( () => {
			this._navigationActivityTimer = null;
			this._navigationActivity = 'none';
			this._resetActivity();
		}, Window.NAVIGATION_ACTIVITY_TIMEOUT_MS ) as unknown as number;
	}

	/**
	 * Settle a waiting submit, always as `saved` — there is no
	 * response object on this side to read a status off, and a
	 * validation failure comes back as a good 200 the user is reading.
	 *
	 * Pass `final` from the answering document's `os-ready`, which
	 * closes the book and doubles as the fallback when no head report
	 * arrived. Returns whether the ring is carrying a submit's
	 * outcome, so that caller knows not to reset it away.
	 *
	 * @internal
	 */
	public _settleNavigationActivity( final = false ): boolean {
		const carrying = this._navigationActivity !== 'none';
		if ( this._navigationActivity === 'pending' ) {
			this._navigationActivity = 'settled';
			if ( this._navigationActivityTimer !== null ) {
				window.clearTimeout( this._navigationActivityTimer );
				this._navigationActivityTimer = null;
			}
			// Straight to the outcome, with none of the minimum-blink
			// hold {@link MIN_SAVING_DISPLAY_MS} gives a fetch: that
			// floor stands in for feedback a 50ms request wouldn't
			// otherwise give, and a whole document arriving and
			// painting IS that feedback. Holding past it puts "still
			// saving" in the title bar of a page reading "Settings
			// saved."
			this._resetActivity();
			this._finalizeActivitySettle( true );
		}
		if ( final ) {
			this._navigationActivity = 'none';
		}
		return carrying;
	}

	/**
	 * Track a Promise's lifecycle on this window's activity indicator.
	 * The dot pulses while the Promise is in flight; on resolve it
	 * settles to `saved` (green flash); on reject it shows `failed`
	 * (red, error message tooltip). Returns the Promise unchanged so
	 * callers can chain.
	 *
	 * Multiple concurrent calls are reference-counted: the dot stays
	 * lit until the LAST tracked Promise settles. The terminal phase
	 * (`saved` vs `failed`) reflects the LAST settled outcome, so a
	 * burst of 5 successful fetches followed by 1 error reads
	 * "failed", which is the right signal — surface the bad news.
	 *
	 * Use `wp.os.fetch()` for HTTP requests; reach for this
	 * directly when you have a Promise from a different source
	 * (postMessage handshake, IndexedDB transaction, …).
	 */
	public trackActivity< T >( promise: Promise< T > ): Promise< T > {
		this._markActivityStart();
		return promise.then(
			( value ) => {
				this._markActivitySettled( true );
				return value;
			},
			( err ) => {
				const message = err instanceof Error ? err.message : String( err );
				this._markActivitySettled( false, message );
				throw err;
			},
		);
	}

	/**
	 * Minimum time (ms) the indicator stays in the `saving` phase
	 * after the user-visible activity has been declared. Without
	 * this, fast fetches (50–200 ms) settle before the modem-blink
	 * animation has had time to play even one full burst — the user
	 * sees the dot fill in and immediately flash green, never the
	 * blink. Holding the phase for ~1.2s guarantees the blink reads
	 * as "data flowing" before the success/failure flash.
	 *
	 * @internal
	 */
	public static readonly MIN_SAVING_DISPLAY_MS = 1200;

	/**
	 * Increment the in-flight counter and paint.
	 *
	 * @internal
	 */
	public _markActivityStart(): void {
		this._activityCount++;
		// A new fetch started while a deferred settle was pending —
		// cancel that settle (we're back in flight) so the indicator
		// doesn't briefly drop to "saved" between two rapid calls.
		if ( this._activitySettleTimer !== null ) {
			window.clearTimeout( this._activitySettleTimer );
			this._activitySettleTimer = null;
		}
		if ( this._activityCount === 1 ) {
			this._activityPhase = 'saving';
			this._activityError = null;
			this._activitySavingStartedAt = Date.now();
			this._paintActivityIndicator();
		}
	}

	/**
	 * Decrement the in-flight counter and, when it hits zero,
	 * transition to `saved` or `failed`. Schedules an auto-clear
	 * back to `idle`.
	 *
	 * Honours `MIN_SAVING_DISPLAY_MS` — when a fetch settles before
	 * the minimum has elapsed, the transition is deferred so the
	 * modem-blink animation has time to register visually. Concurrent
	 * activity that re-starts during the deferral cancels it.
	 *
	 * @internal
	 */
	public _markActivitySettled( ok: boolean, error?: string ): void {
		if ( this._activityCount > 0 ) {
			this._activityCount--;
		}
		if ( this._activityCount > 0 ) {
			// Still in flight — don't transition the phase yet, but
			// remember the most recent error so it surfaces when the
			// last in-flight settles.
			if ( ! ok && error ) {
				this._activityError = error;
			}
			return;
		}

		// Optionally defer the settle to give the modem-blink time
		// to play. Calculated from the wall-clock start of the
		// saving phase, not from this call, so concurrent fetches
		// that land at different times still respect the floor.
		const elapsed = Date.now() - this._activitySavingStartedAt;
		const remaining = Window.MIN_SAVING_DISPLAY_MS - elapsed;
		if ( remaining > 0 ) {
			if ( this._activitySettleTimer !== null ) {
				window.clearTimeout( this._activitySettleTimer );
			}
			this._activitySettleTimer = window.setTimeout( () => {
				this._activitySettleTimer = null;
				this._finalizeActivitySettle( ok, error );
			}, remaining ) as unknown as number;
			return;
		}

		this._finalizeActivitySettle( ok, error );
	}

	/**
	 * Apply the terminal `saved` / `failed` phase and schedule the
	 * fade back to `idle`. Split out of `_markActivitySettled` so
	 * the deferred-settle path and the immediate path share one
	 * implementation.
	 *
	 * @internal
	 */
	private _finalizeActivitySettle( ok: boolean, error?: string ): void {
		this._activityPhase = ok && ! this._activityError ? 'saved' : 'failed';
		if ( ! ok && error ) {
			this._activityError = error;
		}
		this._paintActivityIndicator();

		if ( this._activityClearTimer !== null ) {
			window.clearTimeout( this._activityClearTimer );
			this._activityClearTimer = null;
		}

		// `saved`  — fade back to idle after a brief hold.
		// `failed` — stay visible. The dot persists in the failed
		//            state until the next `_markActivityStart()` call
		//            (i.e. a successful retry) clears it. Auto-clearing
		//            on a timer would hide the only signal that
		//            something went wrong, even when the user hasn't
		//            done anything to address it yet.
		if ( this._activityPhase === 'saved' ) {
			this._activityClearTimer = window.setTimeout( () => {
				this._activityClearTimer = null;
				this._activityPhase = 'idle';
				this._activityError = null;
				this._paintActivityIndicator();
			}, 2200 ) as unknown as number;
		}
	}

	/**
	 * Push the current activity state onto the title bar.
	 *
	 * Three consumers, in order of how most windows use them:
	 *
	 *   1. Every `[data-os-activity-indicator]` element in the title
	 *      bar. The framework's own status ring is one of these — it
	 *      claims no private channel, so a plugin mounting an
	 *      `<os-save-status>` in a title-bar slot is driven by exactly
	 *      the same code path.
	 *   2. A visually-hidden `role="status"` region — a ring announces
	 *      nothing, and "did my change save?" is exactly the question a
	 *      screen-reader user cannot answer by looking. Failures go out
	 *      assertively and carry the error text; everything else is
	 *      polite.
	 *   3. `data-os-activity` on the title-bar element, mirroring the
	 *      phase for CSS. Absent while idle, so a desktop theme can
	 *      react to window state without reaching into the component's
	 *      shadow root, and an idle window matches nothing.
	 *
	 * @internal
	 */
	public _paintActivityIndicator(): void {
		if ( this._isDestroyed ) {
			return;
		}
		const phase = this._activityPhase;

		if ( 'idle' === phase ) {
			this._titleBar.removeAttribute( 'data-os-activity' );
		} else {
			this._titleBar.setAttribute( 'data-os-activity', phase );
		}

		const live = this._titleBar.querySelector< HTMLElement >(
			'.os-window__activity-status',
		);
		if ( live ) {
			const failed = 'failed' === phase;
			live.setAttribute( 'role', failed ? 'alert' : 'status' );
			live.setAttribute( 'aria-live', failed ? 'assertive' : 'polite' );
			live.textContent = this._activityStatusText();
		}

		// All of them, not the first — the framework's ring and a
		// plugin's own indicator have to agree, and a window that
		// showed two different phases at once would be worse than one
		// that showed none.
		const indicators = this._titleBar.querySelectorAll< HTMLElement >(
			'[data-os-activity-indicator]',
		);
		indicators.forEach( ( indicator ) => {
			indicator.setAttribute( 'phase', phase );
			if ( this._activityError ) {
				indicator.setAttribute( 'error', this._activityError );
			} else {
				indicator.removeAttribute( 'error' );
			}
		} );
	}

	/**
	 * Announcement text for the current phase. Empty while idle —
	 * a live region that keeps saying "nothing is happening" is worse
	 * than one that stays quiet.
	 *
	 * `saving` is deliberately NOT announced on its own: the phase is
	 * held for at least {@link MIN_SAVING_DISPLAY_MS} and every save
	 * would interrupt whatever the user was reading to tell them
	 * something they already know they started. The outcome is the
	 * part they can't see.
	 *
	 * @internal
	 */
	private _activityStatusText(): string {
		switch ( this._activityPhase ) {
			case 'saved':
				return __( 'Saved' );
			case 'failed':
				if ( ! this._activityError ) {
					return __( 'Not saved.' );
				}
				/* translators: %s: error message explaining why the change could not be saved. */
				return sprintf( __( 'Not saved. %s' ), this._activityError );
			default:
				return '';
		}
	}

	/**
	 * Request a visual "attention" signal on this window's tile in
	 * the dock or taskbar — pulse, shake, or bounce. Used by plugins
	 * that need to grab the user's eye when the window is closed or
	 * unfocused (incoming chat message, long task finished, etc.).
	 *
	 * Resolution order:
	 *   1. If a tile exists for this window's id on either rail
	 *      (`wp.os.dock` or `wp.os.taskbar`), call
	 *      `Dock.setAttention( id, mode, opts )`.
	 *   2. Otherwise (e.g. `placement: 'none'`) fall back to
	 *      `setHighlight('persistent')` on the window itself, auto-
	 *      cleared after `opts.durationMs`. No-op if the window has
	 *      no rendered chrome.
	 *
	 * The mode + opts pass through the `os.window.attention`
	 * filter first so plugins (or a Do-Not-Disturb preference) can
	 * mute (`return null`) or modify the request.
	 *
	 * Animations are gated on `prefers-reduced-motion`; reduced-motion
	 * users see a static accent ring for the same duration so the
	 * affordance still works.
	 */
	public requestAttention(
		mode: 'pulse' | 'shake' | 'bounce' | null,
		opts: WindowAttentionOptions = {},
	): void {
		// Primary policy hook: plugins filter
		// `os/window-attention-requested` to cancel
		// (`cancel: true`) for DND modes / reduced-motion, scale
		// `durationMs`/`intensity`, or audit. The pre-0.5.5
		// `os.window.attention` filter still runs below
		// for back-compat.
		const intent = activity.filter(
			'os/window-attention-requested',
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
			'os.window.attention',
			intentMode,
			{ windowId: this.id, opts: intentOpts },
		);

		// Resolve the docks via the public API so a plugin shell
		// implementation that swaps Dock instances at runtime still
		// gets the latest reference.
		const wp = ( window as unknown as {
			wp?: { os?: { dock?: unknown; taskbar?: unknown } };
		} ).wp;
		type SetAttentionFn = (
			id: string,
			m: WindowAttentionMode,
			o: WindowAttentionOptions,
		) => void;
		const dockApi = wp?.os?.dock as
			| { setAttention?: SetAttentionFn }
			| null
			| undefined;
		const taskbarApi = wp?.os?.taskbar as
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
	 * the JS filter `os.window.shake` and return falsy to mute.
	 */
	public shake(): void {
		const filtered = applyFilters< boolean, [ { windowId: string } ] >(
			'os.window.shake',
			true,
			{ windowId: this.id },
		);
		if ( filtered === false ) {
			return;
		}
		const el = this.element;
		el.classList.remove( 'os-window--shaking' );
		// Force reflow so removing then re-adding the class re-triggers
		// the animation. Reading `offsetWidth` is the canonical hack.
		void el.offsetWidth;
		el.classList.add( 'os-window--shaking' );
		const onEnd = (): void => {
			el.classList.remove( 'os-window--shaking' );
			el.removeEventListener( 'animationend', onEnd );
		};
		el.addEventListener( 'animationend', onEnd );
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
	 */
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
		// `_suppressCloseFilter` is set by `destroy()` so a force-
		// teardown caller (tests, plugin deactivation) bypasses the
		// veto.
		if ( this.config.native && ! this._suppressCloseFilter ) {
			const proceed = applyFilters< boolean, [ { windowId: string; config: WindowConfig } ] >(
				HOOKS.NATIVE_WINDOW_BEFORE_CLOSE,
				true,
				{ windowId: this.id, config: this.config },
			);
			if ( proceed === false ) {
				return;
			}
		} else if ( ! this.config.native && ! this._suppressCloseFilter && this._iframeBridgeReady && this.iframe ) {
			if ( this._closePending ) {
				// A query is already in flight — e.g. the user double-
				// clicked the close button before the iframe answered.
				// Falling through to destroy here would bypass the
				// unsaved-changes check this whole branch exists for.
				// Let the in-flight query's response (or its safety
				// timeout below) drive the close instead.
				return;
			}
			this._closePending = true;
			try {
				this.iframe.contentWindow?.postMessage(
					{ type: 'os-bridge-beforeunload-query' },
					location.origin,
				);

				this._iframeCloseTimeout = setTimeout( () => {
					if ( this._isDestroyed ) {
						return;
					}
					this._suppressCloseFilter = true;
					this._closePending = false;
					this.close();
				}, 500 );
				return;
			} catch {
				this._closePending = false;
			}
		}

		this._isDestroyed = true;

		// Drop any in-flight swap buffer — its load handler would be a
		// no-op post-destroy, but the abandon timer shouldn't linger.
		this._discardSwapBuffer();

		// Cancel any pending activity timers so a still-pending
		// settle / clear doesn't fire after the window has gone away.
		if ( this._activityClearTimer !== null ) {
			window.clearTimeout( this._activityClearTimer );
			this._activityClearTimer = null;
		}
		if ( this._activitySettleTimer !== null ) {
			window.clearTimeout( this._activitySettleTimer );
			this._activitySettleTimer = null;
		}
		if ( this._navigationActivityTimer !== null ) {
			window.clearTimeout( this._navigationActivityTimer );
			this._navigationActivityTimer = null;
		}

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

		// Abort the framework-built ctx pre-animation so
		// `ctx.signal` flips to aborted IMMEDIATELY (in-flight
		// `wp.os.fetch( …, { signal } )` requests cancel right
		// away rather than after the fade-out) and the
		// `onResize`/`onHide`/`onShow` listeners detach before we
		// stop firing. The user's render-returned teardown still
		// runs in `onDone()` below — by which point the ctx is
		// already quiescent.
		if ( this._nativeRenderCtxDispose ) {
			try {
				this._nativeRenderCtxDispose();
			} catch ( err ) {
				doAction( HOOKS.SHELL_ERROR, {
					scope: 'native-window-ctx-dispose',
					id: this.id,
					error: err,
				} );
			}
			this._nativeRenderCtxDispose = null;
		}

		// Tear down the body resize observer now rather than on
		// element.remove() — subscribers shouldn't see a phantom
		// `body-resized` fire as the window animates out.
		this._bodyResizeObserver?.disconnect();
		this._bodyResizeObserver = null;

		// Same rationale for the tab strip's overflow watcher: its
		// observers would otherwise keep measuring a strip that is
		// animating out of the document.
		if ( this._tabSpeculateTimer ) {
			window.clearTimeout( this._tabSpeculateTimer );
			this._tabSpeculateTimer = null;
		}
		this._tabOverflowTeardown?.();
		this._tabOverflowTeardown = null;

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

		this.element.classList.add( 'os-window--closing' );

		// Wire the normal "animation finished" path. Captured on the
		// instance so `_finalizeClose()` can detach the listener
		// regardless of which path triggered finalisation
		// (transitionend, the safety-net timer, or an explicit
		// `destroy()` call).
		this._onCloseTransitionEnd = ( e: TransitionEvent ): void => {
			if ( e.propertyName === 'opacity' ) {
				this._finalizeClose();
			}
		};
		this.element.addEventListener( 'transitionend', this._onCloseTransitionEnd );

		// Safety net: if transitionend never fires (reduced-motion,
		// no transition declared, or a CSS race), finalise after a
		// generous timeout so the element doesn't linger. Captured
		// so the normal path AND `destroy()` can cancel it.
		this._closeSafetyNetTimer = setTimeout( () => this._finalizeClose(), 300 );
	}

	/**
	 * Synchronously tear down a window with no animation. Use in:
	 *
	 *  - Test `afterEach` hooks where the suite needs deterministic
	 *    cleanup before the environment unwinds.
	 *  - Plugin deactivation flows where the tile is going away
	 *    immediately and a fade-out would feel wrong.
	 *  - Forced shutdowns that must bypass the
	 *    `NATIVE_WINDOW_BEFORE_CLOSE` veto filter (e.g. the user
	 *    closed a parent that owns this window).
	 *
	 * Idempotent: a second `destroy()` call is a no-op once the
	 * window has finalised. If `close()` had already started the
	 * animation, `destroy()` cancels the pending timer and runs
	 * finalise immediately.
	 *
	 * @public
	 */
	public destroy(): void {
		if ( this._isFinalized ) {
			return;
		}
		// If close() hasn't started yet, run its pre-animation work
		// FIRST (subscription teardowns, hooks, observers, etc.) by
		// calling close() — but bypass the cancel filter so destroy
		// is genuinely "force teardown".
		if ( ! this._isDestroyed ) {
			this._suppressCloseFilter = true;
			try {
				this.close();
			} finally {
				this._suppressCloseFilter = false;
			}
		}
		// Animation may have been scheduled — finalise now instead
		// of waiting for transitionend / the safety-net timer.
		this._finalizeClose();
	}

	/**
	 * Set by `destroy()` to skip the `NATIVE_WINDOW_BEFORE_CLOSE`
	 * veto filter when re-entering through `close()`. The filter
	 * is the user's "are you sure?" hook; a force-teardown caller
	 * (test cleanup, plugin deactivation) explicitly opts out.
	 *
	 * @internal
	 */
	private _suppressCloseFilter: boolean = false;

	/**
	 * Run the post-animation teardown — the work that used to live
	 * in `close()`'s inner `onDone` closure. Idempotent via
	 * `_isFinalized`. Cancels the safety-net timer + the
	 * `transitionend` listener it might have been racing.
	 *
	 * @internal
	 */
	private _finalizeClose(): void {
		if ( this._isFinalized ) {
			return;
		}
		this._isFinalized = true;

		if ( this._closeSafetyNetTimer !== null ) {
			clearTimeout( this._closeSafetyNetTimer );
			this._closeSafetyNetTimer = null;
		}
		// The pre-close bridge query's safety net. Its callback is a
		// no-op post-destroy (`_isDestroyed` guard), but an armed timer
		// still outlives the window — and a window closed within its
		// 500ms is the common case, not the rare one.
		if ( this._iframeCloseTimeout !== null ) {
			clearTimeout( this._iframeCloseTimeout );
			this._iframeCloseTimeout = null;
		}
		// Cancel the open animation's fallback deadline. Windows that
		// open and close inside 300ms (test harnesses, plugin
		// deactivation flows) would otherwise leave it running against
		// a torn-down document.
		if ( this._clearOpeningClassRemoval ) {
			this._clearOpeningClassRemoval();
		}
		if ( this._onCloseTransitionEnd ) {
			this.element.removeEventListener(
				'transitionend',
				this._onCloseTransitionEnd,
			);
			this._onCloseTransitionEnd = null;
		}

		// Visible-DOM teardowns deferred from `close()`'s pre-animation
		// block — run them here, after the closing animation has faded
		// the window to opacity 0, so a custom chrome unmounting (or a
		// plugin slot / control / native body teardown) can't flash the
		// default chrome through the live pixels mid-fade. The window
		// leaves the DOM in the next step regardless; whatever the
		// children look like during these calls is invisible.
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
		// Theme CSS-variable wipe — deferred so the themed appearance
		// survives the entire fade-out. The element is about to leave
		// the DOM regardless; the wipe is purely belt-and-braces
		// against retained references.
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
		// The ⋯ menu's repaint subscription is normally dropped by
		// `closeActionsMenu()`, and a click-driven close always gets
		// there first because the pointerdown capture above closes the
		// menu. A programmatic `close()` with the menu open does not —
		// leaving a live registry listener holding this window and the
		// detached panel it would try to repaint.
		this._unsubscribeWindowActions?.();
		this._unsubscribeWindowActions = null;
		this.element.remove();
		// If this was the last fullscreen window, drop the body
		// class so the admin bar and shell top-offset come back
		// cleanly.
		updateFullscreenBodyClass();
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
			'.os-window__body',
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
