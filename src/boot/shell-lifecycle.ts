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
 */

import { HOOKS, addAction, doAction } from '../hooks';

/** Debounce window for the shell-resized action. Trailing-edge only. */
const SHELL_RESIZE_DEBOUNCE_MS = 120;

/**
 * Wire the session saver to every window-lifecycle event that
 * should end up persisted. Close/focus come from the manager;
 * moved/resized/state come from individual windows via
 * `os-window-changed`.
 */
export function wireSessionEvents( save: () => void ): void {
	document.addEventListener( 'os-window-opened', save );
	document.addEventListener( 'os-window-closed', save );
	document.addEventListener( 'os-window-focused', save );
	document.addEventListener( 'os-window-changed', save );
	addAction( HOOKS.DESKTOP_CREATED, 'desktop-mode/session-save', save );
	addAction( HOOKS.DESKTOP_CLOSED, 'desktop-mode/session-save', save );
	addAction( HOOKS.DESKTOP_SWITCHED, 'desktop-mode/session-save', save );
	addAction( HOOKS.DESKTOP_RENAMED, 'desktop-mode/session-save', save );
	// A workspace's profile — which apps it shows, what it opens with,
	// how it arranges them — rides on the desktop and is persisted with
	// it. Without this, editing a workspace would look like it worked
	// and be gone on reload.
	addAction( HOOKS.WORKSPACE_UPDATED, 'desktop-mode/session-save', save );
	addAction( HOOKS.WORKSPACE_PROVISIONED, 'desktop-mode/session-save', save );
}

/**
 * Wire browser-resize and document-visibility into
 * `os.shell.*` actions. Resize is debounced so a
 * drag-to-resize storm collapses to a single hook fire;
 * visibility is edge-triggered (fires exactly once per state
 * change).
 */
export function bindShellLifecycle(): void {
	const shellEl = document.getElementById( 'os-shell' );

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
