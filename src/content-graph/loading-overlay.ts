/**
 * Content Graph — the full-canvas loading overlay, shown late.
 *
 * The overlay in the window template (`[data-os-content-graph-loading]`)
 * covers the whole stage with a wash and a WordPress-mark spinner.
 * That is the right amount of feedback for a wait the user will
 * actually notice, and the wrong amount for the ~100 ms a cached
 * re-fetch takes after a filter chip is toggled: the board flashes
 * grey, the mark blinks, and the window reads as slower than it is.
 *
 * So the overlay is armed on `show()` and only becomes visible once
 * {@link LOADING_OVERLAY_DELAY_MS} has elapsed; a fetch that lands
 * inside the window never paints it. The toolbar's "Loading graph…"
 * status still gives immediate, quiet feedback for the short case.
 *
 * Visibility is a class rather than the `hidden` attribute so the
 * stylesheet can fade the wash in and out instead of popping it.
 *
 * @public
 */

/**
 * How long a graph fetch has to take before the full-canvas overlay
 * paints. Longer than the window shell's own 120 ms threshold on
 * purpose: there, the body behind the spinner is empty; here, the
 * previous board stays on screen and the toolbar already says
 * "Loading graph…", so the wash is only worth its interruption for a
 * wait the user would otherwise wonder about.
 */
export const LOADING_OVERLAY_DELAY_MS = 400;

export const LOADING_OVERLAY_VISIBLE_CLASS =
	'os-content-graph__loading--visible';

export interface LoadingOverlayHandle {
	/** Arm the overlay; it paints once the delay elapses. */
	show: () => void;
	/** Hide immediately and disarm any pending show. */
	hide: () => void;
	/** `hide()` plus release; safe to call more than once. */
	destroy: () => void;
	/** Whether the overlay is currently painted. */
	isVisible: () => boolean;
}

export function createLoadingOverlay(
	el: HTMLElement | null,
	delayMs: number = LOADING_OVERLAY_DELAY_MS,
): LoadingOverlayHandle {
	let timer: ReturnType< typeof setTimeout > | null = null;

	const clear = (): void => {
		if ( timer !== null ) {
			clearTimeout( timer );
			timer = null;
		}
	};

	// The template paints the overlay in its resting (invisible)
	// state; make sure a stale `hidden` from an older template can't
	// keep it from ever showing.
	if ( el ) {
		el.hidden = false;
		el.classList.remove( LOADING_OVERLAY_VISIBLE_CLASS );
	}

	return {
		show: () => {
			if ( ! el || timer !== null ) {
				return;
			}
			if ( el.classList.contains( LOADING_OVERLAY_VISIBLE_CLASS ) ) {
				return;
			}
			timer = setTimeout( () => {
				timer = null;
				el.classList.add( LOADING_OVERLAY_VISIBLE_CLASS );
			}, delayMs );
		},
		hide: () => {
			clear();
			el?.classList.remove( LOADING_OVERLAY_VISIBLE_CLASS );
		},
		destroy: () => {
			clear();
			el?.classList.remove( LOADING_OVERLAY_VISIBLE_CLASS );
		},
		isVisible: () =>
			!! el?.classList.contains( LOADING_OVERLAY_VISIBLE_CLASS ),
	};
}
