/**
 * OpenStation — Window Manager.
 *
 * Manages the lifecycle, z-order, and focus of all desktop windows,
 * plus the virtual-desktop registry ("Spaces"). Most heavy logic lives
 * in sibling modules under `src/window-manager/`:
 *
 *   - `desktops.ts`  — create / switch / close virtual desktops,
 *                      visibility sync, seed from persistence.
 *   - `arrange.ts`   — cascade + tile commands from the Arrange menu.
 *   - `snap.ts`      — snap-to-grid preference + live cell-size calc.
 *   - `overview.ts`  — the zoom-out grid + top-bar + click / key /
 *                      hover handlers.
 *   - `geometry.ts`  — pure math helpers (grid picker, layout calc,
 *                      validators).
 *
 * Fields prefixed with `_` are package-internal: helpers in this
 * folder may touch them, but nothing outside `src/window-manager/`
 * should. Kept `public` at the TypeScript level only because `private`
 * prevents sibling modules from seeing them.
 */

import { HOOKS, doAction, applyFilters } from '../hooks';
import type {
	Desktop,
	Session,
	SessionWindow,
	VisibleWindowRect,
	WindowConfig,
	WindowState,
} from '../types';
import type { Window } from '../window';
import { urlReuseKey } from '../utils';
import {
	ensureWindowSystemLoaded,
	windowSystemBundleUrl,
} from '../window-system/loader';
import {
	ensureShellOverlaysLoaded,
	shellOverlaysBundleUrl,
} from '../shell-overlays/loader';

import {
	applyDesktopVisibility,
	createDesktop,
	closeDesktop,
	getActiveDesktop,
	getActiveDesktopId,
	getDesktops,
	renameDesktop,
	seedDesktops,
	switchDesktop,
	type SwitchDesktopOptions,
} from './desktops';
// `focus` is already a method on the manager (raise a window), so the
// arrangement is imported under a name that says which one it is.
import { cascade, columns, focus as focusLayout, tile } from './arrange';
import {
	getSnapConfig,
	loadSnapEnabled,
	setSnapEnabled,
} from './snap';
import {
	abortSnapIfPending,
	commitSnapIfPending,
	updateSnapZoneForDrag,
} from './snap-zones';
import { destroyDesktopNameHud } from './desktop-name-hud';
import { cancelOverviewTimers, enterOverview, exitOverview } from './overview';
import { loadNativeWindowGeometry } from './native-window-geometry';
import { clampWindowPosition } from '../window/pointer';
import { workAreaRectOf, type WorkAreaRect } from '../work-area';

/** Base z-index for desktop windows. */
const BASE_Z_INDEX = 100;

/** Cascade offset for new windows (pixels). */
const CASCADE_OFFSET = 30;

/**
 * Geometry resolved by `WindowManager.createWindow()` and passed
 * through {@link HOOKS.WINDOW_GEOMETRY}. Returned (possibly mutated)
 * by the filter and then re-clamped to `minWidth`/`minHeight` before
 * being baked into the `WindowConfig`.
 *
 * @public
 */
export interface ResolvedWindowGeometry {
	x: number;
	y: number;
	width: number;
	height: number;
	/**
	 * Initial window state. Typically `undefined` (a normal floating
	 * window) or `'maximized'` (when the saved geometry or caller
	 * asked for it). A filter may return any {@link WindowState}
	 * value to force a particular start state — e.g.
	 * `'snapped-left'` for a side-companion plugin.
	 */
	state?: WindowState;
}

/**
 * Context object the {@link HOOKS.WINDOW_GEOMETRY} filter receives
 * alongside the resolved geometry. `windowId` is the unique
 * per-instance id; `baseId` is the registry id (multiple windows
 * sharing one baseId in the multi-window case). `desktopRect`
 * carries the live desktop area dimensions; `workArea` is the part
 * of it no shell chrome floats over (see `wp.os.workArea`), in
 * desktop-area-local coordinates — the rectangle to compute a
 * "bottom-right corner" against so the window lands above the dock.
 *
 * The two booleans capture the only useful distinctions a filter
 * actually cares about:
 *
 *   - `hasSavedGeometry`: the user previously dragged/resized this
 *     window and we just restored that layout. Plugins that want to
 *     "leave the user's layout alone" should bail when this is true.
 *   - `callerPinned`: the caller of `manager.open()` passed at least
 *     one of `{ x, y, width, height, initialState }` explicitly. For
 *     native windows registered via `openstation_register_window()`
 *     this is usually `true` (the framework's native-window opener
 *     passes the registry's declared dimensions); for admin-page
 *     iframe windows opened from the dock this is usually `false`.
 *     The filter is free to override registry-declared defaults —
 *     `callerPinned: true` does not mean "leave it alone."
 *
 * @public
 */
export interface WindowGeometryContext {
	windowId: string;
	baseId: string;
	hasSavedGeometry: boolean;
	callerPinned: boolean;
	desktopRect: {
		width: number;
		height: number;
	};
	workArea: WorkAreaRect;
}

/**
 * Window Manager class.
 *
 * Controls the window stack: opening, closing, focusing, z-ordering.
 */
export class WindowManager {
	/**
	 * All open windows, in z-order (last = topmost).
	 * @internal
	 */
	public _stack: Window[] = [];

	/**
	 * Child windows that a `cascadeMinimize` put away, so restoring
	 * the owner brings back exactly those and leaves alone the ones
	 * the user had minimized themselves.
	 *
	 * A `WeakSet` because membership must not keep a closed window
	 * alive — a child that closes while minimized is never restored,
	 * so nothing would ever remove it from a strong collection.
	 */
	private _cascadeMinimized: WeakSet< Window > = new WeakSet();

	/**
	 * Re-entrancy depth of an ownership cascade (minimize / restore /
	 * close of a window that owns children).
	 *
	 * A cascade is one user action, and it should emit one focus
	 * change. Without this, each child's own `minimize()` re-enters
	 * `onMinimize` and settles focus on an intermediate window before
	 * the cascade finishes, so minimizing an owner with three children
	 * fired four `WINDOW_FOCUSED` / `WINDOW_BLURRED` pairs. The end
	 * state was right, but anything building an activity feed or
	 * analytics off those actions saw transitions the user never made.
	 *
	 * Non-zero means "an outer cascade is still running and will settle
	 * focus when it is done" — intermediate focus work is skipped.
	 * Incremented and decremented in `finally` so a throwing child
	 * cannot wedge the desktop in a state where clicks stop focusing.
	 */
	private _cascadeDepth = 0;

	/**
	 * The desktop area element where windows are rendered.
	 * @internal
	 */
	public _desktop: HTMLElement;

	/** Counter for cascade positioning. */
	private cascadeIndex = 0;

	/**
	 * Config staged by {@link seedWindowRestoreState}, keyed by window
	 * id and consumed by the first `createWindow` that claims each id.
	 * Empty outside of session restore.
	 */
	private _pendingRestoreState = new Map< string, Partial< WindowConfig > >();

	/**
	 * The one prewarmed (hidden, speculative) window, if any — built by
	 * {@link prewarm} ahead of an anticipated open so the iframe's
	 * document TTFB and parse are already paid when the user clicks.
	 *
	 * Deliberately NOT in {@link _stack}: session snapshots, the
	 * taskbar, dock peek, Alt-Tab and every other consumer walk the
	 * stack, so a window that was never announced as opened stays
	 * invisible to all of them for free. Adoption (in {@link open})
	 * pushes it into the stack and fires `os-window-opened`, at which
	 * point every event-driven consumer catches up exactly as for a
	 * regular open. Single slot on purpose — each speculative iframe
	 * is a full admin page (tens of MB of renderer memory), so the
	 * newest prediction always evicts the previous one.
	 */
	private _prewarmed: { baseId: string; win: Window; timer: number } | null =
		null;

	/** Re-entrancy guard for {@link prewarm} (async construction). */
	private _prewarmInFlight = false;

	/**
	 * Virtual desktops ("Spaces"). Always at least one entry — the
	 * shell can't function with no desktops. Order in the array maps
	 * to left-to-right order in the overview top bar; new desktops
	 * are appended.
	 * @internal
	 */
	public _desktops: Desktop[] = [
		// translators: default desktop name — "Desktop 1"
		{ id: 'desktop-1', label: 'Desktop 1' },
	];

	/**
	 * Id of the currently active desktop.
	 * @internal
	 */
	public _activeDesktopId = 'desktop-1';

	/**
	 * Monotonic counter for new desktop ids (`desktop-2`, `-3`, …).
	 * @internal
	 */
	public _desktopSeq = 1;

	/**
	 * Injected by the shell on init — called when a user clicks
	 * "Open on startup" in a window's ⋯ menu. The manager stays
	 * decoupled from the public `wp.os.setDefaultWindow()` API
	 * by taking the handler as a callback.
	 */
	public onToggleStartupRequested: ( ( win: Window ) => void ) | null = null;

	/**
	 * Observes the desktop area for size changes so maximized windows
	 * can stay snapped to the available area.
	 */
	private desktopResizeObserver: ResizeObserver | null = null;

	/**
	 * Debounce timer that clears `--reflowing` from stateful windows
	 * once the user stops resizing the viewport. Null when no resize
	 * is in flight.
	 *
	 * @internal
	 */
	private _reflowRestoreTimer: number | null = null;

	/**
	 * Whether drag/resize movements snap to the desktop-area grid.
	 * @internal
	 */
	public _snapEnabled = loadSnapEnabled();

	// ---- Overview state (read + written by overview.ts, desktops.ts) ----

	/** True while overview mode is active. @internal */
	public _overviewActive = false;

	/**
	 * Snapshot of each window's transform before overview mode so
	 * `exitOverview` can restore pixel-identical state.
	 * @internal
	 */
	public _overviewSnapshot: Map<
		string,
		{ transform: string; transition: string }
	> = new Map();

	/**
	 * Per-window label elements mounted during overview.
	 * @internal
	 */
	public _overviewLabels: Map<string, HTMLElement> = new Map();

	/** @internal */
	public _overviewPointerDownHandler: ( ( e: PointerEvent ) => void ) | null = null;
	/** @internal */
	public _overviewPointerUpHandler: ( ( e: PointerEvent ) => void ) | null = null;
	/** @internal */
	public _overviewKeyHandler: ( ( e: KeyboardEvent ) => void ) | null = null;
	/** @internal */
	public _overviewPressTarget: { id: string; element: HTMLElement } | null = null;
	/** @internal */
	public _overviewClickBlocker: ( ( e: MouseEvent ) => void ) | null = null;
	/** @internal */
	public _overviewTopBar: HTMLElement | null = null;
	/** @internal */
	public _overviewMouseHandler: ( ( e: MouseEvent ) => void ) | null = null;
	/** @internal */
	public _lastOverviewHoverId: string | null = null;
	/**
	 * Tracks whether the keyboard cursor in overview is currently
	 * parked on the trailing "+" tile (rather than a real desktop).
	 * Lets arrow navigation include the add affordance in its cycle —
	 * Enter while this is `true` creates a new desktop. Reset to
	 * `false` on overview exit.
	 *
	 * @internal
	 */
	public _overviewAddTileFocused = false;
	/**
	 * Handle of the pending "grid animation settled" timer scheduled
	 * by `enterOverview()`. Tracked so `destroy()` can cancel it —
	 * otherwise a caller that discards the manager mid-transition
	 * leaves a real `setTimeout` that fires later and reaches for
	 * globals (`window.wp.hooks`) that may already be torn down.
	 * @internal
	 */
	public _overviewEnterTimeoutId: number | null = null;
	/**
	 * Handle of the pending "exit animation settled" timer scheduled
	 * by `exitOverview()`. Same rationale as
	 * {@link _overviewEnterTimeoutId}.
	 * @internal
	 */
	public _overviewExitTimeoutId: number | null = null;
	/**
	 * Cleanup for the exit animation scheduled by `exitOverview()`,
	 * held so it can be run AHEAD of its timer rather than only by it.
	 * Re-entering overview inside the 280 ms exit window has to settle
	 * the outgoing session first — otherwise the stale timer fires
	 * mid-session and undoes the new one's setup (stripping
	 * `os-window--overview`, re-applying a suspended fullscreen class,
	 * removing the freshly-built top bar).
	 * @internal
	 */
	public _overviewExitFinalizer: ( () => void ) | null = null;

	// ---- Snap-zone state (edge-snap + split overview) ----

	/**
	 * Zone the cursor is currently hovering inside during a drag.
	 * Null when no snap is armed.
	 * @internal
	 */
	public _snapPendingZone: 'left' | 'right' | null = null;

	/**
	 * The translucent preview rectangle shown while a snap is armed.
	 * Lives inside `.os-area`.
	 * @internal
	 */
	public _snapPreviewEl: HTMLElement | null = null;

	/**
	 * True while the split overview (partner picker) is up. Blocks
	 * snap-zone detection on subsequent drags.
	 * @internal
	 */
	public _splitOverviewActive = false;

	/** @internal */
	public _splitOverviewAnchor: Window | null = null;
	/** @internal */
	public _splitOverviewZone: 'left' | 'right' | null = null;
	/** @internal */
	public _splitOverviewSnapshot: Map< string, { transform: string; transition: string } > = new Map();
	/** @internal */
	public _splitOverviewLabels: Map< string, HTMLElement > = new Map();
	/** @internal */
	public _splitOverviewPointerDown: ( ( e: PointerEvent ) => void ) | null = null;
	/** @internal */
	public _splitOverviewPointerUp: ( ( e: PointerEvent ) => void ) | null = null;
	/** @internal */
	public _splitOverviewPressTarget: { id: string; element: HTMLElement } | null = null;
	/** @internal */
	public _splitOverviewClickBlocker: ( ( e: MouseEvent ) => void ) | null = null;
	/** @internal */
	public _splitOverviewKey: ( ( e: KeyboardEvent ) => void ) | null = null;

	constructor( desktop: HTMLElement ) {
		this._desktop = desktop;
		if ( typeof ResizeObserver !== 'undefined' ) {
			this.desktopResizeObserver = new ResizeObserver( () =>
				this.reflowStatefulWindows(),
			);
			this.desktopResizeObserver.observe( desktop );
		}
		this.installIframeFocusBridge();
	}

	/**
	 * Clicks inside an iframe don't cross the browsing-context
	 * boundary — pointerdown / focusin in the iframe's document never
	 * reach the parent. BUT the parent `window` does lose focus,
	 * because focus moves to the iframe's content window.
	 *
	 * We use that signal: listen for `window.blur` on the parent,
	 * check `document.activeElement` — if it's an iframe, walk up to
	 * its owning `.os-window`, find the matching Window in
	 * our stack, and focus it. Covers clicks on the primary iframe
	 * AND any external-tab sub-iframes mounted as descendants of the
	 * window element.
	 */
	private installIframeFocusBridge(): void {
		window.addEventListener( 'blur', () => {
			// The blur happens BEFORE `document.activeElement` is
			// fully updated in some engines. A 0-ms defer lines us up
			// with the activeElement state after the browser has
			// committed the focus shift.
			window.setTimeout( () => {
				const active = this._desktop.ownerDocument?.activeElement ?? null;
				if ( ! active || active.tagName !== 'IFRAME' ) {
					return;
				}
				const winEl = active.closest<HTMLElement>(
					'.os-window',
				);
				if ( ! winEl ) {
					return;
				}
				const id = winEl.id.replace( /^wp-window-/, '' );
				const win = this.getById( id );
				if ( ! win ) {
					return;
				}
				// Skip while overview is active — pointer events are
				// driven by the dedicated overview capture handler
				// there.
				if ( this._overviewActive ) {
					return;
				}
				// Already focused? The focus() call reorders the stack
				// as a no-op but still fires the action hook — skip.
				if ( this.getFocused() === win ) {
					return;
				}
				this.focus( win );
			}, 0 );
		} );
	}

	/**
	 * Re-apply state-driven bounds to any window whose geometry is
	 * derived from the desktop area's dimensions: maximized (full
	 * area) and snapped-left / snapped-right (half area). Also
	 * clamps normal (floating) windows to the GRAB_MARGIN boundaries
	 * so they are not stranded off-screen when the viewport shrinks.
	 *
	 * Called from the desktop-area ResizeObserver so shrinking the
	 * browser window drags the windows along with it.
	 *
	 * Inlines the geometry writes instead of calling `applySnap` —
	 * that method emits `_emitChange('state')` which would spam the
	 * session saver on every resize tick. Viewport resize is an
	 * INCOMING shape change (the shell reshaped us), not an outgoing
	 * user action worth persisting.
	 *
	 * Also toggles `os-window--reflowing` so the base
	 * left/top/width/height transition doesn't interpolate between
	 * every ResizeObserver tick — without that, the windows would
	 * always lag ~250 ms behind a browser edge-drag.
	 *
	 * Skipped while overview is active — windows are mid-transform
	 * and touching their inline geometry would desync the live
	 * transform math; overview exit re-applies state correctly via
	 * its own path.
	 */
	private reflowStatefulWindows(): void {
		if ( this._overviewActive ) {
			return;
		}
		for ( const w of this._stack ) {
			const parent = w.element.parentElement;
			if ( ! parent ) {
				continue;
			}
			// Same rectangle `Window` sizes against on maximize / snap:
			// the whole desktop area. Stateful windows and a dragged
			// window may sit under the dock by the user's choice; only
			// default placement keeps clear of it.
			const area = {
				x: 0,
				y: 0,
				width: parent.clientWidth,
				height: parent.clientHeight,
			};
			if ( w.state === 'maximized' ) {
				w.element.classList.add( 'os-window--reflowing' );
				w.element.style.left = `${ area.x }px`;
				w.element.style.top = `${ area.y }px`;
				w.element.style.width = `${ area.width }px`;
				w.element.style.height = `${ area.height }px`;
			} else if (
				w.state === 'snapped-left' ||
				w.state === 'snapped-right'
			) {
				w.element.classList.add( 'os-window--reflowing' );
				const halfW = Math.floor( area.width / 2 );
				const height = area.height;
				const left =
					w.state === 'snapped-left'
						? area.x
						: area.x + area.width - halfW;
				w.element.style.left = `${ left }px`;
				w.element.style.top = `${ area.y }px`;
				w.element.style.width = `${ halfW }px`;
				w.element.style.height = `${ height }px`;
			} else if ( w.state === 'normal' ) {
				const currentX = parseInt( w.element.style.left, 10 ) || 0;
				const currentY = parseInt( w.element.style.top, 10 ) || 0;
				const width = w.element.offsetWidth || 0;

				const safe = clampWindowPosition( currentX, currentY, width, area );

				if ( currentX !== safe.x || currentY !== safe.y ) {
					w.element.classList.add( 'os-window--reflowing' );
					w.element.style.left = `${ safe.x }px`;
					w.element.style.top = `${ safe.y }px`;
				}
			}
		}

		// Schedule the transition re-enable for after the browser
		// has stopped firing resize events. Cleared + re-set on
		// every tick so a sustained resize drag keeps transitions
		// off until the user lets go.
		if ( this._reflowRestoreTimer !== null ) {
			window.clearTimeout( this._reflowRestoreTimer );
		}
		this._reflowRestoreTimer = window.setTimeout( () => {
			this._reflowRestoreTimer = null;
			for ( const w of this._stack ) {
				w.element.classList.remove( 'os-window--reflowing' );
			}
		}, 140 ) as unknown as number;
	}

	/**
	 * Open a new window — or focus an existing one — for the given
	 * page.
	 *
	 * Matches any existing window sharing the same `baseId`
	 * (defaulting to the config's `id`). For singleton pages
	 * (Settings, Dashboard, …) `baseId === id`, so this behaves
	 * exactly like strict id matching. For multi pages, clicking the
	 * dock icon while a window is already open focuses the
	 * most-recent instance rather than creating a twin.
	 *
	 * URL-aware reuse: when the matched window is NOT already showing
	 * the requested URL (and the request isn't for the window's home
	 * / dock landing URL), the existing iframe navigates to it in
	 * place — an action URL like
	 * `plugins.php?action=activate&…&_wpnonce=…` actually runs
	 * instead of being dropped by a bare focus. The
	 * `os-window-reopened` event reports which path was
	 * taken via its `navigated` flag.
	 *
	 * To force a brand-new instance alongside an existing one, use
	 * {@link openNew}.
	 */
	public async open(
		config: Partial<WindowConfig> & { id: string; url: string; title: string },
	): Promise< Window > {
		// Defensive boundary check — a previously-loose contract
		// silently produced a hung iframe when callers passed a URL
		// string instead of a config object (`url: undefined`,
		// loading spinner forever). Throw at the boundary so plugin
		// authors see the bug at the call site instead of debugging
		// a stuck window.
		if ( ! config || typeof config !== 'object' ) {
			throw new TypeError(
				'windowManager.open() requires a config object with at least { id, url, title }; received ' +
					( config === null ? 'null' : typeof config ),
			);
		}
		if ( typeof config.id !== 'string' || config.id === '' ) {
			throw new TypeError(
				'windowManager.open(): config.id must be a non-empty string.',
			);
		}
		if ( typeof config.url !== 'string' || config.url === '' ) {
			throw new TypeError(
				'windowManager.open(): config.url must be a non-empty string. Pass an admin URL (e.g. "/wp-admin/edit.php") or a hash fragment (e.g. "#my-window") for native windows.',
			);
		}
		if ( typeof config.title !== 'string' ) {
			throw new TypeError(
				'windowManager.open(): config.title must be a string.',
			);
		}
		const baseId = config.baseId || config.id;
		// Per-desktop ("Spaces") semantics: a window sharing this baseId
		// counts as "the same window" only when it lives on the ACTIVE
		// desktop. On another desktop it's invisible to this click —
		// the user is asking for a copy here, so we fall through to
		// `createWindow` with a fresh suffixed id that won't collide
		// with the far-desktop instance.
		const existing = this.getByBaseIdOnActiveDesktop( baseId );
		if ( existing ) {
			// Capture `wasMinimized` BEFORE `restore()` mutates the
			// state to 'normal'; otherwise the reopen event always
			// reports `wasMinimized: false` for windows that just
			// transitioned through restore.
			const wasMinimized = existing.state === 'minimized';
			this.focus( existing );
			if ( wasMinimized ) {
				existing.restore();
			}
			// URL-aware reuse. Focusing alone only satisfies the
			// caller when the window is already showing the requested
			// URL — or when the request is for the window's "home"
			// URL (a dock / menu click on an already-open,
			// sub-navigated window must NOT yank it back to its
			// landing page). Any other URL is a real navigation the
			// user expects to run in this window. The canonical
			// failure before this check: the post-install "Activate"
			// link (`plugins.php?action=activate&plugin=…&_wpnonce=…`)
			// clicked while a Plugins window was already open focused
			// that window and silently dropped the activation.
			let navigated = false;
			if ( ! existing.config.native ) {
				const requestedKey = urlReuseKey( config.url );
				const alreadyThere =
					requestedKey === urlReuseKey( existing.getCurrentUrl() ) ||
					requestedKey === urlReuseKey( existing.config.url || '' ) ||
					requestedKey ===
						urlReuseKey(
							existing.config.parentUrl ?? existing.config.url ?? '',
						);
				if ( ! alreadyThere ) {
					navigated = existing.navigateTo( config.url );
				}
			}
			// Plugins (messages, code-editor, …) routinely call
			// `wp.os.openWindow(id)` to "switch the window to
			// this state" — selecting a conversation, opening a file,
			// jumping to a tab. For NEW windows the render callback
			// runs and the seeded state lands on first paint; for
			// EXISTING windows there was no signal at all that an
			// open was requested. Plugins were forced to subscribe to
			// `os-window-focused` and infer "open" from
			// "focus", which double-fires on every alt-tab and never
			// fires when the window is already focused. The reopen
			// event is the unambiguous "open requested while already
			// open" signal — fires exactly once per `open()` call on
			// an existing instance.
			// Retarget: a native singleton reopened with new params is
			// being asked to show something else. Write them onto the
			// live config BEFORE the reopen event so a subscriber can
			// read `params` and repaint, and so the next session save
			// records what the window is showing NOW rather than what
			// it opened on. An argument-less reopen leaves the params
			// alone — a dock click on an already-open profile window
			// must not wipe whose profile it is.
			if ( config.params ) {
				existing.config.params = { ...config.params };
			}

			const reopenedDetail = {
				windowId: existing.id,
				baseId,
				wasMinimized,
				navigated,
				params: existing.config.params ?? {},
			};
			document.dispatchEvent(
				new CustomEvent( 'os-window-reopened', { detail: reopenedDetail } ),
			);
			doAction( HOOKS.WINDOW_REOPENED, reopenedDetail );
			return existing;
		}

		// No instance on the current desktop — but a prewarmed hidden
		// window might already be loading this exact page. Adopt it
		// (reveal + focus + announce) instead of building a new one.
		const adopted = this.adoptPrewarmed( baseId, config );
		if ( adopted ) {
			return adopted;
		}

		// If any instance is open on another desktop, the bare `baseId`
		// is taken — pick the next free suffix so DOM ids stay unique.
		// Otherwise use the caller-supplied id as-is (plain
		// `plugins-php`, `edit-php`, etc.).
		const id = this.getByBaseId( baseId )
			? this.nextInstanceId( baseId )
			: config.id;
		return this.createWindow( { ...config, id, baseId } );
	}

	/**
	 * Speculatively build a hidden iframe window for a page the user is
	 * likely to open next (dock hover intent), so the document's server
	 * render, transfer and parse are already underway — or done — when
	 * the real `open()` arrives and adopts it.
	 *
	 * The window mounts `display: none` + `aria-hidden` and lives in a
	 * single-slot cache OUTSIDE the stack (see {@link _prewarmed}), so
	 * it is invisible to sessions, the taskbar, peek cards and Alt-Tab
	 * until adoption. No `os-window-*` event fires for it. Unclaimed
	 * prewarms self-destruct after a TTL. Returns `true` when a
	 * prewarm was started, `false` when skipped (native target,
	 * instance already open, same prewarm already present, or one in
	 * flight).
	 */
	public async prewarm(
		config: Partial< WindowConfig > & {
			id: string;
			url: string;
			title: string;
		},
	): Promise< boolean > {
		const baseId = config.baseId || config.id;
		if (
			config.native ||
			this._prewarmInFlight ||
			this._prewarmed?.baseId === baseId ||
			this.getByBaseId( baseId )
		) {
			return false;
		}
		this._prewarmInFlight = true;
		try {
			// Newest prediction wins the single slot.
			this.discardPrewarmed();
			const win = await this.createWindow(
				{ ...config, id: config.id, baseId },
				{ prewarm: true },
			);
			// A real `open()` can land while `createWindow()` is
			// awaiting its bundles — the user clicked instead of
			// hovering on. It joins the stack; a prewarm never does, so
			// the guard at the top of this method could not see it and
			// `_prewarmed` was still empty when `open()` looked for a
			// window to adopt. Storing this one now would leave two
			// Window instances answering to the same id, one of them
			// invisible and holding an admin iframe.
			//
			// The click won. Throw the speculation away.
			if ( this.getByBaseId( baseId ) ) {
				this.teardownSpeculativeWindow( win );
				return false;
			}
			// Unclaimed speculative windows must not outlive the intent
			// that spawned them — an admin iframe holds real renderer
			// memory, and its nonces age. 45s comfortably covers the
			// hover → decide → click window.
			const timer = window.setTimeout(
				() => this.discardPrewarmed(),
				45_000,
			);
			this._prewarmed = { baseId, win, timer };
			return true;
		} finally {
			this._prewarmInFlight = false;
		}
	}

	/**
	 * Hand a prewarmed window over to a real `open()` call: reveal it,
	 * join the stack, focus, and fire `os-window-opened` so sessions,
	 * the taskbar and the dock catch up exactly as for a normal open.
	 * Returns `null` (after discarding, where appropriate) when the
	 * slot doesn't match the request — wrong page, different URL than
	 * was prewarmed, or an id that got taken in the meantime.
	 */
	private adoptPrewarmed(
		baseId: string,
		config: Partial< WindowConfig > & { url: string },
	): Window | null {
		const slot = this._prewarmed;
		if ( ! slot || slot.baseId !== baseId ) {
			return null;
		}
		const win = slot.win;
		// The prewarm is only valid for the URL it actually loaded — a
		// submenu link under the same tile is a different destination.
		// And its id may have been claimed by an openNew() on another
		// desktop while it sat hidden. Either way: discard, fall
		// through to the normal create path.
		if (
			urlReuseKey( config.url ) !== urlReuseKey( win.config.url || '' ) ||
			this.getById( win.id )
		) {
			this.discardPrewarmed();
			return null;
		}
		window.clearTimeout( slot.timer );
		this._prewarmed = null;
		win.config.desktopId = this._activeDesktopId;
		win.element.style.display = '';
		win.element.removeAttribute( 'aria-hidden' );
		this._stack.push( win );
		applyDesktopVisibility( this, win );
		this.focus( win );
		const openedDetail = {
			windowId: win.id,
			page: win.config.url ?? config.url,
			title: win.config.title,
			url: win.config.url ?? config.url,
		};
		document.dispatchEvent(
			new CustomEvent( 'os-window-opened', { detail: openedDetail } ),
		);
		doAction( HOOKS.WINDOW_OPENED, openedDetail );
		return win;
	}

	/**
	 * Destroy the current prewarmed window, if any. Detaches the close
	 * callback first — the shell never announced this window as opened,
	 * so its teardown must not announce a close either.
	 */
	public discardPrewarmed(): void {
		const slot = this._prewarmed;
		if ( ! slot ) {
			return;
		}
		this._prewarmed = null;
		window.clearTimeout( slot.timer );
		this.teardownSpeculativeWindow( slot.win );
	}

	/**
	 * Tear down a speculative window that will never be adopted.
	 *
	 * Deliberately NOT the normal close path: a prewarm never announced
	 * an open, so announcing a close would hand listeners a lifecycle
	 * event for a window they never saw.
	 *
	 * It still has to release what the window did manage to register.
	 * A prewarmed iframe loads a real admin page, so its chromeless
	 * bridge posts `os-ready` and the parent fires `IFRAME_READY` —
	 * which registers the window with the connection bridge. That
	 * registration is keyed by window id and is normally released on
	 * `WINDOW_CLOSED`, an event this path must not fire, so it was
	 * simply never released: every unadopted hover left an entry
	 * behind. Released directly here, through the same global the
	 * iframe bridge itself uses.
	 *
	 * @param win The speculative window.
	 */
	private teardownSpeculativeWindow( win: Window ): void {
		try {
			(
				globalThis as unknown as {
					__openStationConnectionBridge?: {
						onWindowClosed?: ( id: string ) => void;
					};
				}
			).__openStationConnectionBridge?.onWindowClosed?.( win.id );
		} catch {
			// The bridge is optional; never let cleanup block teardown.
		}
		win.onClose = null;
		try {
			win.destroy();
		} catch {
			// Best-effort teardown; the element removal below is the
			// part that must not fail silently forever.
		}
		win.element.remove();
	}

	/**
	 * Open a brand-new window even if one is already open for this
	 * page. Only makes sense for pages flagged `multi`.
	 *
	 * Duplicates always open in the floating ('normal') state and at
	 * a fresh cascade slot — the per-baseId saved size / state /
	 * position preferences apply to the primary instance only.
	 * Spawning a maximized twin alongside the maximized primary
	 * would hide the primary; landing a twin on top of the primary's
	 * remembered position would hide it too. Callers can override
	 * either default by passing `initialState` / `x` / `y` explicitly.
	 *
	 * A caller-supplied `id` that differs from `baseId` and isn't
	 * taken yet is honoured VERBATIM rather than being reassigned to
	 * the next free slot. Session restore depends on this: it replays
	 * saved instance ids (`edit-php-2`) and anything keyed by window
	 * id — the focused-window pointer in the same session payload,
	 * per-window plugin state, `wp.os.onWindow( id )`
	 * subscriptions — only lines up if the restored window comes back
	 * under the id it was saved with. Slot allocation still applies
	 * to every other caller (a plain duplicate request passes
	 * `id === baseId`).
	 */
	public async openNew(
		config: Partial<WindowConfig> & { id: string; url: string; title: string },
	): Promise< Window > {
		const baseId = config.baseId || config.id;
		const nextId =
			config.id !== baseId && ! this.getById( config.id )
				? config.id
				: this.nextInstanceId( baseId );
		const cascadeX = 40 + ( this.cascadeIndex % 8 ) * CASCADE_OFFSET;
		const cascadeY = 40 + ( this.cascadeIndex % 8 ) * CASCADE_OFFSET;
		return this.createWindow( {
			initialState: 'normal',
			x: cascadeX,
			y: cascadeY,
			...config,
			id: nextId,
			baseId,
		} );
	}

	/**
	 * Build and mount a window element. Common tail shared by
	 * `open()` and `openNew()`.
	 */
	private async createWindow(
		config: Partial<WindowConfig> & { id: string; url: string; title: string; baseId?: string },
		createOpts: { prewarm?: boolean } = {},
	): Promise< Window > {
		// Apply (and consume) anything session restore staged for this
		// id — see {@link seedWindowRestoreState}. Merged before the
		// geometry resolution below so the seeded x / y / size / state
		// register as caller-pinned and win over the localStorage
		// fallback, exactly as if the opener had passed them.
		const staged = this._pendingRestoreState.get( config.id );
		if ( staged ) {
			this._pendingRestoreState.delete( config.id );
			config = { ...config, ...staged };
		}

		const desktopRect = this._desktop.getBoundingClientRect();
		// Defaults, the cascade origin and the saved-position clamp all
		// work in the WORK area — the desktop area minus the band the
		// dock pill covers — so a fresh window never opens with its
		// bottom edge under the dock. `desktopRect` stays the whole
		// area for the `WINDOW_GEOMETRY` filter's documented context.
		const workArea = workAreaRectOf( this._desktop );
		const margin = 12;
		const defaultWidth = Math.min( Math.round( workArea.width * 0.8 ), 1200 );
		const defaultHeight = Math.min( Math.round( workArea.height * 0.8 ), 800 );
		const cascadeX = workArea.x + 40 + ( this.cascadeIndex % 8 ) * CASCADE_OFFSET;
		const cascadeY = workArea.y + 40 + ( this.cascadeIndex % 8 ) * CASCADE_OFFSET;

		// When the caller didn't pin geometry (a fresh dock click or
		// desktop-icon open, not a session restore which passes
		// everything, not an `openNew` duplicate which passes its own
		// cascade), fall back to the per-baseId localStorage geometry
		// store before the desktopRect-based defaults. Same store as
		// native windows — keyed by baseId, lets a user's "this is
		// the size and place I want this window" preference survive
		// close/reopen even when the window wasn't open at the last
		// session save.
		const resolvedBaseId = config.baseId || config.id;
		const minWidth = config.minWidth ?? 320;
		const minHeight = config.minHeight ?? 200;
		const hasExplicitWidth = typeof config.width === 'number';
		const hasExplicitHeight = typeof config.height === 'number';
		const hasExplicitX = typeof config.x === 'number';
		const hasExplicitY = typeof config.y === 'number';
		const hasExplicitState = typeof config.initialState === 'string';
		const saved =
			! hasExplicitWidth ||
			! hasExplicitHeight ||
			! hasExplicitState ||
			! hasExplicitX ||
			! hasExplicitY
				? loadNativeWindowGeometry( resolvedBaseId )
				: null;
		let resolvedWidth =
			config.width ??
			( saved ? Math.max( saved.width, minWidth ) : defaultWidth );
		let resolvedHeight =
			config.height ??
			( saved ? Math.max( saved.height, minHeight ) : defaultHeight );
		// A window nobody positioned must not open under the dock. A
		// registered size is honoured as far as the work area allows —
		// a native window declared 1080×720 on a laptop whose reachable
		// height is 640 opens 616 tall, at its minimum at worst — and
		// the cascade origin below is pulled up so the bottom edge
		// lands inside. Caller-pinned x / y are trusted as-is, and so
		// is a size the user saved by resizing: both are deliberate
		// placement, the user's or a plugin's, not a default.
		const placedByDefault = ! hasExplicitX && ! hasExplicitY && ! saved;
		if ( placedByDefault ) {
			resolvedWidth = Math.max(
				minWidth,
				Math.min( resolvedWidth, workArea.width - margin * 2 ),
			);
			resolvedHeight = Math.max(
				minHeight,
				Math.min( resolvedHeight, workArea.height - margin * 2 ),
			);
		}
		const defaultX = Math.max(
			workArea.x + margin,
			Math.min( cascadeX, workArea.x + workArea.width - resolvedWidth - margin ),
		);
		const defaultY = Math.max(
			workArea.y + margin,
			Math.min( cascadeY, workArea.y + workArea.height - resolvedHeight - margin ),
		);
		const resolvedState =
			config.initialState ??
			( saved?.state === 'maximized' ? 'maximized' : undefined );

		// Clamp saved x / y to the current desktop area so a window
		// remembered at x=2800 on a 3440px display doesn't open
		// off-screen on a laptop. Mirrors the clamp the session-restore
		// path applies via `clampGeometryToViewport`.
		let clampedSavedX: number | undefined;
		let clampedSavedY: number | undefined;
		if (
			saved &&
			typeof saved.x === 'number' &&
			typeof saved.y === 'number'
		) {
			const maxX = Math.max(
				workArea.x,
				workArea.x + workArea.width - resolvedWidth - margin,
			);
			const maxY = Math.max(
				workArea.y,
				workArea.y + workArea.height - resolvedHeight - margin,
			);
			clampedSavedX = Math.max( workArea.x + margin, Math.min( saved.x, maxX ) );
			clampedSavedY = Math.max( workArea.y + margin, Math.min( saved.y, maxY ) );
		}
		const resolvedX = config.x ?? clampedSavedX ?? defaultX;
		const resolvedY = config.y ?? clampedSavedY ?? defaultY;

		// `WINDOW_GEOMETRY` filter context — two booleans that capture
		// the only useful distinctions a filter actually cares about:
		// did we just restore a user-saved layout, and did the caller
		// pin any of the dimensions explicitly. See the
		// `WindowGeometryContext` jsdoc above for plugin-author
		// guidance.
		const callerPinned =
			hasExplicitWidth ||
			hasExplicitHeight ||
			hasExplicitX ||
			hasExplicitY ||
			hasExplicitState;
		const hasSavedGeometry = !! saved;

		const preFilterGeometry: ResolvedWindowGeometry = {
			x: resolvedX,
			y: resolvedY,
			width: resolvedWidth,
			height: resolvedHeight,
			state: resolvedState,
		};
		let filtered: ResolvedWindowGeometry;
		try {
			filtered = applyFilters<
				ResolvedWindowGeometry,
				[ WindowGeometryContext ]
			>(
				HOOKS.WINDOW_GEOMETRY,
				preFilterGeometry,
				{
					windowId: config.id,
					baseId: resolvedBaseId,
					hasSavedGeometry,
					callerPinned,
					desktopRect: {
						width: desktopRect.width,
						height: desktopRect.height,
					},
					workArea: { ...workArea },
				},
			);
		} catch ( err ) {
			// A throwing filter must NOT bring down the window open.
			// Fall back to the pre-filter geometry and surface the
			// error on the shell-error channel so plugin authors find
			// it in devtools.
			doAction( HOOKS.SHELL_ERROR, {
				scope: 'window-geometry-filter',
				windowId: config.id,
				error: err,
			} );
			if ( typeof console !== 'undefined' ) {
				console.error(
					`[openstation] WINDOW_GEOMETRY filter threw for "${ config.id }":`,
					err,
				);
			}
			filtered = preFilterGeometry;
		}

		// Defensive coalesce — a careless filter can return a partial
		// object, a non-finite number, or even something that isn't a
		// geometry shape at all. Treat any field that isn't a finite
		// number as "leave the resolved value alone." Re-clamp width
		// and height to the registered minima — a buggy filter cannot
		// ship a sub-minimum window. Position is NOT re-clamped:
		// plugins sometimes deliberately place windows partially
		// off-screen for stylistic reasons.
		const coalesce = ( v: unknown, fallback: number ): number =>
			typeof v === 'number' && Number.isFinite( v ) ? v : fallback;
		const safeFiltered: ResolvedWindowGeometry =
			filtered && typeof filtered === 'object' ? filtered : preFilterGeometry;
		const finalWidth = Math.max(
			coalesce( safeFiltered.width, resolvedWidth ),
			minWidth,
		);
		const finalHeight = Math.max(
			coalesce( safeFiltered.height, resolvedHeight ),
			minHeight,
		);
		const finalX = coalesce( safeFiltered.x, resolvedX );
		const finalY = coalesce( safeFiltered.y, resolvedY );
		const finalState: WindowState | undefined =
			safeFiltered.state ?? resolvedState;

		const fullConfig: WindowConfig = {
			icon: config.icon || 'dashicons-admin-generic',
			...config,
			// Spread `config` first so callers can pass through any
			// extras (render, ownerHandle, parentUrl, …), then pin the
			// dimensions + state we resolved above. The pin has to
			// follow the spread because an explicit `width: undefined`
			// from the caller would otherwise blow away the default.
			x: finalX,
			y: finalY,
			width: finalWidth,
			height: finalHeight,
			minWidth,
			minHeight,
			...( finalState ? { initialState: finalState } : {} ),
			baseId: resolvedBaseId,
			// New windows always join the active desktop. A caller can
			// pre-seed `desktopId` (e.g. session restore) by passing it
			// in `config`, which the spread above preserves.
			desktopId: config.desktopId || this._activeDesktopId,
		};

		this.cascadeIndex++;

		// Construct a `Window` only once BOTH lazy bundles are
		// available:
		//
		//   1. `window-system[.min].js` — the `Window` class
		//      itself + its DOM / pointer / tab helpers.
		//   2. `shell-overlays[.min].js` — the window-chrome
		//      component classes (`<os-window-button>`,
		//      `<os-menu>`, `<os-tab-chip>`, `<os-save-status>`,
		//      `<os-spinner>`). Without these the constructor's
		//      `createElement( 'os-window-button' )` calls
		//      return un-upgraded elements with empty shadow DOMs
		//      — the title bar's minimize / maximize / close
		//      icons would be invisible until the overlays
		//      bundle finally lands.
		//
		// Awaiting both in parallel adds no latency in steady
		// state (the post-first-paint preloads already finished
		// when the user clicks). The guard exists for the rare
		// case where the click races the preloads — session
		// restore at boot, or a plugin opening a window
		// programmatically right after init.
		const [ system ] = await Promise.all( [
			ensureWindowSystemLoaded( windowSystemBundleUrl() ),
			ensureShellOverlaysLoaded( shellOverlaysBundleUrl() ),
		] );
		const win = system.createWindow( fullConfig );

		win.onFocusRequest = ( w: Window ) => {
			// Mid-cascade, the window asking for focus is one the
			// cascade is moving, not one the user picked. Let the
			// cascade settle focus once at the end.
			if ( this._cascadeDepth > 0 ) {
				return;
			}
			this.focus( w );
		};
		win.onClose = ( w: Window ) => this.remove( w );
		win.onMinimize = ( w: Window ) => {
			// Children go away with their owner — a child left floating
			// over the gap where its owner used to be reads as a
			// detached dialog, and it would go on blocking a window the
			// user can no longer see.
			this._cascadeDepth++;
			try {
				this.cascadeMinimize( w );
			} finally {
				this._cascadeDepth--;
			}
			if ( this._cascadeDepth > 0 ) {
				return;
			}
			const visible = this._stack.filter( ( x ) => x.state !== 'minimized' );
			if ( visible.length > 0 ) {
				this.focus( visible[ visible.length - 1 ] );
			}
		};
		win.onRestore = ( w: Window ) => {
			// No focus call here on purpose. `Window.restore()` fires
			// this BEFORE its own `onFocusRequest`, so once the children
			// are back the request that follows resolves through the
			// normal redirect and the whole group costs one focus
			// change.
			this._cascadeDepth++;
			try {
				this.cascadeRestore( w );
			} finally {
				this._cascadeDepth--;
			}
		};
		win.onOpenAnother = ( w: Window ) => {
			// Native windows: route through the public-API
			// `openNewWindow( id )` so the registry's template clone
			// + render callback fire on the fresh body. Without this
			// branch native windows would fall through to the iframe
			// `openNew()` path below and end up rendered as a
			// generic chromeless iframe, losing their custom UI.
			const baseId = w.config.baseId || w.id;
			if ( w.config.native ) {
				const api = ( window as unknown as {
					wp?: {
						os?: {
							openNewWindow?: (
								id: string,
								opts?: { source?: string },
							) => boolean;
						};
					};
				} ).wp?.os;
				if ( api?.openNewWindow?.( baseId, { source: 'open-another' } ) ) {
					return;
				}
			}
			void this.openNew( {
				id: baseId,
				baseId,
				url: w.config.url || '',
				title: w.config.title,
				icon: w.config.icon,
				submenu: w.config.submenu,
				multi: true,
			} );
		};
		// "Open in new window" — like open-another, but seeds the new
		// window with the source's *current* URL (post in-window
		// navigation) instead of the original landing URL. Lets a user
		// keep the page they're looking at while peeling a fresh copy
		// off the same window.
		win.onOpenInNewWindow = ( w: Window ) => {
			// Native windows have no URL state to preserve — peeling
			// off a fresh copy means spawning a new instance from the
			// registry, same as `onOpenAnother`.
			const baseId = w.config.baseId || w.id;
			if ( w.config.native ) {
				const api = ( window as unknown as {
					wp?: {
						os?: {
							openNewWindow?: (
								id: string,
								opts?: { source?: string },
							) => boolean;
						};
					};
				} ).wp?.os;
				if ( api?.openNewWindow?.( baseId, { source: 'open-in-new-window' } ) ) {
					return;
				}
			}
			const currentUrl = w.getCurrentUrl();
			void this.openNew( {
				id: baseId,
				baseId,
				url: currentUrl || w.config.url || '',
				title: w.config.title,
				icon: w.config.icon,
				submenu: w.config.submenu,
				multi: true,
			} );
		};
		// "Open on startup" toggles the user's default-window
		// preference to point at this window's current URL — or
		// disables it entirely when the window is already the default.
		// The actual REST write is owned by the shell's public API
		// (`wp.os.setDefaultWindow`), injected via
		// `this.onToggleStartupRequested`.
		win.onToggleStartup = ( w: Window ) => {
			this.onToggleStartupRequested?.( w );
		};
		win.snapConfigProvider = () => this.getSnapConfig();
		// Edge-snap + split-overview flow. `onDragMove` updates the
		// snap preview on every pointermove; `onDragEnd` commits the
		// snap (and returns true, suppressing the pointer layer's
		// default move-end hook firing).
		win.onDragMove = ( w, clientX ) => {
			updateSnapZoneForDrag( this, w, clientX );
		};
		win.onDragEnd = ( w ) => {
			if ( this._snapPendingZone ) {
				return commitSnapIfPending( this, w );
			}
			abortSnapIfPending( this );
			return false;
		};

		if ( createOpts.prewarm ) {
			// Speculative build (see {@link prewarm}): mount hidden so
			// the iframe starts loading (a detached iframe never
			// fetches; a display:none one does), skip the stack, skip
			// focus, fire nothing. The loading-overlay and reveal
			// machinery finds the element by id and runs to completion
			// invisibly — by adoption time the content is simply ready.
			win.element.style.display = 'none';
			win.element.setAttribute( 'aria-hidden', 'true' );
			this._desktop.appendChild( win.element );
			return win;
		}

		this._stack.push( win );
		this._desktop.appendChild( win.element );
		applyDesktopVisibility( this, win );

		// Hydrate native windows AFTER mount. The plugin's render
		// callback receives a body that's already connected to the
		// document, so any `<os-*>` custom element the plugin
		// creates or populates via declarative setters upgrades
		// synchronously (HTML spec: elements upgrade on connection).
		// Calling before mount would leave the body detached,
		// which made `element.items = […]` stash an own data
		// property on the pre-upgrade instance that shadowed the
		// class setter after upgrade — empty `<os-select>`s in
		// practice. No-op for iframe windows.
		win.hydrateNative();

		this.focus( win );

		const openedDetail = {
			windowId: win.id,
			page: config.url,
			title: config.title,
			url: config.url,
		};
		document.dispatchEvent(
			new CustomEvent( 'os-window-opened', { detail: openedDetail } ),
		);
		// Fan out to the hook bus so plugins using wp.hooks.addAction()
		// stay in their idiomatic API rather than juggling
		// CustomEvents.
		doAction( HOOKS.WINDOW_OPENED, openedDetail );

		return win;
	}

	/**
	 * Find the next unused suffixed id for a given baseId. Prefers
	 * the bare baseId itself if free (user closed the original), then
	 * walks `-2`, `-3`, … until it lands on one not currently in the
	 * stack.
	 */
	private nextInstanceId( baseId: string ): string {
		const taken = new Set( this._stack.map( ( w ) => w.id ) );
		if ( ! taken.has( baseId ) ) {
			return baseId;
		}
		let n = 2;
		while ( taken.has( `${ baseId }-${ n }` ) ) {
			n++;
		}
		return `${ baseId }-${ n }`;
	}

	/**
	 * Focus a window: bring it to top of z-stack.
	 *
	 * Accepts either a `Window` or its id — `focus( 'jorvy' )` is the
	 * form the docs and `built-in-commands` already show, and the
	 * natural one for a plugin author holding only an id.
	 *
	 * The runtime guard is load-bearing, not decoration. `focus()`
	 * pushes its argument onto `_stack` and then calls `setZIndex()`
	 * on every member, so an unresolvable argument used to leave a
	 * non-Window wedged in the stack and every LATER focus() —
	 * click-to-focus, dock activation, open-reuse — threw on it. One
	 * bad call bricked the desktop until a reload. Resolve ids and
	 * reject anything that isn't a Window BEFORE touching the stack.
	 *
	 * Unknown ids are a silent no-op (matching `raise()`): a window
	 * closing between an id being captured and focus being requested
	 * is a routine race, not a programming error. A non-Window,
	 * non-string argument IS a programming error, so it warns.
	 *
	 * A window that OWNS an open child cannot be focused — focus goes
	 * to the child instead (see {@link blockingChildOf}). That is the
	 * whole of child-window modality, and it lives here rather than at
	 * the call sites so every focus path is covered by construction:
	 * click-to-focus, dock activation, taskbar, alt-tab, open-reuse.
	 *
	 * @param winOrId Window to focus, or its id.
	 */
	public focus( winOrId: Window | string ): void {
		const requested =
			typeof winOrId === 'string' ? this.getById( winOrId ) : winOrId;
		if ( ! requested || typeof requested.setZIndex !== 'function' ) {
			if ( winOrId && typeof winOrId !== 'string' ) {
				// eslint-disable-next-line no-console -- Surfacing a call that would otherwise corrupt the z-stack silently.
				console.warn(
					'[openstation] windowManager.focus() expects a Window or a window id; received',
					winOrId,
				);
			}
			return;
		}

		// Child-window modality. Redirect to the DEEPEST open
		// descendant so a chain (owner → child → grandchild) hands
		// focus to the one actually on top rather than to a middle
		// link that is itself blocked.
		const win = this.blockingChildOf( requested ) ?? requested;
		if ( win !== requested ) {
			// Nudge the child so the click reads as "answer this
			// first" instead of as a dead click on the owner.
			win.shake?.();
			doAction( HOOKS.WINDOW_CHILD_BLOCKED, {
				windowId: requested.id,
				childWindowId: win.id,
			} );
			document.dispatchEvent(
				new CustomEvent( 'os-window-child-blocked', {
					detail: { windowId: requested.id, childWindowId: win.id },
				} ),
			);
			// Fall through: the child is focused exactly as if it had
			// been the argument, so it lands on top and fires the
			// normal blur/focus pair.
		}

		// Capture the previously-focused window BEFORE the splice/push
		// changes the stack — needed so we can fire `WINDOW_BLURRED`
		// for it. No-op when this `focus()` is hitting the already-
		// top window (alt-tab to self) since blur+focus on the same
		// id is misleading.
		const previouslyFocused =
			this._stack.length > 0 ? this._stack[ this._stack.length - 1 ] : null;

		// A fullscreen window pins itself above all other windows via
		// `z-index: var(--os-z-fullscreen)`, so any newly-
		// focused window would render behind it. Default: exit
		// fullscreen on focus change. Plugins whose fullscreen surface
		// is meant to persist (slideshow, video, game) can opt out via
		// the `WINDOW_AUTO_EXIT_FULLSCREEN` filter.
		//
		// `previouslyFocused` above is `_stack[length-1]` — but `open()`
		// pushes the new window onto the stack BEFORE calling `focus()`,
		// so on the open path that snapshot is `win` itself. Find the
		// other fullscreen window by `isFocused()` instead so the
		// auto-exit covers open, activate, and restore-from-minimize
		// uniformly.
		const priorFullscreen = this._stack.find(
			( w ) => w !== win && w.isFocused() && w.isFullscreen(),
		);
		if ( priorFullscreen ) {
			const shouldExit = applyFilters<
				boolean,
				[ { windowId: string; focusedTo: string } ]
			>(
				HOOKS.WINDOW_AUTO_EXIT_FULLSCREEN,
				true,
				{ windowId: priorFullscreen.id, focusedTo: win.id },
			);
			if ( shouldExit ) {
				priorFullscreen.toggleFullscreen();
			}
		}

		// Remove from current position and push to top.
		const idx = this._stack.indexOf( win );
		if ( idx > -1 ) {
			this._stack.splice( idx, 1 );
		}
		this._stack.push( win );

		// Lift every open child back above its owner. Focusing an
		// owner is already redirected, but plenty of other paths move
		// the stack — restore-from-minimize, desktop switch, session
		// restore — and each could otherwise bury a child under the
		// window it is supposed to be blocking.
		this.enforceOwnershipOrder();

		// Update z-indices and focused state.
		this._stack.forEach( ( w, i ) => {
			w.setZIndex( BASE_Z_INDEX + i );
			w.setFocused( i === this._stack.length - 1 );
		} );

		// Fire blur for the OLD top BEFORE focused for the new top so
		// subscribers see a "lose then gain" ordering. No blur fires
		// when the new focus IS the previous top (idempotent re-focus).
		if (
			previouslyFocused &&
			previouslyFocused !== win &&
			previouslyFocused.id !== win.id
		) {
			const blurredDetail = {
				windowId: previouslyFocused.id,
				focusedTo: win.id,
			};
			document.dispatchEvent(
				new CustomEvent( 'os-window-blurred', { detail: blurredDetail } ),
			);
			doAction( HOOKS.WINDOW_BLURRED, blurredDetail );
		}

		// Dispatch custom event + action for the newly-focused window.
		const focusedDetail = { windowId: win.id };
		document.dispatchEvent(
			new CustomEvent( 'os-window-focused', { detail: focusedDetail } ),
		);
		doAction( HOOKS.WINDOW_FOCUSED, focusedDetail );
	}

	/**
	 * Raise a window to just below the top of the stack WITHOUT
	 * changing focus — the focused window stays on top and keeps
	 * keyboard/visual focus; the raised window surfaces above
	 * everything else. No focus/blur events fire (this is a silent
	 * restack, not a focus change).
	 *
	 * Used by the window-links feature to bring a relation group
	 * forward when one of its members is focused; available to
	 * plugins for any "surface my companion window" affordance.
	 *
	 * @param windowId Window to raise. Unknown ids and the focused
	 *                 window itself are no-ops.
	 */
	public raise( windowId: string ): void {
		const win = this.getById( windowId );
		if ( ! win || this._stack.length < 2 ) {
			return;
		}
		const idx = this._stack.indexOf( win );
		if ( idx === -1 || idx === this._stack.length - 1 ) {
			return;
		}
		this._stack.splice( idx, 1 );
		this._stack.splice( this._stack.length - 1, 0, win );
		this.enforceOwnershipOrder();
		this._stack.forEach( ( w, i ) => {
			w.setZIndex( BASE_Z_INDEX + i );
		} );
	}

	/**
	 * Open a **child window** owned by `parentWindowId`.
	 *
	 * A child is a real window — its own chrome, drag, resize,
	 * minimize, taskbar entry — with one rule layered on top: its
	 * owner can never sit above it. Clicking the owner shakes the
	 * child and leaves focus there. Use it for the "finish this before
	 * going back" shapes a modal dialog is normally reached for, when
	 * what you actually want is a window: a full editor for one row of
	 * a list, a wizard beside the page it configures, a diff over the
	 * revision it belongs to.
	 *
	 * The owner keeps working throughout — scrollable, readable,
	 * draggable, resizable. Only its z-order is constrained.
	 *
	 * Centers over the owner by default, which is what makes the
	 * relationship legible at a glance; pass `x`/`y` to override.
	 * Every other `open()` option (`native`, `render`, `width`,
	 * `params`, …) behaves exactly as it does there.
	 *
	 * ```js
	 * await wp.os.windowManager.openChild( 'edit-post-42', {
	 *     id: 'my-plugin-seo-audit-42',
	 *     url: '#seo-audit-42',
	 *     title: 'SEO audit',
	 *     icon: 'dashicons-chart-line',
	 *     native: true,
	 *     render: ( body ) => { … },
	 * } );
	 * ```
	 *
	 * @param parentWindowId Owner window's id. Must be open — a child
	 *                       of nothing has nothing to block, so an
	 *                       unknown id rejects rather than quietly
	 *                       opening a normal window.
	 * @param config         Window config, exactly as for `open()`.
	 *                       Any `parentWindowId` in here is ignored in
	 *                       favour of the argument.
	 * @return The opened child window.
	 */
	public async openChild(
		parentWindowId: string,
		config: Partial< WindowConfig > & {
			id: string;
			url: string;
			title: string;
		},
	): Promise< Window > {
		const parent = this.getById( parentWindowId );
		if ( ! parent ) {
			throw new Error(
				`windowManager.openChild(): no open window with id "${ parentWindowId }". Open the owner first, or use open() for a standalone window.`,
			);
		}

		// Does this child already have a place the user chose? `open()`
		// falls back to per-baseId localStorage geometry when the caller
		// pins nothing, and that memory has to win over centering — a
		// child the user dragged aside and resized should come back
		// where they left it, exactly like any other window.
		const savedGeometry = loadNativeWindowGeometry(
			config.baseId || config.id,
		);
		const hasSavedPlacement =
			!! savedGeometry &&
			typeof savedGeometry.x === 'number' &&
			typeof savedGeometry.y === 'number';

		// Center over the owner when nothing else has an opinion. Read
		// the owner's live rect rather than its config: it has very
		// likely been dragged or resized since it opened, and a child
		// centered on where the owner *started* can land off-screen.
		//
		// Size and position are pinned TOGETHER or not at all. Sending
		// x/y derived from an assumed size while letting `open()` resolve
		// the real size from its own desktop-based defaults produces a
		// child centered for dimensions it does not have — which is to
		// say, not centered.
		let placement: Partial< WindowConfig > = {};
		if (
			config.x === undefined &&
			config.y === undefined &&
			! hasSavedPlacement
		) {
			const owner = parent.getSnapshot();
			const width = config.width ?? Math.round( owner.width * 0.8 );
			const height = config.height ?? Math.round( owner.height * 0.8 );
			// Keep the child inside the work area even when its owner
			// is hanging off an edge. `open()` clamps saved geometry but
			// trusts caller-pinned coordinates, and this counts as
			// caller-pinned.
			const area = workAreaRectOf( this._desktop );
			const maxX = Math.max( area.x, area.x + area.width - width );
			const maxY = Math.max( area.y, area.y + area.height - height );
			placement = {
				width,
				height,
				x: Math.min(
					maxX,
					Math.max( area.x, Math.round( owner.x + ( owner.width - width ) / 2 ) ),
				),
				y: Math.min(
					maxY,
					Math.max( area.y, Math.round( owner.y + ( owner.height - height ) / 2 ) ),
				),
			};
		}

		return this.open( {
			...config,
			...placement,
			// Children live on their owner's desktop — a child stranded
			// on another virtual desktop would block a window nobody
			// can see next to it.
			desktopId: parent.config.desktopId,
			parentWindowId,
		} );
	}

	/**
	 * The window that owns `win`, or undefined when it is not a child
	 * (or its owner has since closed — an orphan is a normal window).
	 *
	 * @param win Window to look up the owner of.
	 */
	public ownerOf( win: Window ): Window | undefined {
		const parentId = win.config.parentWindowId;
		return parentId ? this.getById( parentId ) : undefined;
	}

	/**
	 * Every open child of `winOrId`, in z-order (lowest first).
	 *
	 * Direct children only — walk the result to reach grandchildren.
	 * Includes minimized children: they do not block focus, but a
	 * caller counting "what does closing this take with it" needs
	 * them.
	 *
	 * @param winOrId Owner window, or its id.
	 */
	public childrenOf( winOrId: Window | string ): Window[] {
		const id = typeof winOrId === 'string' ? winOrId : winOrId.id;
		return this._stack.filter( ( w ) => w.config.parentWindowId === id );
	}

	/**
	 * The child that stands between `win` and the front, or undefined
	 * when `win` is free to take focus.
	 *
	 * Walks to the DEEPEST open descendant, because a child can own a
	 * child of its own and only the last link is actually on top.
	 *
	 * Minimized children are skipped deliberately: the user put that
	 * child away, and a window that cannot be seen has no business
	 * withholding focus from the one that can. Bringing the child back
	 * restores the block.
	 *
	 * @param win Window a focus request came in for.
	 */
	public blockingChildOf( win: Window ): Window | undefined {
		let current = win;
		let blocker: Window | undefined;
		// `seen` guards against a cycle in plugin-declared ownership
		// (A owns B, B owns A). Without it a bad pair would spin here
		// forever on the first click.
		const seen = new Set< Window >( [ win ] );
		for ( ;; ) {
			const open = this.childrenOf( current ).filter(
				( w ) => w.state !== 'minimized' && ! seen.has( w ),
			);
			if ( open.length === 0 ) {
				return blocker;
			}
			// Topmost of several siblings — `childrenOf` returns
			// z-order, so the last one is the one in front.
			current = open[ open.length - 1 ];
			seen.add( current );
			blocker = current;
		}
	}

	/**
	 * Reorder `_stack` so no open child sits below its owner, then
	 * leave the z-index rewrite to the caller.
	 *
	 * A stable topological pass: walk the stack bottom-up and emit
	 * each window only after its owner, preserving existing order
	 * everywhere ownership says nothing. Stability matters — this runs
	 * on every focus, and an unstable sort would shuffle unrelated
	 * windows behind each other on every click.
	 *
	 * Minimized windows are exempt from the constraint. Not cosmetic:
	 * without the exemption, focusing an owner whose only child is
	 * minimized would hoist that invisible child to the top of the
	 * stack, and `setFocused( i === length - 1 )` would hand focus to
	 * a window the user cannot see.
	 */
	private enforceOwnershipOrder(): void {
		// Nothing declares ownership on most desktops — skip the whole
		// pass rather than rebuild the array on every single focus.
		if ( ! this._stack.some( ( w ) => w.config.parentWindowId ) ) {
			return;
		}

		const ordered: Window[] = [];
		const placed = new Set< Window >();

		const place = ( win: Window, chain: Set< Window > ): void => {
			if ( placed.has( win ) || chain.has( win ) ) {
				return;
			}
			chain.add( win );
			if ( win.state !== 'minimized' ) {
				const owner = this.ownerOf( win );
				if ( owner && owner !== win ) {
					place( owner, chain );
				}
			}
			if ( ! placed.has( win ) ) {
				placed.add( win );
				ordered.push( win );
			}
		};

		for ( const win of this._stack ) {
			place( win, new Set() );
		}

		// Mutate in place — `_stack` is public and long-lived, so
		// reassigning it would strand any reference taken elsewhere.
		this._stack.length = 0;
		this._stack.push( ...ordered );
	}

	/**
	 * Minimize every open child of `win`, remembering which ones this
	 * cascade put away so {@link cascadeRestore} can tell them from
	 * children the user had already minimized themselves.
	 *
	 * @param win Owner being minimized.
	 */
	private cascadeMinimize( win: Window ): void {
		for ( const child of this.childrenOf( win ) ) {
			if ( child.state === 'minimized' ) {
				continue;
			}
			this._cascadeMinimized.add( child );
			// `minimize()` fires the child's own `onMinimize`, which
			// re-enters here for a grandchild — so a whole ownership
			// chain folds away without an explicit recursive walk.
			child.minimize();
		}
	}

	/**
	 * Bring back the children that went away with `win`, and only
	 * those.
	 *
	 * A child the user minimized on their own before minimizing the
	 * owner stays minimized: they put it away deliberately, and
	 * un-minimizing it here would also silently re-block the owner
	 * they just came back to.
	 *
	 * @param win Owner being restored.
	 */
	private cascadeRestore( win: Window ): void {
		for ( const child of this.childrenOf( win ) ) {
			if ( ! this._cascadeMinimized.has( child ) ) {
				continue;
			}
			this._cascadeMinimized.delete( child );
			// Mirrors `cascadeMinimize`: the child's own `onRestore`
			// carries the cascade down to its grandchildren.
			child.restore();
		}
	}

	/** Remove a window from the stack and DOM. */
	private remove( win: Window ): void {
		const idx = this._stack.indexOf( win );
		if ( idx > -1 ) {
			this._stack.splice( idx, 1 );
		}

		// An owned window has no life of its own — close the children
		// with their owner. Snapshot first: each `close()` re-enters
		// `remove()` and mutates `_stack` underneath us.
		//
		// `close()` rather than `destroy()` so a child with unsaved
		// changes still gets to ask. A child that vetoes outlives its
		// owner and becomes an ordinary window (`ownerOf` returns
		// undefined once the owner is gone), which is a better outcome
		// than discarding the user's work.
		//
		// Depth-guarded like the minimize cascade: each `close()`
		// re-enters `remove()`, which would otherwise run the
		// focus-next-window pass below once per child and emit a focus
		// change for every intermediate window on the way down.
		const children = this.childrenOf( win ).slice();
		if ( children.length > 0 ) {
			this._cascadeDepth++;
			try {
				for ( const child of children ) {
					this._cascadeMinimized.delete( child );
					child.close();
				}
			} finally {
				this._cascadeDepth--;
			}
		}

		// Focus the next topmost FOCUSABLE window — walk the stack
		// top-down and skip windows the user can't actually see take
		// focus: minimized ones, and ones living on another virtual
		// desktop (the stack spans every desktop). Blindly focusing
		// `_stack[length-1]` would hand focus to an invisible window —
		// leaving every visible window looking unfocused (and, with an
		// unfocus effect active, darkened with nothing bright). Mirrors
		// the active-desktop filter used by `getByBaseIdOnActiveDesktop`.
		// If nothing qualifies (only minimized / off-desktop windows
		// remain), we focus nothing rather than force-restore one.
		//
		// Skipped while an ownership cascade is unwinding — the owner's
		// own `remove()` runs this pass once the whole group is gone,
		// and doing it per child would hand focus through every
		// intermediate window first.
		for ( let i = this._stack.length - 1; this._cascadeDepth === 0 && i >= 0; i-- ) {
			const candidate = this._stack[ i ];
			if ( candidate.state === 'minimized' ) {
				continue;
			}
			const candidateDesktop =
				candidate.config.desktopId || this._activeDesktopId;
			if ( candidateDesktop !== this._activeDesktopId ) {
				continue;
			}
			this.focus( candidate );
			break;
		}

		// `closing` fires FIRST, while the element is still in the DOM
		// (the `Window.close()` animation runs after this return).
		// Carries an element reference so subscribers that anchor DOM
		// nodes to a specific window (falling snow, wallpaper
		// overlays, measurement caches) can do a race-free detach —
		// without the ref they'd have to re-query by id right as the
		// fade-out starts, which is an unnecessary footgun.
		const closingDetail = { windowId: win.id, element: win.element };
		document.dispatchEvent(
			new CustomEvent( 'os-window-closing', { detail: closingDetail } ),
		);
		doAction( HOOKS.WINDOW_CLOSING, closingDetail );

		// `closed` still fires here (not after the fade-out) for
		// back-compat — historically subscribers have relied on it
		// to update counts / dock state as soon as the user
		// clicks the X. Keep that timing; plugins that need the live
		// element now have `closing` above.
		const closedDetail = { windowId: win.id };
		document.dispatchEvent(
			new CustomEvent( 'os-window-closed', { detail: closedDetail } ),
		);
		doAction( HOOKS.WINDOW_CLOSED, closedDetail );
	}

	/** Get a window by its ID. */
	public getById( id: string ): Window | undefined {
		return this._stack.find( ( w ) => w.id === id );
	}

	/**
	 * Get the most-recently-focused window for a given baseId.
	 *
	 * Multi-instance windows share a baseId; the stack is ordered
	 * bottom to top by focus, so iterating from the end finds the
	 * best candidate to bring forward when the user re-clicks the
	 * dock icon.
	 */
	public getByBaseId( baseId: string ): Window | undefined {
		for ( let i = this._stack.length - 1; i >= 0; i-- ) {
			const w = this._stack[ i ];
			if ( ( w.config.baseId || w.id ) === baseId ) {
				return w;
			}
		}
		return undefined;
	}

	/**
	 * Like {@link getByBaseId} but only considers windows on the
	 * currently-active virtual desktop. The dock's "open or focus"
	 * path uses this — a Plugins instance that lives on Desktop 2 is
	 * invisible from Desktop 1's dock click, so clicking Plugins on
	 * Desktop 1 should open a fresh instance there instead of trying
	 * to focus the far-off sibling (which would silently do nothing
	 * because the other desktop's windows are display: none here).
	 */
	public getByBaseIdOnActiveDesktop( baseId: string ): Window | undefined {
		for ( let i = this._stack.length - 1; i >= 0; i-- ) {
			const w = this._stack[ i ];
			if ( ( w.config.baseId || w.id ) !== baseId ) {
				continue;
			}
			const winDesktop = w.config.desktopId || this._activeDesktopId;
			if ( winDesktop === this._activeDesktopId ) {
				return w;
			}
		}
		return undefined;
	}

	/**
	 * Get every open window sharing the given baseId, ordered by
	 * instance slot (bare baseId first, then `-2`, `-3`, …) rather
	 * than z-order — so the dock's instance rail keeps a stable
	 * left-to-right order even as the user focuses between windows.
	 */
	public getAllByBaseId( baseId: string ): Window[] {
		const instanceSlot = ( id: string ): number => {
			if ( id === baseId ) {
				return 1;
			}
			const prefix = `${ baseId }-`;
			if ( id.startsWith( prefix ) ) {
				const n = parseInt( id.slice( prefix.length ), 10 );
				return Number.isFinite( n ) ? n : 999;
			}
			return 999;
		};
		return this._stack
			.filter( ( w ) => ( w.config.baseId || w.id ) === baseId )
			.sort( ( a, b ) => instanceSlot( a.id ) - instanceSlot( b.id ) );
	}

	/**
	 * Get every open window sharing the given baseId on the active desktop,
	 * ordered by instance slot.
	 */
	public getAllByBaseIdOnActiveDesktop( baseId: string ): Window[] {
		return this.getAllByBaseId( baseId ).filter(
			( w ) => ( w.config.desktopId || this._activeDesktopId ) === this._activeDesktopId,
		);
	}

	/** Get all open windows. */
	public getAll(): Window[] {
		return [ ...this._stack ];
	}

	/**
	 * Find the window whose iframe's contentWindow matches the given
	 * message source. Used by cross-frame bridges to attribute inbound
	 * `postMessage` events to the originating window without reaching
	 * into `_stack`.
	 */
	public findByIframeSource( source: MessageEventSource | null ): Window | undefined {
		if ( ! source ) {
			return undefined;
		}
		return this._stack.find(
			( w ) => w.iframe !== null && w.iframe.contentWindow === source,
		);
	}

	/** Get the currently focused (topmost) window. */
	public getFocused(): Window | undefined {
		return this._stack.length > 0 ? this._stack[ this._stack.length - 1 ] : undefined;
	}

	/**
	 * "Is the window with this id currently in front of the user?"
	 *
	 * Returns true when the window exists in the manager AND it
	 * isn't minimized AND it's the currently focused (topmost)
	 * window. False otherwise — including for unknown ids, closed
	 * windows, minimized windows, or windows that exist but aren't
	 * on top.
	 *
	 * The canonical query for plugins implementing the "show
	 * something *only when the user can't already see my
	 * window*" pattern (badge counts, attention pulses, sounds,
	 * toasts). Plugins that previously hand-rolled
	 * `getById(id) && state !== 'minimized' && focused` can
	 * collapse to this.
	 *
	 * @param id Window id to query.
	 * @return True when the user is actively looking at this window.
	 */
	public isActive( id: string ): boolean {
		const win = this.getById( id );
		if ( ! win ) {
			return false;
		}
		if ( win.state === 'minimized' ) {
			return false;
		}
		const winDesktop = win.config.desktopId || this._activeDesktopId;
		if ( winDesktop !== this._activeDesktopId ) {
			return false;
		}
		const focused = this.getFocused();
		return !! focused && focused.id === id;
	}

	/**
	 * Like {@link isActive}, but returns true if *any* window with the
	 * given baseId is currently active.
	 */
	public isActiveByBaseId( baseId: string ): boolean {
		const focused = this.getFocused();
		if ( ! focused ) {
			return false;
		}
		if ( focused.state === 'minimized' ) {
			return false;
		}
		const winDesktop = focused.config.desktopId || this._activeDesktopId;
		if ( winDesktop !== this._activeDesktopId ) {
			return false;
		}
		return ( focused.config.baseId || focused.id ) === baseId;
	}

	// ---- Virtual desktop delegations ----

	public getDesktops(): Desktop[] {
		return getDesktops( this );
	}
	public getActiveDesktop(): Desktop {
		return getActiveDesktop( this );
	}
	public getActiveDesktopId(): string {
		return getActiveDesktopId( this );
	}
	public createDesktop(): Desktop {
		return createDesktop( this );
	}
	public switchDesktop( id: string, opts?: SwitchDesktopOptions ): void {
		switchDesktop( this, id, opts );
	}
	public closeDesktop( id: string ): void {
		closeDesktop( this, id );
	}
	public renameDesktop( id: string, label: string ): boolean {
		return renameDesktop( this, id, label );
	}

	/**
	 * Returns the "primary" desktop id — the one new sessions land on
	 * and that batch operations like {@link closeAll} treat as the
	 * survivor when an `onlyOnPrimary` mode is requested.
	 *
	 * Default: the first desktop in `getDesktops()`. Filterable via
	 * `os.primary-desktop-id` so downstream code that wants a
	 * different convention (e.g. a pinned "Inbox" desktop) can override
	 * without having to fork the manager.
	 */
	public getPrimaryDesktopId(): string {
		const all = this.getDesktops();
		const fallback = all.length > 0 ? all[ 0 ].id : 'desktop-1';
		const filtered = applyFilters< string, [ Desktop[] ] >(
			HOOKS.PRIMARY_DESKTOP_ID,
			fallback,
			all,
		);
		// Defensive: a misbehaving filter could return a non-string or
		// an id that doesn't match any desktop. Fall back to the first
		// real desktop in those cases.
		if ( typeof filtered !== 'string' || filtered === '' ) {
			return fallback;
		}
		const exists = all.some( ( d ) => d.id === filtered );
		return exists ? filtered : fallback;
	}

	/**
	 * Close every open window in batch.
	 *
	 * Hook chain:
	 *
	 *   1. `os.windows.before-close-all` — action. Subscribers
	 *      can prepare for the wipe (cancel pending saves, dismiss
	 *      menus, etc.). Detail: `{ candidates: Window[] }`.
	 *
	 *   2. `os.windows.close-all` — filter. Receives the
	 *      candidate Window list and returns the (possibly smaller) list
	 *      that will actually be closed. Plugins use this to PROTECT
	 *      specific windows — e.g. keep a draft post window open during
	 *      a "Close all" operation. Returning an empty array cancels
	 *      the close entirely.
	 *
	 *   3. Each surviving window's `close()` is called.
	 *
	 *   4. `os.windows.after-close-all` — action. Detail:
	 *      `{ closed: number, skipped: Window[] }`.
	 *
	 * @param options           Close options.
	 * @param options.exceptIds Window ids to skip even before the filter runs.
	 * @return Number of windows actually closed.
	 */
	public closeAll( options?: { exceptIds?: string[] } ): number {
		const exceptSet = new Set( options?.exceptIds ?? [] );
		// Snapshot — close() mutates the live `_stack` array as each
		// window is closed, so we filter-and-copy first. `_stack` is
		// the z-ordered list of every live Window instance; iterating
		// it covers windows on every virtual desktop.
		const initialCandidates = this._stack.filter(
			( w ) => ! exceptSet.has( w.id ),
		);

		doAction( HOOKS.WINDOWS_BEFORE_CLOSE_ALL, { candidates: initialCandidates } );

		const filtered = applyFilters< Window[], [] >(
			HOOKS.WINDOWS_CLOSE_ALL,
			initialCandidates,
		);
		const finalList = Array.isArray( filtered ) ? filtered : initialCandidates;
		const skipped = initialCandidates.filter( ( w ) => ! finalList.includes( w ) );

		let closed = 0;
		// Iterate a copy because close() removes from the underlying
		// array — iterating the live one would skip every other entry.
		for ( const win of finalList.slice() ) {
			try {
				win.close();
				closed++;
			} catch ( err ) {
				if ( typeof console !== 'undefined' ) {
					console.error(
						'[openstation] closeAll: window.close() threw for',
						win.id,
						err,
					);
				}
			}
		}

		doAction( HOOKS.WINDOWS_AFTER_CLOSE_ALL, { closed, skipped } );

		return closed;
	}

	/**
	 * Minimize every currently-non-minimized window. Returns the
	 * exact set that was minimized — i.e., excludes windows already
	 * in the `'minimized'` state — so callers can pair the call with
	 * a later {@link restoreFrom} that touches only the windows
	 * they minimized.
	 *
	 * The "Show Desktop" gesture (clicking the wallpaper) routes
	 * through this method (and {@link restoreFrom} on the second
	 * click); plugin authors building expand/collapse UIs that
	 * mimic the gesture should use these primitives instead of
	 * rolling the loop themselves.
	 *
	 * @public
	 */
	public minimizeAll(): Window[] {
		const minimized: Window[] = [];
		for ( const win of this._stack.slice() ) {
			const winDesktop = win.config.desktopId || this._activeDesktopId;
			if ( winDesktop !== this._activeDesktopId ) {
				continue;
			}
			if ( win.state === 'minimized' ) {
				continue;
			}
			try {
				win.minimize();
				minimized.push( win );
			} catch ( err ) {
				if ( typeof console !== 'undefined' ) {
					console.error(
						'[openstation] minimizeAll: window.minimize() threw for',
						win.id,
						err,
					);
				}
			}
		}
		return minimized;
	}

	/**
	 * Restore the given window list — the symmetric counterpart to
	 * {@link minimizeAll}. Skips windows that have since been
	 * closed and windows the user manually un-minimized between
	 * the minimize and the restore.
	 *
	 * Pass the array {@link minimizeAll} returned to restore
	 * exactly what you minimized; pass any subset to restore
	 * selectively.
	 *
	 * @public
	 */
	public restoreFrom( windows: Window[] ): void {
		if ( ! Array.isArray( windows ) ) {
			return;
		}
		const live = new Set( this._stack );
		for ( const win of windows ) {
			if ( ! live.has( win ) ) {
				continue;
			}
			const winDesktop = win.config.desktopId || this._activeDesktopId;
			if ( winDesktop !== this._activeDesktopId ) {
				continue;
			}
			if ( win.state !== 'minimized' ) {
				continue;
			}
			try {
				win.restore();
			} catch ( err ) {
				if ( typeof console !== 'undefined' ) {
					console.error(
						'[openstation] restoreFrom: window.restore() threw for',
						win.id,
						err,
					);
				}
			}
		}
	}

	/**
	 * Toggle the "Show Desktop" state — if every live window is
	 * already minimized, restore them all; otherwise minimize the
	 * non-minimized cohort. Returns `true` when the new state is
	 * "showing the desktop" (everything minimized after the call),
	 * `false` when windows have just been restored.
	 *
	 * Mirrors the wallpaper-click gesture exactly, in one call.
	 *
	 * @public
	 */
	public toggleShowDesktop(): boolean {
		const all = this._stack.filter(
			( w ) => ( w.config.desktopId || this._activeDesktopId ) === this._activeDesktopId,
		);
		if ( all.length === 0 ) {
			return false;
		}
		const allMinimized = all.every( ( w ) => w.state === 'minimized' );
		if ( allMinimized ) {
			for ( const win of all ) {
				try {
					win.restore();
				} catch {
					// see notes in restoreFrom.
				}
			}
			return false;
		}
		this.minimizeAll();
		return true;
	}

	// ---- Arrange + snap delegations ----

	public cascade(): void {
		cascade( this );
	}
	public tile(): void {
		tile( this );
	}
	public columns(): void {
		columns( this );
	}
	public focusLayout(): void {
		focusLayout( this );
	}
	public isSnapEnabled(): boolean {
		return this._snapEnabled;
	}
	public setSnapEnabled( enabled: boolean ): void {
		setSnapEnabled( this, enabled );
	}
	public getSnapConfig(): { enabled: boolean; cellWidth: number; cellHeight: number } {
		return getSnapConfig( this );
	}

	// ---- Overview delegations ----

	public enterOverview(): void {
		enterOverview( this );
	}
	public exitOverview( selected?: Window, maximize = false ): void {
		exitOverview( this, selected, maximize );
	}

	/**
	 * Release resources this instance owns outside its own DOM
	 * subtree: the document-level overview key handler and any
	 * pending overview transition timers. Removing `desktop` from the
	 * DOM does not reach either of those — a caller discarding a
	 * manager instance (tests; a future SPA-style unmount) that skips
	 * this leaves a real `setTimeout` to fire later and reach for
	 * globals that may already be gone, plus a `keydown` listener on
	 * `document` that keeps responding on behalf of a manager nothing
	 * else references.
	 *
	 * Safe to call unconditionally — a no-op when overview was never
	 * entered or was already cleanly exited.
	 */
	public destroy(): void {
		if ( this._overviewActive ) {
			exitOverview( this );
		}
		this.discardPrewarmed();
		cancelOverviewTimers( this );
		destroyDesktopNameHud();
	}

	/**
	 * Snapshot every open window's current geometry + state.
	 *
	 * Returns a plain array of `{ windowId, rect, state, element }`
	 * entries — one per window in the stack, regardless of which
	 * virtual desktop owns it. Rect coordinates are in desktop-area
	 * space (the same coordinate space the windows themselves use
	 * inline-style left/top); `state` is the live `WindowState`, and
	 * `element` is the window's outer DOM node.
	 *
	 * Intended for wallpaper / overlay plugins that used to scrape
	 * `document.querySelectorAll('.os-window')` + read the
	 * `--minimized` / `--maximized` modifier classes by name. The
	 * accessor decouples plugin code from the shell's CSS class
	 * naming, so a future refactor of modifier prefixes is not an
	 * ecosystem break.
	 *
	 * The array contains every window in the stack — callers filter
	 * on `state` if they want only "actually visible" (typically
	 * `state !== 'minimized'`). Minimized windows are included so
	 * plugins that care about the "will be restored to X geometry"
	 * case still have the data; filtering them out would be a
	 * subtraction the caller can do but the provider can't reverse.
	 *
	 * Order matches the internal z-stack: earliest-opened first,
	 * focused window last.
	 */
	public getVisibleRects(): VisibleWindowRect[] {
		return this._stack.map( ( w ) => {
			const snap = w.getSnapshot();
			return {
				windowId: w.id,
				rect: {
					x: snap.x,
					y: snap.y,
					width: snap.width,
					height: snap.height,
				},
				state: snap.state,
				element: w.element,
			};
		} );
	}

	/**
	 * Keep only what survives a round-trip through the session store.
	 *
	 * The snapshot is `JSON.stringify`d and POSTed, so a param holding
	 * a DOM node, a function or a cyclic object would take the whole
	 * save down with it — losing every window's geometry to one
	 * plugin's careless value. Drop the offender, keep the session.
	 *
	 * @param params Raw params off the window config.
	 * @return Serializable subset; `undefined` when nothing survives.
	 */
	private sanitizeParams(
		params: Record< string, unknown >,
	): Record< string, string | number | boolean > | undefined {
		const out: Record< string, string | number | boolean > = {};
		for ( const [ key, value ] of Object.entries( params ) ) {
			if (
				typeof value === 'string' ||
				typeof value === 'boolean' ||
				( typeof value === 'number' && Number.isFinite( value ) )
			) {
				out[ key ] = value;
			}
		}
		return Object.keys( out ).length > 0 ? out : undefined;
	}

	/**
	 * Serialize the current window stack for session persistence.
	 *
	 * Order in the returned `windows` array mirrors z-order (earliest
	 * opened / lowest-z first, focused last) so restoring preserves
	 * the stacking the user left behind.
	 */
	public snapshot(): Session {
		const focused = this.getFocused();
		// A native window's `render` callback is a JS closure and can't
		// be serialized — but it doesn't need to be. Every native
		// window that can be reopened is addressable by id through the
		// native-window registry (or the shell's own dispatcher for
		// built-ins like OS Settings), so the session persists the id
		// and the restore path reconstructs from there. Windows whose
		// id is no longer registered at restore time — a deactivated
		// plugin — are skipped by the opener.
		//
		// Ephemeral windows are the real opt-out: their URL doesn't
		// survive a session (editor-preview nonces), so they're skipped
		// from both the window list and the focused id.
		//
		// Child windows are skipped for a different reason: restoring
		// one is only safe if its owner comes back too, and owners can
		// fail to restore for reasons this side knows nothing about (a
		// deactivated plugin's native window, a URL that 404s now). A
		// restored child whose owner never arrived would sit there
		// blocking a window that does not exist. Losing a child across
		// a reload is the cheaper failure.
		const persistable = this._stack.filter(
			( w ) => ! w.config.ephemeral && ! w.config.parentWindowId,
		);
		const windows: SessionWindow[] = persistable.map( ( w ) => {
			const snap = w.getSnapshot();
			const externalTabs = w.getExternalTabsSnapshot();
			const native = !! w.config.native;
			// Read once into a local rather than narrowing
			// `w.config.params` and re-reading it inside a nested
			// closure: property narrowing that has to survive a
			// function boundary is a compile that works by accident.
			const openParams = w.config.params;
			const params =
				native && openParams
					? this.sanitizeParams( openParams )
					: null;
			return {
				id: w.id,
				baseId: w.config.baseId || w.id,
				desktopId: w.config.desktopId || this._activeDesktopId,
				...( native ? { native: true } : {} ),
				// Open-time arguments — what a native window is showing
				// this time. Without these a singleton native window
				// restores by id alone and comes back showing its default
				// (the profile editor on whoever is logged in), which
				// reads as the window silently changing subject.
				...( params ? { params } : {} ),
				// Native windows have no navigable URL — `config.url` is
				// the `#slug` marker they were opened with, and
				// `getCurrentUrl()` reads an iframe they don't have.
				url: native ? w.config.url || `#${ w.id }` : w.getCurrentUrl(),
				title: w.config.title,
				icon: w.config.icon,
				state: snap.state,
				x: snap.x,
				y: snap.y,
				width: snap.width,
				height: snap.height,
				...( externalTabs.length > 0 ? { externalTabs } : {} ),
			};
		} );
		// Same two exclusions as `persistable` — a focused id pointing
		// at a window that was never written to the snapshot restores
		// as "focus nothing", so it has to be filtered here too.
		const focusedId =
			focused &&
			! focused.config.ephemeral &&
			! focused.config.parentWindowId
				? focused.id
				: '';

		return {
			windows,
			desktops: this.getDesktops(),
			activeDesktop: this._activeDesktopId,
			focused: focusedId,
			// Epoch MILLISECONDS, not seconds. This is the ordering key
			// the server's stale-write guard compares, and at second
			// resolution the two writes that race hardest — a
			// `keepalive` fetch still on the wire and the `pagehide`
			// beacon that supersedes it — almost always tie. A tie is
			// accepted, so the loser is whichever the server happens to
			// process last, and a stale payload can reinstate a window
			// the user just closed. Milliseconds separate them.
			updated: Date.now(),
		};
	}

	/**
	 * Stage per-window config to merge into the NEXT window opened
	 * under each id, then forget it.
	 *
	 * Session restore needs this for native windows. A native window
	 * is reopened by asking its owner to open it —
	 * `nativeWindows.openById( id )`, or the shell's own
	 * `openOsSettings()` — and those callers build their own
	 * `manager.open()` config from the registry. There is no argument
	 * to thread saved geometry, desktop assignment, or minimized state
	 * through, and no reason for every opener to grow one: the
	 * restore-time values belong to the restore, not to the window's
	 * definition.
	 *
	 * Seeding them here inverts that — restore states what it wants
	 * before triggering the opens, and `createWindow` applies it to
	 * whichever window claims each id. Entries are consumed on first
	 * use, so a later user-initiated open of the same window is
	 * unaffected. Ids that never open (a plugin deactivated since the
	 * session was saved) simply leave a stale entry behind, which the
	 * next `seedWindowRestoreState` call clears.
	 *
	 * Call BEFORE the opens it should apply to.
	 */
	public seedWindowRestoreState(
		entries: Record< string, Partial< WindowConfig > >,
	): void {
		this._pendingRestoreState = new Map( Object.entries( entries ) );
	}

	public seedDesktops( desktops: Desktop[], activeDesktopId: string ): void {
		seedDesktops( this, desktops, activeDesktopId );
	}
}
