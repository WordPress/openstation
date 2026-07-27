/**
 * Desktop Mode — Window Manager.
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
	seedDesktops,
	switchDesktop,
	type SwitchDesktopOptions,
} from './desktops';
import { cascade, tile } from './arrange';
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
import { cancelOverviewTimers, enterOverview, exitOverview } from './overview';
import { loadNativeWindowGeometry } from './native-window-geometry';
import { clampWindowPosition } from '../window/pointer';

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
 * carries the live desktop area dimensions so a filter can compute
 * "bottom-right corner" without touching the DOM.
 *
 * The two booleans capture the only useful distinctions a filter
 * actually cares about:
 *
 *   - `hasSavedGeometry`: the user previously dragged/resized this
 *     window and we just restored that layout. Plugins that want to
 *     "leave the user's layout alone" should bail when this is true.
 *   - `callerPinned`: the caller of `manager.open()` passed at least
 *     one of `{ x, y, width, height, initialState }` explicitly. For
 *     native windows registered via `desktop_mode_register_window()`
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
	 * The desktop area element where windows are rendered.
	 * @internal
	 */
	public _desktop: HTMLElement;

	/** Counter for cascade positioning. */
	private cascadeIndex = 0;

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
	 * decoupled from the public `wp.desktop.setDefaultWindow()` API
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

	// ---- Snap-zone state (edge-snap + split overview) ----

	/**
	 * Zone the cursor is currently hovering inside during a drag.
	 * Null when no snap is armed.
	 * @internal
	 */
	public _snapPendingZone: 'left' | 'right' | null = null;

	/**
	 * The translucent preview rectangle shown while a snap is armed.
	 * Lives inside `.desktop-mode-area`.
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
	 * its owning `.desktop-mode-window`, find the matching Window in
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
					'.desktop-mode-window',
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
	 * Also toggles `desktop-mode-window--reflowing` so the base
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
			if ( w.state === 'maximized' ) {
				w.element.classList.add( 'desktop-mode-window--reflowing' );
				w.element.style.width = `${ parent.clientWidth }px`;
				w.element.style.height = `${ parent.clientHeight }px`;
			} else if (
				w.state === 'snapped-left' ||
				w.state === 'snapped-right'
			) {
				w.element.classList.add( 'desktop-mode-window--reflowing' );
				const halfW = Math.floor( parent.clientWidth / 2 );
				const height = parent.clientHeight;
				const left = w.state === 'snapped-left' ? 0 : halfW;
				w.element.style.left = `${ left }px`;
				w.element.style.top = '0px';
				w.element.style.width = `${ halfW }px`;
				w.element.style.height = `${ height }px`;
			} else if ( w.state === 'normal' ) {
				const currentX = parseInt( w.element.style.left, 10 ) || 0;
				const currentY = parseInt( w.element.style.top, 10 ) || 0;
				const width = w.element.offsetWidth || 0;

				const safe = clampWindowPosition( currentX, currentY, width, parent.clientWidth, parent.clientHeight );

				if ( currentX !== safe.x || currentY !== safe.y ) {
					w.element.classList.add( 'desktop-mode-window--reflowing' );
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
				w.element.classList.remove( 'desktop-mode-window--reflowing' );
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
	 * `desktop-mode-window-reopened` event reports which path was
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
			// `wp.desktop.openWindow(id)` to "switch the window to
			// this state" — selecting a conversation, opening a file,
			// jumping to a tab. For NEW windows the render callback
			// runs and the seeded state lands on first paint; for
			// EXISTING windows there was no signal at all that an
			// open was requested. Plugins were forced to subscribe to
			// `desktop-mode-window-focused` and infer "open" from
			// "focus", which double-fires on every alt-tab and never
			// fires when the window is already focused. The reopen
			// event is the unambiguous "open requested while already
			// open" signal — fires exactly once per `open()` call on
			// an existing instance.
			const reopenedDetail = {
				windowId: existing.id,
				baseId,
				wasMinimized,
				navigated,
			};
			document.dispatchEvent(
				new CustomEvent( 'desktop-mode-window-reopened', { detail: reopenedDetail } ),
			);
			doAction( HOOKS.WINDOW_REOPENED, reopenedDetail );
			return existing;
		}

		// No instance on the current desktop. If any instance is open
		// on another desktop, the bare `baseId` is taken — pick the
		// next free suffix so DOM ids stay unique. Otherwise use the
		// caller-supplied id as-is (plain `plugins-php`, `edit-php`,
		// etc.).
		const id = this.getByBaseId( baseId )
			? this.nextInstanceId( baseId )
			: config.id;
		return this.createWindow( { ...config, id, baseId } );
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
	 */
	public async openNew(
		config: Partial<WindowConfig> & { id: string; url: string; title: string },
	): Promise< Window > {
		const baseId = config.baseId || config.id;
		const nextId = this.nextInstanceId( baseId );
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
	): Promise< Window > {
		const desktopRect = this._desktop.getBoundingClientRect();
		const defaultWidth = Math.min( Math.round( desktopRect.width * 0.8 ), 1200 );
		const defaultHeight = Math.min( Math.round( desktopRect.height * 0.8 ), 800 );
		const cascadeX = 40 + ( this.cascadeIndex % 8 ) * CASCADE_OFFSET;
		const cascadeY = 40 + ( this.cascadeIndex % 8 ) * CASCADE_OFFSET;

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
		const resolvedWidth =
			config.width ??
			( saved ? Math.max( saved.width, minWidth ) : defaultWidth );
		const resolvedHeight =
			config.height ??
			( saved ? Math.max( saved.height, minHeight ) : defaultHeight );
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
			const margin = 12;
			const maxX = Math.max(
				0,
				desktopRect.width - resolvedWidth - margin,
			);
			const maxY = Math.max(
				0,
				desktopRect.height - resolvedHeight - margin,
			);
			clampedSavedX = Math.max( margin, Math.min( saved.x, maxX ) );
			clampedSavedY = Math.max( margin, Math.min( saved.y, maxY ) );
		}
		const resolvedX = config.x ?? clampedSavedX ?? cascadeX;
		const resolvedY = config.y ?? clampedSavedY ?? cascadeY;

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
					`[desktop-mode] WINDOW_GEOMETRY filter threw for "${ config.id }":`,
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
		//      component classes (`<wpd-window-button>`,
		//      `<wpd-menu>`, `<wpd-tab-chip>`, `<wpd-save-status>`,
		//      `<wpd-spinner>`). Without these the constructor's
		//      `createElement( 'wpd-window-button' )` calls
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

		win.onFocusRequest = ( w: Window ) => this.focus( w );
		win.onClose = ( w: Window ) => this.remove( w );
		win.onMinimize = () => {
			const visible = this._stack.filter( ( w ) => w.state !== 'minimized' );
			if ( visible.length > 0 ) {
				this.focus( visible[ visible.length - 1 ] );
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
						desktop?: {
							openNewWindow?: (
								id: string,
								opts?: { source?: string },
							) => boolean;
						};
					};
				} ).wp?.desktop;
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
						desktop?: {
							openNewWindow?: (
								id: string,
								opts?: { source?: string },
							) => boolean;
						};
					};
				} ).wp?.desktop;
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
		// (`wp.desktop.setDefaultWindow`), injected via
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

		this._stack.push( win );
		this._desktop.appendChild( win.element );
		applyDesktopVisibility( this, win );

		// Hydrate native windows AFTER mount. The plugin's render
		// callback receives a body that's already connected to the
		// document, so any `<wpd-*>` custom element the plugin
		// creates or populates via declarative setters upgrades
		// synchronously (HTML spec: elements upgrade on connection).
		// Calling before mount would leave the body detached,
		// which made `element.items = […]` stash an own data
		// property on the pre-upgrade instance that shadowed the
		// class setter after upgrade — empty `<wpd-select>`s in
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
			new CustomEvent( 'desktop-mode-window-opened', { detail: openedDetail } ),
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

	/** Focus a window: bring it to top of z-stack. */
	public focus( win: Window ): void {
		// Capture the previously-focused window BEFORE the splice/push
		// changes the stack — needed so we can fire `WINDOW_BLURRED`
		// for it. No-op when this `focus()` is hitting the already-
		// top window (alt-tab to self) since blur+focus on the same
		// id is misleading.
		const previouslyFocused =
			this._stack.length > 0 ? this._stack[ this._stack.length - 1 ] : null;

		// A fullscreen window pins itself above all other windows via
		// `z-index: var(--desktop-mode-z-fullscreen)`, so any newly-
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
				new CustomEvent( 'desktop-mode-window-blurred', { detail: blurredDetail } ),
			);
			doAction( HOOKS.WINDOW_BLURRED, blurredDetail );
		}

		// Dispatch custom event + action for the newly-focused window.
		const focusedDetail = { windowId: win.id };
		document.dispatchEvent(
			new CustomEvent( 'desktop-mode-window-focused', { detail: focusedDetail } ),
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
		this._stack.forEach( ( w, i ) => {
			w.setZIndex( BASE_Z_INDEX + i );
		} );
	}

	/** Remove a window from the stack and DOM. */
	private remove( win: Window ): void {
		const idx = this._stack.indexOf( win );
		if ( idx > -1 ) {
			this._stack.splice( idx, 1 );
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
		for ( let i = this._stack.length - 1; i >= 0; i-- ) {
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
			new CustomEvent( 'desktop-mode-window-closing', { detail: closingDetail } ),
		);
		doAction( HOOKS.WINDOW_CLOSING, closingDetail );

		// `closed` still fires here (not after the fade-out) for
		// back-compat — historically subscribers have relied on it
		// to update counts / dock state as soon as the user
		// clicks the X. Keep that timing; plugins that need the live
		// element now have `closing` above.
		const closedDetail = { windowId: win.id };
		document.dispatchEvent(
			new CustomEvent( 'desktop-mode-window-closed', { detail: closedDetail } ),
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

	/**
	 * Returns the "primary" desktop id — the one new sessions land on
	 * and that batch operations like {@link closeAll} treat as the
	 * survivor when an `onlyOnPrimary` mode is requested.
	 *
	 * Default: the first desktop in `getDesktops()`. Filterable via
	 * `desktop-mode.primary-desktop-id` so downstream code that wants a
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
	 *   1. `desktop-mode.windows.before-close-all` — action. Subscribers
	 *      can prepare for the wipe (cancel pending saves, dismiss
	 *      menus, etc.). Detail: `{ candidates: Window[] }`.
	 *
	 *   2. `desktop-mode.windows.close-all` — filter. Receives the
	 *      candidate Window list and returns the (possibly smaller) list
	 *      that will actually be closed. Plugins use this to PROTECT
	 *      specific windows — e.g. keep a draft post window open during
	 *      a "Close all" operation. Returning an empty array cancels
	 *      the close entirely.
	 *
	 *   3. Each surviving window's `close()` is called.
	 *
	 *   4. `desktop-mode.windows.after-close-all` — action. Detail:
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
						'[desktop-mode] closeAll: window.close() threw for',
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
						'[desktop-mode] minimizeAll: window.minimize() threw for',
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
						'[desktop-mode] restoreFrom: window.restore() threw for',
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
		cancelOverviewTimers( this );
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
	 * `document.querySelectorAll('.desktop-mode-window')` + read the
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
	 * Serialize the current window stack for session persistence.
	 *
	 * Order in the returned `windows` array mirrors z-order (earliest
	 * opened / lowest-z first, focused last) so restoring preserves
	 * the stacking the user left behind.
	 */
	public snapshot(): Session {
		const focused = this.getFocused();
		// Native windows aren't persistable — their `render` callback
		// is a JS closure, not something we can serialize and
		// rehydrate server-side. Ephemeral windows opt out — their URL
		// doesn't survive a session (editor-preview nonces). Skip both
		// from the window list and the focused id so a freshly booted
		// shell doesn't try (and fail) to restore a window it can't
		// reconstruct.
		const persistable = this._stack.filter(
			( w ) => ! w.config.native && ! w.config.ephemeral,
		);
		const windows: SessionWindow[] = persistable.map( ( w ) => {
			const snap = w.getSnapshot();
			const externalTabs = w.getExternalTabsSnapshot();
			return {
				id: w.id,
				baseId: w.config.baseId || w.id,
				desktopId: w.config.desktopId || this._activeDesktopId,
				url: w.getCurrentUrl(),
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
		const focusedId =
			focused && ! focused.config.native && ! focused.config.ephemeral
				? focused.id
				: '';

		return {
			windows,
			desktops: this.getDesktops(),
			activeDesktop: this._activeDesktopId,
			focused: focusedId,
			updated: Math.floor( Date.now() / 1000 ),
		};
	}

	public seedDesktops( desktops: Desktop[], activeDesktopId: string ): void {
		seedDesktops( this, desktops, activeDesktopId );
	}
}
