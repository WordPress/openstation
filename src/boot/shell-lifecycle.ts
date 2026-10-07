import { HOOKS, addAction, doAction } from '../hooks';

const SHELL_RESIZE_DEBOUNCE_MS = 120;

export function wireSessionEvents( save: () => void ): void {
	document.addEventListener( 'os-window-opened', save );
	document.addEventListener( 'os-window-closed', save );
	document.addEventListener( 'os-window-focused', save );
	document.addEventListener( 'os-window-changed', save );
	addAction( HOOKS.DESKTOP_CREATED, 'desktop-mode/session-save', save );
	addAction( HOOKS.DESKTOP_CLOSED, 'desktop-mode/session-save', save );
	addAction( HOOKS.DESKTOP_SWITCHED, 'desktop-mode/session-save', save );
	addAction( HOOKS.DESKTOP_RENAMED, 'desktop-mode/session-save', save );

	addAction( HOOKS.WORKSPACE_UPDATED, 'desktop-mode/session-save', save );
	addAction( HOOKS.WORKSPACE_PROVISIONED, 'desktop-mode/session-save', save );
}

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
