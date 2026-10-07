export const LOADING_OVERLAY_DELAY_MS = 400;

export const LOADING_OVERLAY_VISIBLE_CLASS =
	'os-content-graph__loading--visible';

export interface LoadingOverlayHandle {

	show: () => void;

	hide: () => void;

	destroy: () => void;

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
