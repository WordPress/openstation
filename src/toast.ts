/**
 * Desktop Mode — Toast.
 *
 * Transient top-of-shell notification for shell-level events that
 * don't warrant a full dialog but should register with the user.
 * Used today when an external-link sub-tab's iframe is blocked by
 * `X-Frame-Options` / CSP and the shell has to fall back to opening
 * the URL in a real browser tab. Expected to pick up more callers
 * over time (save failures, shortcut reminders, etc.).
 *
 * Rendering lives in the `<wpd-toast-container>` + `<wpd-toast>`
 * web components under `src/ui/components/wpd-toast/`. This file
 * owns only the public `showToast()` API + the lifecycle (fade
 * in / stay / fade out / remove).
 *
 * @since 0.7.0
 */

import { activity } from './activity';
import './ui/components/wpd-toast/wpd-toast';

/** Default how-long-it-stays duration in ms. */
const DEFAULT_DURATION_MS = 4000;

/**
 * Fade-out transition duration in ms — keeps JS + CSS in sync.
 * Must match the `:host` transition on `<wpd-toast>`.
 */
const FADE_OUT_MS = 200;

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
	/** How long the toast stays visible, in milliseconds. */
	duration?: number;
}

/**
 * Toast intent payload routed through the
 * `wp-desktop/toast-requested` filter. Plugins can mutate the
 * fields, set `cancel: true` to suppress the render, or pass
 * through unchanged. Caller-supplied `meta` carries the
 * publishing app's context — useful for filters that want to
 * make policy decisions per-source ("ignore toasts from
 * messages while DND is on", etc.).
 *
 * @since 0.5.5
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
 * Routes through `wp-desktop/toast-requested` activity filter
 * before painting — plugins can register a filter that returns
 * `null` (or sets `cancel: true`) to suppress, or mutates the
 * payload to amplify / quiet the toast. Without a registered
 * filter the call passes through unchanged: zero-cost transparent
 * pipe.
 */
export function showToast( options: ToastOptions ): () => void {
	const intent: ToastIntent = activity.filter(
		'wp-desktop/toast-requested',
		{ ...options },
	) as ToastIntent;
	if ( ! intent || intent.cancel === true ) {
		return () => undefined;
	}

	const container = ensureContainer();
	const toast = document.createElement( 'wpd-toast' );
	toast.textContent = intent.message;

	if ( intent.action ) {
		toast.setAttribute( 'action', intent.action.label );
		toast.addEventListener( 'wpd-toast-action', () => {
			intent.action?.onClick();
			dismiss();
		} );
	}

	container.appendChild( toast );

	let dismissed = false;
	let dismissTimer: number | null = null;
	const dismiss = (): void => {
		if ( dismissed ) {
			return;
		}
		dismissed = true;
		if ( dismissTimer !== null ) {
			window.clearTimeout( dismissTimer );
			dismissTimer = null;
		}
		toast.setAttribute( 'state', 'out' );
		window.setTimeout( () => {
			toast.remove();
		}, FADE_OUT_MS );
	};

	// Enter animation — flip `state` to `'in'` on the next frame so
	// the browser has painted the initial (hidden) state first.
	requestAnimationFrame( () => {
		toast.setAttribute( 'state', 'in' );
	} );

	dismissTimer = window.setTimeout(
		dismiss,
		intent.duration ?? DEFAULT_DURATION_MS,
	) as unknown as number;

	// Fire-and-forget broadcast that a toast went up. Audit /
	// telemetry plugins subscribe; the toast renderer doesn't wait
	// for these handlers (publish is synchronous but consumers
	// shouldn't lean on that).
	activity.publish( 'wp-desktop/toast-shown', { ...intent } );

	return dismiss;
}

/**
 * Lazy-construct the shared container. Querying by tag name (vs
 * by class) keeps us aligned with how web components are
 * identified everywhere else in the codebase.
 */
function ensureContainer(): HTMLElement {
	const existing = document.querySelector<HTMLElement>(
		'wpd-toast-container',
	);
	if ( existing ) {
		return existing;
	}
	const el = document.createElement( 'wpd-toast-container' );
	document.body.appendChild( el );
	return el;
}
