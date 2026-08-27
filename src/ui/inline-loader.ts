/**
 * OpenStation — in-place loading affordance for a lazy mount point.
 *
 * Windows already have one: `src/window/loading.ts` paints an overlay
 * between `markWindowContentLoading()` and `markWindowContentReady()`.
 * This is the same idea for the surfaces that are not windows — a
 * widget card whose bundle is still in flight, a panel body waiting on
 * a sibling bundle — where the alternative was an empty box that looks
 * indistinguishable from a broken one.
 *
 * ## Three behaviours worth knowing
 *
 * **It waits before it paints.** A load that resolves in 40 ms should
 * not flash a spinner; a spinner that appears and vanishes reads as a
 * glitch, not as progress. {@link SHOW_DELAY_MS} matches the window
 * overlay's delay so both affordances feel like one system.
 *
 * **It reports failure.** A lazy load that rejects used to leave the
 * container empty forever with a line in the console — indistinguishable
 * from "still loading" and from "this feature is broken", which is the
 * worst place for a user to be left. {@link InlineLoader.fail} swaps the
 * spinner for a short message and, when a retry is offered, a button.
 *
 * **The spinner is `<os-spinner>` when that will upgrade, and inline
 * markup when it will not.** The component ships in the lazy
 * `shell-overlays` bundle, which `desktop.ts` preloads right after
 * first paint — so in any booted shell the tag is registered and this
 * costs nothing extra. But a widget can mount during boot, before that
 * bundle lands, and an `<os-spinner>` there would be an inert unknown
 * element for exactly the window this module exists to cover. The
 * check is a `customElements.get()` registry lookup, never a fetch:
 * awaiting another bundle in order to say "please wait" is
 * self-defeating, which is the lesson `ai-assistant/loading-placeholder`
 * already records.
 */

import { __ } from '../i18n';

/**
 * How long a load may run before the affordance paints.
 *
 * Mirrors `LOADING_OVERLAY_SHOW_DELAY_MS` in `src/window/constants.ts`.
 * Deliberately duplicated rather than imported: that constant belongs to
 * the window overlay's own timing contract, and coupling a widget card
 * to it would mean a change tuned for windows silently retimes
 * everything else.
 */
export const SHOW_DELAY_MS = 120;

/** The class every element this module creates carries. */
const ROOT_CLASS = 'os-inline-loader';

/** Injected once, and only when the fallback spinner is actually used. */
const KEYFRAMES_ID = 'os-inline-loader-keyframes';

/** Options for {@link showInlineLoader}. */
export interface InlineLoaderOptions {
	/**
	 * Visible, announced status text. Keep it specific — "Loading
	 * settings…" tells the user more than "Loading…" when several
	 * things on screen could be the thing that is late.
	 */
	label?: string;
	/**
	 * Skip the show delay and paint immediately. For a load already
	 * known to be slow (a game bundle plus its engine), where the delay
	 * only adds dead time.
	 */
	immediate?: boolean;
}

/** Handle returned by {@link showInlineLoader}. */
export interface InlineLoader {
	/**
	 * Remove the affordance. Idempotent, and safe to call when the
	 * spinner never painted — the pending timer is cancelled too.
	 */
	done: () => void;
	/**
	 * Replace the spinner with an error state. Idempotent.
	 *
	 * @param message Short human-readable cause.
	 * @param retry   When given, renders a retry control that invokes
	 *                it and clears the error.
	 */
	fail: ( message: string, retry?: () => void ) => void;
}

/** Whether `<os-spinner>` will upgrade if we create one right now. */
function spinnerWillUpgrade(): boolean {
	return (
		typeof customElements !== 'undefined' &&
		!! customElements.get( 'os-spinner' )
	);
}

/** Injects the fallback spin keyframes once; skipped under reduced motion. */
function ensureKeyframes(): void {
	if ( document.getElementById( KEYFRAMES_ID ) ) {
		return;
	}
	const style = document.createElement( 'style' );
	style.id = KEYFRAMES_ID;
	style.textContent =
		'@keyframes os-inline-loader-spin{to{transform:rotate(360deg)}}';
	document.head.appendChild( style );
}

/**
 * The spinning mark: the real component when it will upgrade, a bare
 * inline-styled arc when it will not.
 *
 * The fallback is styled inline rather than by class for the same
 * reason the palette placeholder is — the stylesheet that would carry
 * the class may itself be one of the things still loading.
 */
function buildSpinner(): HTMLElement {
	if ( spinnerWillUpgrade() ) {
		const spinner = document.createElement( 'os-spinner' );
		// `inline` is the bare arc with no WordPress mark, sized for
		// text-adjacent use — right for a card or a panel body, where
		// the full mark at window-overlay scale would dominate the very
		// content it is standing in for.
		spinner.setAttribute( 'preset', 'inline' );
		spinner.setAttribute( 'size', '20' );
		// The wrapper below owns the announcement; a second label here
		// would have a screen reader read the status twice.
		spinner.setAttribute( 'aria-hidden', 'true' );
		return spinner;
	}

	const arc = document.createElement( 'span' );
	arc.setAttribute( 'aria-hidden', 'true' );
	arc.style.cssText = [
		'flex:0 0 auto',
		'width:16px',
		'height:16px',
		'border-radius:50%',
		'border:2px solid currentColor',
		'border-top-color:transparent',
		'opacity:0.7',
	].join( ';' );
	const reduceMotion =
		typeof window.matchMedia === 'function' &&
		window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches;
	if ( ! reduceMotion ) {
		ensureKeyframes();
		arc.style.animation = 'os-inline-loader-spin 0.7s linear infinite';
	}
	return arc;
}

/**
 * Paint a loading affordance inside `container` and return the handle
 * that clears it.
 *
 * The affordance is appended, never assigned over `innerHTML`: a caller
 * that has already painted static markup (a widget's template, a
 * panel's header) keeps it, and the spinner sits alongside.
 *
 * @param container Element to mount into.
 * @param options   See {@link InlineLoaderOptions}.
 * @return Handle with {@link InlineLoader.done} / {@link InlineLoader.fail}.
 */
export function showInlineLoader(
	container: HTMLElement,
	options: InlineLoaderOptions = {},
): InlineLoader {
	const label = options.label ?? __( 'Loading…' );
	let root: HTMLElement | null = null;
	let settled = false;

	const paint = (): void => {
		if ( settled || root || ! container.isConnected ) {
			return;
		}
		root = document.createElement( 'div' );
		root.className = ROOT_CLASS;
		// `role="status"` + polite: a transient progress report, not
		// something to move focus to. Being a live region it also stays
		// silent for loads fast enough that this never paints.
		root.setAttribute( 'role', 'status' );
		root.setAttribute( 'aria-live', 'polite' );
		root.style.cssText = [
			'display:flex',
			'align-items:center',
			'justify-content:center',
			'gap:10px',
			'padding:20px 16px',
			'font-size:13px',
			'color:var(--os-ui-fg-muted,#646970)',
		].join( ';' );

		const text = document.createElement( 'span' );
		text.textContent = label;

		root.appendChild( buildSpinner() );
		root.appendChild( text );
		container.appendChild( root );
	};

	const timer = options.immediate
		? null
		: window.setTimeout( paint, SHOW_DELAY_MS );
	if ( options.immediate ) {
		paint();
	}

	const clearTimer = (): void => {
		if ( null !== timer ) {
			window.clearTimeout( timer );
		}
	};

	return {
		done: () => {
			if ( settled ) {
				return;
			}
			settled = true;
			clearTimer();
			root?.remove();
			root = null;
		},
		fail: ( message: string, retry?: () => void ) => {
			if ( settled ) {
				return;
			}
			settled = true;
			clearTimer();
			// An error has to paint whether or not the spinner ever did:
			// the load is over, and silence here is the blank-forever
			// state this module exists to remove.
			if ( ! root ) {
				settled = false;
				paint();
				settled = true;
			}
			if ( ! root ) {
				return;
			}
			root.textContent = '';
			// Assertive: unlike progress, a failure is worth
			// interrupting for — the user is waiting on something that
			// is not coming.
			root.setAttribute( 'aria-live', 'assertive' );
			root.style.flexDirection = 'column';
			root.style.color = 'var(--os-ui-fg-muted,#646970)';

			const text = document.createElement( 'span' );
			text.textContent = message;
			root.appendChild( text );

			if ( retry ) {
				const button = document.createElement( 'button' );
				button.type = 'button';
				button.textContent = __( 'Retry' );
				button.className = 'button button-small';
				button.addEventListener( 'click', () => {
					root?.remove();
					root = null;
					settled = false;
					retry();
				} );
				root.appendChild( button );
			}
		},
	};
}
