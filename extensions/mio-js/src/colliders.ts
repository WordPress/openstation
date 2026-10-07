import type { WallpaperSurface } from '../../../src/wallpapers/surfaces';

let selector: string | null = null;

let installed = false;

function contentBox(
	el: Element,
): { x: number; y: number; width: number; height: number } | null {
	const rect = el.getBoundingClientRect();
	if ( rect.width <= 0 || rect.height <= 0 ) {
		return null;
	}
	const style = window.getComputedStyle( el );
	const num = ( value: string ): number => {
		const parsed = parseFloat( value );
		return Number.isFinite( parsed ) ? parsed : 0;
	};
	const left = num( style.borderLeftWidth ) + num( style.paddingLeft );
	const right = num( style.borderRightWidth ) + num( style.paddingRight );
	const top = num( style.borderTopWidth ) + num( style.paddingTop );
	const bottom = num( style.borderBottomWidth ) + num( style.paddingBottom );

	const width = rect.width - left - right;
	const height = rect.height - top - bottom;
	if ( width <= 0 || height <= 0 ) {
		return null;
	}
	return { x: rect.left + left, y: rect.top + top, width, height };
}

function collect(): WallpaperSurface[] {
	if ( ! selector ) {
		return [];
	}
	let matches: NodeListOf< Element >;
	try {
		matches = document.querySelectorAll( selector );
	} catch {

		return [];
	}
	const out: WallpaperSurface[] = [];
	const viewportHeight = window.innerHeight || 0;
	const viewportWidth = window.innerWidth || 0;
	let index = 0;
	for ( const el of Array.from( matches ) ) {
		const rect = contentBox( el );
		index++;
		if ( ! rect ) {
			continue;
		}
		if (
			rect.y > viewportHeight ||
			rect.y + rect.height < 0 ||
			rect.x > viewportWidth ||
			rect.x + rect.width < 0
		) {
			continue;
		}
		out.push( {
			id: `mio-marker:${ index }`,

			kind: 'window',
			rect,

			face: 'top',
			element: el as HTMLElement,
		} );
	}
	return out;
}

export function setColliders( next: string | null ): void {
	selector = next && next.trim() ? next.trim() : null;
	if ( selector ) {
		install();
	}
}

export function getColliders(): string | null {
	return selector;
}

function install(): void {
	if ( installed ) {
		return;
	}

	const w = window as unknown as {
		wp?: { os?: { getWallpaperSurfaces?: () => WallpaperSurface[] } };
	};
	if ( w.wp?.os ) {
		installed = true;
		return;
	}
	w.wp = w.wp || {};
	w.wp.os = { getWallpaperSurfaces: collect };
	installed = true;
}
