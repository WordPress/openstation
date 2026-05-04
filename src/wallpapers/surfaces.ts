/**
 * Wallpaper collision surfaces.
 *
 * A "surface" is one edge of a visible shell element that a
 * collision-aware wallpaper should treat as solid: snow piles on
 * `top` faces, rain splashes off `bottom` faces, leaves settle on
 * horizontal rims. Seeded by the shell for every piece of chrome it
 * knows about — windows, the desktop floor, the dock, widget cards —
 * and filtered through `desktop-mode.wallpaper.surfaces`
 * so plugins that own floating DOM can contribute their own.
 *
 * Coordinates are in **viewport space** (clientX / clientY) to
 * match what a canvas mounted inside `#desktop-mode-wallpaper` reads
 * when it calls `element.getBoundingClientRect()` itself. Wallpapers
 * translate into their own drawing space using the wallpaper
 * element's own rect as the origin.
 *
 * Minimized windows are excluded — they have no visible surface.
 * Non-active virtual desktops' windows are also excluded; their
 * elements are `display: none` under the shell's desktop-switch
 * logic and would report zeroed rects anyway.
 *
 * @since 0.9.0
 */

import { applyFilters, HOOKS } from '../hooks';
import type { WindowManager } from '../window-manager';

/**
 * A solid edge wallpapers should respect for collision logic.
 *
 * @public
 */
export interface WallpaperSurface {
	/**
	 * Stable-ish identifier. Built-in surfaces use namespaced ids
	 * (`window:foo`, `shell:floor`, `dock:edge`, `widget:clock`);
	 * custom surfaces returned by plugin filters
	 * should namespace with the plugin's slug (`myplugin:picker`).
	 */
	id: string;
	/** Origin of the surface. Plugins use `'custom'`. */
	kind: 'window' | 'shell' | 'dock' | 'widget' | 'custom';
	/** Rect in viewport coordinates (clientX / clientY). */
	rect: { x: number; y: number; width: number; height: number };
	/**
	 * Which face of the rect is solid. `'top'` for horizontal
	 * surfaces that catch falling particles; `'bottom'` for
	 * ceilings; `'left'` / `'right'` for vertical surfaces like
	 * the dock's inline edge.
	 */
	face: 'top' | 'bottom' | 'left' | 'right';
	/**
	 * Live element when the surface originated from a specific
	 * shell DOM node. `null` for synthetic / filter-added surfaces
	 * that don't correspond to a visible node.
	 */
	element: HTMLElement | null;
}

/**
 * Collect the live set of wallpaper surfaces the shell currently
 * knows about, then apply the `desktop-mode.wallpaper.surfaces`
 * filter so plugins can add / remove entries.
 *
 * Exposed on `wp.desktop.getWallpaperSurfaces()` — wallpapers call
 * it each frame (or throttled) and rebuild their collision cache
 * from the result. Pure read: no DOM mutation, no subscription
 * setup, safe from inside a `requestAnimationFrame` callback.
 */
export function collectWallpaperSurfaces( manager: WindowManager ): WallpaperSurface[] {
	const seed: WallpaperSurface[] = [];

	// Windows — every non-minimized window on the active desktop
	// contributes a top edge. We read the LIVE bounding rect, not
	// the manager's desktop-area-space snapshot, so surfaces stay
	// in viewport coordinates consistently with the other entries.
	for ( const w of manager.getVisibleRects() ) {
		if ( w.state === 'minimized' ) {
			continue;
		}
		// `offsetParent === null` → element is hidden (either
		// minimized — caught above — or on a suppressed virtual
		// desktop). Skip: there's nothing for snow to land on.
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

	// Shell floor — bottom edge of the shell container. Canvas
	// particles that miss every window should settle here. Modelled
	// as a 1-px-tall rect along the shell's bottom so snow-pile
	// accumulation logic treats it like any other horizontal
	// surface rather than a special "viewport floor" branch.
	const shellEl = document.getElementById( 'desktop-mode-shell' );
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

	// Dock edge — a thin collision strip along whichever side of each
	// live dock faces the desktop area. The dock element itself
	// carries the placement attribute, so two simultaneous instances
	// (Classic layout: a left side bar + a bottom dock) each emit
	// their own surface. Horizontally-moving effects (leaves, rain
	// slanted by gusts) bounce off vertical dock edges; vertically-
	// falling effects (snow) pile on the top edge of a bottom dock.
	const dockEls = document.querySelectorAll< HTMLElement >(
		'.desktop-mode-dock',
	);
	let dockIndex = 0;
	for ( const dockEl of Array.from( dockEls ) ) {
		const r = dockEl.getBoundingClientRect();
		if ( r.width <= 0 || r.height <= 0 ) {
			continue;
		}
		const placement =
			dockEl.getAttribute( 'data-desktop-mode-dock-placement' ) ?? 'bottom';
		// First dock keeps the canonical `dock:edge` id for backwards
		// compat with single-rail layouts; subsequent docks suffix.
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

	// Widget card tops — each mounted widget surface collects a
	// top edge. We query by class because the widget layer builds
	// and tears down cards independently of surface collection and
	// we don't want to couple the two.
	const widgetCards = document.querySelectorAll< HTMLElement >(
		'.desktop-mode-widgets__card',
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

	// Filter — plugins that own floating DOM add their surfaces
	// here. Any non-array return coerces back to the seed so a
	// misbehaving filter can't corrupt the whole list.
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
