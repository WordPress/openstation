import { applyFilters, HOOKS } from '../hooks';
import type { WindowManager } from '../window-manager';

export interface WallpaperSurface {

	id: string;

	kind: 'window' | 'shell' | 'dock' | 'widget' | 'custom';

	rect: { x: number; y: number; width: number; height: number };

	face: 'top' | 'bottom' | 'left' | 'right';

	element: HTMLElement | null;
}

export function collectWallpaperSurfaces( manager: WindowManager ): WallpaperSurface[] {
	const seed: WallpaperSurface[] = [];

	for ( const w of manager.getVisibleRects() ) {
		if ( w.state === 'minimized' ) {
			continue;
		}

		if ( w.element.offsetParent === null ) {
			continue;
		}
		const r = w.element.getBoundingClientRect();
		seed.push( {
			id: `window:${ w.windowId }`,
			kind: 'window',
			rect: rectFromDom( r ),
			face: 'top',
			element: w.element,
		} );
	}

	const shellEl = document.getElementById( 'os-shell' );
	if ( shellEl ) {
		const r = shellEl.getBoundingClientRect();
		seed.push( {
			id: 'shell:floor',
			kind: 'shell',
			rect: {
				x: r.left,
				y: r.bottom - 1,
				width: r.width,
				height: 1,
			},
			face: 'top',
			element: shellEl,
		} );
	}

	const dockEls = document.querySelectorAll< HTMLElement >(
		'.os-dock',
	);
	let dockIndex = 0;
	for ( const dockEl of Array.from( dockEls ) ) {
		const r = dockEl.getBoundingClientRect();
		if ( r.width <= 0 || r.height <= 0 ) {
			continue;
		}
		const placement =
			dockEl.getAttribute( 'data-os-dock-placement' ) ?? 'bottom';

		const id = dockIndex === 0 ? 'dock:edge' : `dock:edge:${ dockIndex }`;
		dockIndex++;
		if ( placement === 'bottom' ) {
			seed.push( {
				id,
				kind: 'dock',
				rect: { x: r.left, y: r.top, width: r.width, height: 1 },
				face: 'top',
				element: dockEl,
			} );
		} else if ( placement === 'right' ) {
			seed.push( {
				id,
				kind: 'dock',
				rect: { x: r.left, y: r.top, width: 1, height: r.height },
				face: 'left',
				element: dockEl,
			} );
		} else {
			seed.push( {
				id,
				kind: 'dock',
				rect: {
					x: r.right - 1,
					y: r.top,
					width: 1,
					height: r.height,
				},
				face: 'right',
				element: dockEl,
			} );
		}
	}

	const widgetCards = document.querySelectorAll< HTMLElement >(
		'.os-widgets__card',
	);
	let widgetIndex = 0;
	widgetCards.forEach( ( card ) => {
		const r = card.getBoundingClientRect();
		if ( r.width === 0 && r.height === 0 ) {
			return;
		}
		const id = card.dataset.widgetId ?? String( widgetIndex++ );
		seed.push( {
			id: `widget:${ id }`,
			kind: 'widget',
			rect: rectFromDom( r ),
			face: 'top',
			element: card,
		} );
	} );

	const filtered = applyFilters( HOOKS.WALLPAPER_SURFACES, seed );
	return Array.isArray( filtered ) ? filtered : seed;
}

function rectFromDom( r: DOMRect ): WallpaperSurface[ 'rect' ] {
	return {
		x: r.left,
		y: r.top,
		width: r.width,
		height: r.height,
	};
}
