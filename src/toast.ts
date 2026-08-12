/**
 * OpenStation — Toast.
 *
 * Transient top-of-shell notification for shell-level events that
 * don't warrant a full dialog but should register with the user.
 * Used today when an external-link sub-tab's iframe is blocked by
 * `X-Frame-Options` / CSP and the shell has to fall back to opening
 * the URL in a real browser tab. Expected to pick up more callers
 * over time (save failures, shortcut reminders, etc.).
 *
 * Rendering lives in the `<os-toast-container>` + `<os-toast>`
 * web components under `src/ui/components/os-toast/`. As of
 * 0.8.4 those classes ship in the lazy `shell-overlays[.min].js`
 * bundle, not in main — `desktop.ts` pre-loads that bundle after
 * first paint, and this file's `showToast()` awaits the loader
 * before constructing the elements. The public API stays
 * synchronous (still returns a dismiss callback) so callers don't
 * change.
 *
 * `duration` is a countdown rather than a deadline: it only runs
 * while the toast is unattended. The element reports pointer-over
 * and focus-inside as a `held` state (see `<os-toast>`), and this
 * module pauses on it — an action button cannot be deleted out from
 * under the hand reaching for it. The matching half is focus
 * custody, below: a dismissal that takes focus with it hands focus
 * back rather than leaving it on `<body>`.
 */

import { activity } from './activity';
import { openWithShellOverlays } from './shell-overlays/loader';

/** Default how-long-it-stays duration in ms. */
const DEFAULT_DURATION_MS = 4000;

/**
 * Fade-out transition duration in ms — keeps JS + CSS in sync.
 * Must match the `:host` transition on `<os-toast>`.
 */
const FADE_OUT_MS = 200;

/**
 * Floor on the countdown handed back when a hold releases.
 *
 * A toast that was one tick from expiring when the pointer arrived
 * would otherwise vanish the instant the pointer leaves, which reads
 * as the toast reacting to the user leaving rather than to its own
 * clock. Give it a moment on the way out either way.
 */
const MIN_RESUME_MS = 1200;

export interface ToastOptions {
	/** Short human-readable message. */
	message: string;
	/**
	 * Optional secondary action — when set, renders a clickable
	 * button at the toast's right edge. Great for "Retry", "Open
	 * in new tab", "Undo" affordances. Clicking fires the callback
	 * and dismisses the toast.
	 */
	action?: {
		label: string;
		onClick: () => void;
	};
	/**
	 * How long the toast stays visible, in milliseconds. Ignored
	 * when {@link ToastOptions.persistent} is `true`.
	 */
	duration?: number;
	/**
	 * When `true`, the toast never auto-dismisses — it stays until the
	 * action button is clicked or the returned dismiss function is
	 * called. Overrides `duration`.
	 */
	persistent?: boolean;
	/**
	 * When `true`, renders a close (×) button that dismisses the toast.
	 * Pair it with `persistent` so the user has a way to close a toast
	 * that would otherwise never leave.
	 */
	dismissible?: boolean;
	/**
	 * Called when the user dismisses the toast via the close button —
	 * e.g. to persist the dismissal so it doesn't reappear.
	 */
	onDismiss?: () => void;
}

/**
 * Toast intent payload routed through the
 * `os/toast-requested` filter. Plugins can mutate the
 * fields, set `cancel: true` to suppress the render, or pass
 * through unchanged. Caller-supplied `meta` carries the
 * publishing app's context — useful for filters that want to
 * make policy decisions per-source ("ignore toasts from
 * messages while DND is on", etc.).
 */
export interface ToastIntent extends ToastOptions {
	/**
	 * Originating app id, for filter scoping. Conventional
	 * value: the plugin's Vite bundle / module slug.
	 */
	source?: string;
	/**
	 * Free-form context the publishing app attaches; filters
	 * can read but should not require any specific shape.
	 */
	meta?: Record< string, unknown >;
	/** Filter sets this to `true` to suppress the render. */
	cancel?: boolean;
}

/**
 * Show a toast. Returns a dismiss callback the caller can invoke
 * early (e.g., when the state the toast was reporting changes).
 *
 * Routes through `os/toast-requested` activity filter
 * before painting — plugins can register a filter that returns
 * `null` (or sets `cancel: true`) to suppress, or mutates the
 * payload to amplify / quiet the toast. Without a registered
 * filter the call passes through unchanged: zero-cost transparent
 * pipe.
 */
export function showToast( options: ToastOptions ): () => void {
	const intent: ToastIntent = activity.filter(
		'os/toast-requested',
		{ ...options },
	) as ToastIntent;
	if ( ! intent || intent.cancel === true ) {
		return () => undefined;
	}

	// The toast element classes live in the lazy
	// `shell-overlays[.min].js` bundle. The shell pre-loads it
	// after first paint so in steady state this path is
	// synchronous (via `openWithShellOverlays`'s fast path). If
	// `showToast()` fires before the preload completes (rare —
	// boot-time callers), the actual render is deferred behind
	// the load and `dismissRequested` honours an early dismiss.
	let dismissRequested = false;
	let realDismiss: ( () => void ) | null = null;

	openWithShellOverlays(
		() => ! dismissRequested,
		() => {
			realDismiss = renderToast( intent );
		},
	);

	return () => {
		dismissRequested = true;
		if ( realDismiss ) {
			realDismiss();
		}
	};
}

/**
 * Construct + mount the toast element. Pre-condition: the
 * `<os-toast>` / `<os-toast-container>` custom elements are
 * already registered (the lazy bundle has loaded).
 */
function renderToast( intent: ToastIntent ): () => void {
	const container = ensureContainer();
	const toast = document.createElement( 'os-toast' );
	toast.textContent = intent.message;

	if ( intent.action ) {
		toast.setAttribute( 'action', intent.action.label );
		toast.addEventListener( 'os-toast-action', () => {
			intent.action?.onClick();
			dismiss();
		} );
	}

	if ( intent.dismissible ) {
		toast.setAttribute( 'dismissible', '' );
		toast.addEventListener( 'os-toast-dismiss', () => {
			intent.onDismiss?.();
			dismiss();
		} );
	}

	container.appendChild( toast );

	let dismissed = false;
	let dismissTimer: number | null = null;
	/** Countdown left to run. Decremented as each stretch is paused. */
	let remaining = intent.duration ?? DEFAULT_DURATION_MS;
	/** When the running stretch started, so a pause can measure it. */
	let startedAt = 0;

	const stopTimer = (): void => {
		if ( dismissTimer === null ) {
			return;
		}
		window.clearTimeout( dismissTimer );
		dismissTimer = null;
	};

	const dismiss = (): void => {
		if ( dismissed ) {
			return;
		}
		dismissed = true;
		stopTimer();
		// While the toast still exists — once it is gone the browser
		// has already dropped focus on `<body>` and there is nothing
		// left to hand back.
		restoreFocusFrom( toast );
		toast.setAttribute( 'state', 'out' );
		window.setTimeout( () => {
			toast.remove();
			releaseFocusTracking();
		}, FADE_OUT_MS );
	};

	const startTimer = (): void => {
		if ( dismissed || intent.persistent || dismissTimer !== null ) {
			return;
		}
		startedAt = Date.now();
		dismissTimer = window.setTimeout(
			dismiss,
			remaining,
		) as unknown as number;
	};

	const pauseTimer = (): void => {
		if ( dismissTimer === null ) {
			return;
		}
		remaining = Math.max( 0, remaining - ( Date.now() - startedAt ) );
		stopTimer();
	};

	// Enter animation — flip `state` to `'in'` on the next frame so
	// the browser has painted the initial (hidden) state first.
	requestAnimationFrame( () => {
		toast.setAttribute( 'state', 'in' );
	} );

	/*
	 * Pointer over the toast, or focus inside it, freezes the
	 * countdown — the element decides what "attended to" means and
	 * says so; this side owns the clock. Without it, a toast whose
	 * action button the user has Tabbed to deletes itself out from
	 * under them mid-reach, and focus lands on `<body>`.
	 */
	toast.addEventListener( 'os-toast-hold', ( e: Event ) => {
		const held = ( e as CustomEvent< { held: boolean } > ).detail?.held;
		if ( held ) {
			pauseTimer();
			return;
		}
		remaining = Math.max( remaining, MIN_RESUME_MS );
		startTimer();
	} );

	trackExternalFocus( toast );
	startTimer();

	// Fire-and-forget broadcast that a toast went up. Audit /
	// telemetry plugins subscribe; the toast renderer doesn't wait
	// for these handlers (publish is synchronous but consumers
	// shouldn't lean on that).
	activity.publish( 'os/toast-shown', { ...intent } );

	return dismiss;
}

// ---------------------------------------------------------------------
// Focus custody
//
// A toast is the one piece of shell UI that removes itself while the
// user may be standing on it. Clicking "Undo" — or Tabbing to it and
// pressing Enter — dismisses the toast the button lives in, and the
// browser's answer to "where does focus go when its element leaves the
// document?" is `<body>`: the next Tab starts from the top of the
// admin, and a screen-reader user loses their place entirely.
//
// So while any toast is on screen we remember the last thing outside
// the stack that held focus, and a dismissal that happens to be
// holding focus hands it back there. The listener is only bound while
// toasts exist — this runs on every focus change in the shell, and a
// permanently-bound one would be a tax on a surface that is empty
// almost all the time.
// ---------------------------------------------------------------------

/** Last focused element outside the toast stack. */
let lastExternalFocus: HTMLElement | null = null;

/** Toasts currently keeping the tracker bound. */
let focusTrackers = 0;

function onDocumentFocusIn( e: FocusEvent ): void {
	const target = e.target;
	if ( ! ( target instanceof HTMLElement ) ) {
		return;
	}
	if ( target.closest( 'os-toast-container' ) ) {
		return;
	}
	lastExternalFocus = target;
}

function trackExternalFocus( toast: HTMLElement ): void {
	if ( focusTrackers === 0 ) {
		document.addEventListener( 'focusin', onDocumentFocusIn, true );
	}
	focusTrackers += 1;
	// Seed from the current position: focus may not move again between
	// here and the dismissal, and that stationary case is exactly the
	// one where the user clicked the action button straight away.
	const doc = toast.ownerDocument;
	const active = doc.activeElement;
	if (
		active instanceof HTMLElement &&
		active !== doc.body &&
		! active.closest( 'os-toast-container' )
	) {
		lastExternalFocus = active;
	}
}

function releaseFocusTracking(): void {
	focusTrackers = Math.max( 0, focusTrackers - 1 );
	if ( focusTrackers === 0 ) {
		document.removeEventListener( 'focusin', onDocumentFocusIn, true );
	}
}

/**
 * Hand focus back if the toast being dismissed is holding it. A
 * dismissal that happens while the user is somewhere else entirely
 * leaves them there.
 */
function restoreFocusFrom( toast: HTMLElement ): void {
	// The toast's controls live in its shadow root, so focus on the
	// action button reads as the host here — no shadow walk needed.
	const active = toast.ownerDocument.activeElement;
	if ( active !== toast && ! toast.contains( active ) ) {
		return;
	}
	if ( lastExternalFocus?.isConnected === true ) {
		lastExternalFocus.focus();
	}
}

/**
 * Lazy-construct the shared container. Querying by tag name (vs
 * by class) keeps us aligned with how web components are
 * identified everywhere else in the codebase.
 */
function ensureContainer(): HTMLElement {
	const existing = document.querySelector<HTMLElement>(
		'os-toast-container',
	);
	if ( existing ) {
		return existing;
	}
	const el = document.createElement( 'os-toast-container' );
	document.body.appendChild( el );
	return el;
}
