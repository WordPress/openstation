/**
 * Window loading-state transitions — wires the framework's
 * loading hooks to the on-screen DOM. The actual hook firing
 * lives in {@link markWindowContentLoading} /
 * {@link markWindowContentReady} (`src/window-channels.ts`); this
 * module is only the visual side: toggle the
 * `wp-desktop-window__body--loading` modifier, attach / detach
 * the spinner overlay, and swallow strays from windows that have
 * already torn down.
 *
 * A single global `addAction` per edge (loading + loaded) reads
 * the window id from the payload and looks up the element via
 * the canonical `id="wp-window-${ id }"` attribute. Per-window
 * subscriptions would over-subscribe with no benefit — the
 * payload-id pattern matches the rest of the shell (see the
 * connection-cleanup / iframe-ready subscriptions in
 * `src/desktop.ts`).
 *
 * @since 0.6.0
 */

import { HOOKS, addAction } from './../hooks';
import { ensureLoadingOverlay, removeLoadingOverlay } from './dom';

/**
 * Duration of the body-content fade-out before the overlay
 * element is removed from the DOM. Must match the
 * `transition: opacity` duration in
 * `assets/css/window-chrome.css` for `.wp-desktop-window__loading`
 * — overshooting wastes a frame, undershooting yanks the spinner
 * mid-fade.
 *
 * @internal
 */
const FADE_OUT_MS = 250;

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
 * @since 0.6.0
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
		'wp-desktop-mode/window-loading-enter',
		( e: { windowId?: string } ) => {
			const el = findWindowElement( e?.windowId ?? '' );
			if ( ! el ) {
				return;
			}
			const body = el.querySelector< HTMLElement >(
				':scope .wp-desktop-window__body',
			);
			if ( ! body ) {
				return;
			}
			body.classList.add( 'wp-desktop-window__body--loading' );
			ensureLoadingOverlay( el );
		},
	);

	addAction(
		HOOKS.WINDOW_CONTENT_LOADED,
		'wp-desktop-mode/window-loading-exit',
		( e: { windowId?: string } ) => {
			const el = findWindowElement( e?.windowId ?? '' );
			if ( ! el ) {
				return;
			}
			const body = el.querySelector< HTMLElement >(
				':scope .wp-desktop-window__body',
			);
			if ( ! body ) {
				return;
			}
			body.classList.remove( 'wp-desktop-window__body--loading' );
			// Defer the overlay removal until the CSS fade-out has
			// settled. Without this, the overlay disappears on the
			// same frame the modifier flips off and the spinner
			// pops out of view instead of fading.
			window.setTimeout( () => {
				// Re-check the DOM — the user might have triggered
				// `markContentLoading()` again in the interim, in
				// which case the overlay should stay.
				if ( ! body.classList.contains( 'wp-desktop-window__body--loading' ) ) {
					removeLoadingOverlay( el );
				}
			}, FADE_OUT_MS );
		},
	);
}
