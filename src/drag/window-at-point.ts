export const WINDOW_ROOT_SELECTOR = '.os-window';

export const WINDOW_ID_PREFIX = 'wp-window-';

export function findWindowRootAtPoint(
	clientX: number,
	clientY: number,
): HTMLElement | null {
	const el = document.elementFromPoint( clientX, clientY );
	if ( ! el ) {
		return null;
	}
	const root = el.closest( WINDOW_ROOT_SELECTOR );
	return root instanceof HTMLElement ? root : null;
}

export function windowIdFromRoot( root: HTMLElement ): string | null {
	if ( ! root.id.startsWith( WINDOW_ID_PREFIX ) ) {
		return null;
	}
	const id = root.id.slice( WINDOW_ID_PREFIX.length );
	return id.length > 0 ? id : null;
}
