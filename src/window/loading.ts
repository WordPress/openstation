/**
 * Window loading-state transitions — wires the framework's
 * loading hooks to the on-screen DOM. The actual hook firing
 * lives in {@link markWindowContentLoading} /
 * {@link markWindowContentReady} (`src/window-channels.ts`); this
 * module is only the visual side: toggle the
 * `os-window__body--loading` modifier, attach / detach
 * the spinner overlay, and swallow strays from windows that have
 * already torn down.
 *
 * ## The loading indicator never shares the screen with content
 *
 * Two rules, both enforced here:
 *
 *   - A spinner that never became visible (the load finished inside
 *     `LOADING_OVERLAY_SHOW_DELAY_MS`) is removed in the same tick the
 *     content is uncovered. There is nothing to fade.
 *   - A spinner that DID paint gets its fade-out to itself: the
 *     `--loading-out` modifier holds the content transparent for that
 *     span and then fades it in, so the two never overlap.
 *
 * A single global `addAction` per edge (loading + loaded) reads
 * the window id from the payload and looks up the element via
 * the canonical `id="wp-window-${ id }"` attribute. Per-window
 * subscriptions would over-subscribe with no benefit — the
 * payload-id pattern matches the rest of the shell (see the
 * connection-cleanup / iframe-ready subscriptions in
 * `src/desktop.ts`).
 */

import { HOOKS, addAction } from './../hooks';
import { armWindowReveal, playWindowReveal } from '../reveals/surface';
import {
	LOADING_CONTENT_FADE_IN_MS,
	LOADING_OVERLAY_FADE_OUT_MS,
} from './constants';
import {
	ensureLoadingOverlay,
	LOADING_BODY_CLASS,
	LOADING_HANDOFF_BODY_CLASS,
	LOADING_OVERLAY_VISIBLE_CLASS,
	LOADING_STARTED_ATTR,
	removeLoadingOverlay,
	stampLoadingStart,
} from './dom';

/**
 * Duration of the body-content fade-out before the overlay element is
 * removed from the DOM. Shared with the reveal surface, which waits the
 * same span before it starts receding.
 *
 * @internal
 */
const FADE_OUT_MS = LOADING_OVERLAY_FADE_OUT_MS;

let _installed = false;

/**
 * Resolve a window's outer element by id. Returns `null` when
 * the window has already been torn down (e.g. a content-loaded
 * fire that landed after a fast close) — callers should treat
 * `null` as a benign no-op.
 *
 * @internal
 */
function findWindowElement( windowId: string ): HTMLElement | null {
	if ( ! windowId ) {
		return null;
	}
	return document.getElementById( `wp-window-${ windowId }` );
}

/**
 * Install the global loading-state subscriptions. Idempotent —
 * called once from the shell boot in `desktop.ts`. Nothing
 * happens if the hook bus isn't available; the typed
 * `addAction` wrapper throws in that case and the boot will
 * surface the error.
 *
 * @public
 */
export function installWindowLoadingTransitions(): void {
	if ( _installed ) {
		return;
	}
	_installed = true;
	_installSubscriptions();
}

/**
 * Test-only reset — drops the install latch so the next call to
 * {@link installWindowLoadingTransitions} re-registers fresh
 * subscriptions. Real shell code never calls this; tests that
 * swap the `wp.hooks` stub between cases need it because the
 * stub reset wipes the previous registrations.
 *
 * @internal
 */
export function _resetWindowLoadingTransitionsForTests(): void {
	_installed = false;
}

function _installSubscriptions(): void {
	addAction(
		HOOKS.WINDOW_CONTENT_LOADING,
		'desktop-mode/window-loading-enter',
		( e: { windowId?: string } ) => {
			const el = findWindowElement( e?.windowId ?? '' );
			if ( ! el ) {
				return;
			}
			const body = el.querySelector< HTMLElement >(
				':scope .os-window__body',
			);
			if ( ! body ) {
				return;
			}
			// A re-arm cancels any hand-off still running from the
			// previous load — the content is about to be covered
			// again, so a delayed fade-in of it is stale.
			body.classList.remove( LOADING_HANDOFF_BODY_CLASS );
			body.classList.add( LOADING_BODY_CLASS );
			// Stamp before painting: `ensureLoadingOverlay` reads the
			// clock to decide how much of the show delay is left.
			stampLoadingStart( body );
			ensureLoadingOverlay( el );
			// Re-arm the reveal surface. The FIRST arm happens in
			// `createWindowElement`, because the construction-time
			// `markWindowContentLoading()` fires before the window is in
			// the document and `findWindowElement` above cannot see it
			// yet. This edge covers every subsequent load — reload,
			// in-window navigation, tab switch.
			armWindowReveal( el );
		},
	);

	addAction(
		HOOKS.WINDOW_CONTENT_LOADED,
		'desktop-mode/window-loading-exit',
		( e: { windowId?: string } ) => {
			const el = findWindowElement( e?.windowId ?? '' );
			if ( ! el ) {
				return;
			}
			const body = el.querySelector< HTMLElement >(
				':scope .os-window__body',
			);
			if ( ! body ) {
				return;
			}
			// Whether there is anything on screen to fade. An overlay
			// that never reached the `--visible` modifier is a
			// zero-opacity element: fading it out would be 250 ms of
			// nothing, and letting the content paint underneath it in
			// the meantime is what put a half-faded spinner over
			// finished text on every fast open.
			const spinnerWasVisible = !! body
				.querySelector( ':scope .os-window__loading' )
				?.classList.contains( LOADING_OVERLAY_VISIBLE_CLASS );

			body.classList.remove( LOADING_BODY_CLASS );
			body.removeAttribute( LOADING_STARTED_ATTR );

			if ( ! spinnerWasVisible ) {
				// Nothing painted, nothing to sequence: drop the
				// overlay in the same tick so it can never be on
				// screen at the same time as the content it covers.
				removeLoadingOverlay( el );
				// Same-tick reveal — see the note below; it applies to
				// both branches.
				playWindowReveal( el );
				return;
			}

			// The spinner is on screen. Hold the content transparent
			// for the length of the overlay's fade-out, then fade it
			// in — the two transitions run back to back rather than on
			// top of each other. The CSS rule for this modifier owns
			// both the hold and the fade.
			body.classList.add( LOADING_HANDOFF_BODY_CLASS );
			// Start the reveal in the SAME tick the loading modifier is
			// dropped. `playWindowReveal` adds the `--revealing` class,
			// whose rule pins the content to full opacity with no
			// transition — deferring it by even a frame would let the
			// body's normal 250 ms content fade start first and show a
			// half-transparent strip along the reveal's leading edge.
			playWindowReveal( el );
			// Defer the overlay removal until the CSS fade-out has
			// settled. Without this, the overlay disappears on the
			// same frame the modifier flips off and the spinner
			// pops out of view instead of fading.
			window.setTimeout( () => {
				// Re-check the DOM — the user might have triggered
				// `markContentLoading()` again in the interim, in
				// which case the overlay should stay.
				if ( ! body.classList.contains( LOADING_BODY_CLASS ) ) {
					removeLoadingOverlay( el );
				}
			}, FADE_OUT_MS );
			// Drop the hand-off modifier once the content's own fade
			// has landed, so the delayed transition it declares does
			// not linger on a window that is done loading.
			window.setTimeout( () => {
				if ( ! body.classList.contains( LOADING_BODY_CLASS ) ) {
					body.classList.remove( LOADING_HANDOFF_BODY_CLASS );
				}
			}, FADE_OUT_MS + LOADING_CONTENT_FADE_IN_MS );
		},
	);

	// Boot-order race fix: on F5 / session restore the shell rebuilds
	// every restored window during startup — BEFORE plugin scripts'
	// `whenReady()` callbacks have drained. A plugin that registers
	// the `WINDOW_LOADING_OVERLAY` filter inside `whenReady( … )` is
	// thus too late to influence the first paint of those restored
	// windows; their overlays show the default `<os-spinner>` even
	// though every subsequent open works correctly.
	//
	// Fix: subscribe to `HOOKS.INIT` and, deferred one microtask so
	// every synchronous `whenReady` callback has had a chance to
	// register its filter, sweep currently-loading windows and
	// re-paint their overlays through the customization pipeline.
	// `repaintLoadingOverlays` removes the existing overlay element
	// and re-runs `ensureLoadingOverlay`, which applies the
	// per-window inline `config.loading.render` AND any filter
	// registered between then and now.
	addAction(
		HOOKS.INIT,
		'desktop-mode/loading-overlay-init-sweep',
		() => {
			// `queueMicrotask` runs AFTER all synchronous addAction
			// handlers fire (whenReady callbacks registered before
			// boot land here). For whenReady callbacks scheduled via
			// `Promise.resolve().then` (rare — only when the plugin
			// loads after init) the sweep won't catch them; those
			// callers can call `wp.os.repaintLoadingOverlays()`
			// directly after they register their filter.
			queueMicrotask( () => repaintLoadingOverlays() );
		},
	);
}

/**
 * Public escape hatch: re-paint every currently-loading window's
 * overlay through the customization pipeline. Use after registering
 * a `WINDOW_LOADING_OVERLAY` filter mid-life (a deferred async
 * import, a plugin loaded post-init, a feature flag flip), so the
 * filter applies to windows that are *still* loading.
 *
 * Idempotent + cheap. Iterates every `.os-window__body--loading`
 * in the DOM and re-runs `ensureLoadingOverlay`. Windows whose
 * overlays were already torn down by a `markContentLoaded()` call
 * in the meantime are not affected.
 *
 * The replacement overlay resumes the body's show-delay clock rather
 * than restarting it, so a repaint of a spinner that is already on
 * screen does not blink it off for another 120 ms.
 *
 * Called automatically by the post-`INIT` sweep above — most
 * plugins never need to invoke this directly.
 *
 * @public
 */
export function repaintLoadingOverlays(): void {
	const bodies = document.querySelectorAll< HTMLElement >(
		'.os-window__body--loading',
	);
	bodies.forEach( ( body ) => {
		const windowEl = body.closest< HTMLElement >( '.os-window' );
		if ( ! windowEl ) {
			return;
		}
		body.querySelector( ':scope .os-window__loading' )?.remove();
		ensureLoadingOverlay( windowEl );
	} );
}
