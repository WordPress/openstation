/**
 * Boot-time shell lifecycle wiring.
 *
 * Wires browser-level events (resize, visibilitychange) and window
 * lifecycle CustomEvents to the corresponding `HOOKS.SHELL_*`
 * actions and to the session saver. Pure setup — no captured
 * state at module level.
 *
 * Extracted from `src/desktop.ts` during the architecture-0.8.1
 * boot decomposition (phase 5).
 *
 * @since 0.8.1
 */

import { HOOKS, doAction } from '../hooks';

/** Debounce window for the shell-resized action. Trailing-edge only. */
const SHELL_RESIZE_DEBOUNCE_MS = 120;

/**
 * Wire the session saver to every window-lifecycle event that
 * should end up persisted. Close/focus come from the manager;
 * moved/resized/state come from individual windows via
 * `desktop-mode-window-changed`.
 *
 * @since 0.8.1 (extracted from desktop.ts)
 */
export function wireSessionEvents( save: () => void ): void {
	document.addEventListener( 'desktop-mode-window-opened', save );
	document.addEventListener( 'desktop-mode-window-closed', save );
	document.addEventListener( 'desktop-mode-window-focused', save );
	document.addEventListener( 'desktop-mode-window-changed', save );
}

/**
 * Wire browser-resize and document-visibility into
 * `desktop-mode.shell.*` actions. Resize is debounced so a
 * drag-to-resize storm collapses to a single hook fire;
 * visibility is edge-triggered (fires exactly once per state
 * change).
 *
 * @since 0.8.1 (extracted from desktop.ts)
 */
export function bindShellLifecycle(): void {
	const shellEl = document.getElementById( 'desktop-mode-shell' );

	let resizeTimer: number | null = null;
	const fireShellResize = (): void => {
		resizeTimer = null;
		const rect = shellEl ? shellEl.getBoundingClientRect() : null;
		doAction( HOOKS.SHELL_RESIZED, {
			width: rect ? Math.round( rect.width ) : window.innerWidth,
			height: rect ? Math.round( rect.height ) : window.innerHeight,
		} );
	};
	window.addEventListener( 'resize', () => {
		if ( resizeTimer !== null ) {
			window.clearTimeout( resizeTimer );
		}
		resizeTimer = window.setTimeout(
			fireShellResize,
			SHELL_RESIZE_DEBOUNCE_MS,
		) as unknown as number;
	} );

	document.addEventListener( 'visibilitychange', () => {
		doAction( HOOKS.SHELL_VISIBILITY, {
			state: document.hidden ? 'hidden' : 'visible',
		} );
	} );
}
