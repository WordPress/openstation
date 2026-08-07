/**
 * mio-js — page elements as collision markers.
 *
 * On an OpenStation desk Mio has furniture: it is pulled toward
 * windows and widget cards, lands on them, squashes against their top
 * edge and gets pushed clear if one opens on top of it. It learns all
 * of that from one call — `wp.os.getWallpaperSurfaces()`, which the
 * shell answers with the live rects of everything solid.
 *
 * A blog has no windows, so by default that call returns nothing and
 * Mio floats in an empty room. This module lets a page hand it
 * furniture instead: any CSS selector, and every element matching it
 * becomes a solid rect Mio can bump into, rest on, and be pushed out
 * of.
 *
 * **The rect is the element's content box** — margins and padding are
 * both taken off, so the collision boundary is the text itself and not
 * the whitespace a stylesheet happens to have parked around it. A
 * heading with 3rem of margin above it is a heading, not a 3rem-tall
 * wall.
 *
 * Nothing here is installed unless a page asks for it, and it is
 * installed by *providing* `wp.os.getWallpaperSurfaces` rather than by
 * teaching Mio anything new: this is the same interface the shell
 * implements, which is why the runtime imported from `src/mio/` needs
 * no knowledge that it is running on a blog.
 */

import type { WallpaperSurface } from '../../../src/wallpapers/surfaces';

/** Live selector, or `null` when the page hasn't asked for any. */
let selector: string | null = null;

/** Whether the surface provider has been installed on `wp.os`. */
let installed = false;

/**
 * Read an element's content box in viewport coordinates.
 *
 * `getBoundingClientRect()` is the border box, so the border and the
 * padding come off here; the margin is already outside it. Returns
 * `null` for anything with nothing left to collide with — a
 * `display: none` element, a zero-height wrapper, a heading whose
 * padding exceeds its own box.
 */
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

/**
 * The live surface set, rebuilt on every call.
 *
 * Mio asks about twenty times a second (`SURFACE_REFRESH_MS`), which
 * is what makes this work on a scrolling page: the rects move with the
 * document and Mio is handed the new ones a frame later, so it slides
 * along a heading as the article scrolls under it rather than hanging
 * in space where the heading used to be.
 *
 * Off-viewport elements are dropped rather than measured into the set.
 * On a long article that is most of them, and an obstacle Mio could
 * never reach still costs a collision test on every rim point, every
 * sub-step, every frame.
 */
function collect(): WallpaperSurface[] {
	if ( ! selector ) {
		return [];
	}
	let matches: NodeListOf< Element >;
	try {
		matches = document.querySelectorAll( selector );
	} catch {
		// An invalid selector should not take the mascot down with it.
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
			/*
			 * `window`, not `custom`.
			 *
			 * Both are solid, but only `window` is in Mio's magnet set
			 * — the kinds it is drawn toward and settles onto. A
			 * `custom` heading would be something Mio bounces off if
			 * thrown at it and otherwise drifts past; a `window`
			 * heading is somewhere it goes to sit. The second is what
			 * "collision markers" is for, and it is the exact
			 * behaviour Mio has around a window on a real desk.
			 */
			kind: 'window',
			rect,
			// Only read for chrome (`dock` / `shell`), which inflates
			// away from its solid face. A window-kind rect is solid all
			// the way through, so this is carried, not used.
			face: 'top',
			element: el as HTMLElement,
		} );
	}
	return out;
}

/**
 * Choose what Mio collides with. Pass `null` to go back to an empty
 * room.
 *
 * The selector is evaluated fresh on every poll, so elements added to
 * the page later (an infinite-scroll article, a lazy-loaded comment
 * thread) become solid the moment they exist — there is nothing to
 * re-register.
 */
export function setColliders( next: string | null ): void {
	selector = next && next.trim() ? next.trim() : null;
	if ( selector ) {
		install();
	}
}

/** The selector currently in force. */
export function getColliders(): string | null {
	return selector;
}

/**
 * Publish the surface provider under the name Mio looks for.
 *
 * **Only when the slot is genuinely free.** If `window.wp.os` already
 * exists, this page is running the OpenStation shell (or something
 * else that owns that namespace), and it has a real desk to describe —
 * overwriting its answer with a list of headings would break the
 * mascot's environment rather than provide one. In that case Mio
 * simply uses the desk it is on, which is the right answer.
 */
function install(): void {
	if ( installed ) {
		return;
	}
	/*
	 * Cast through `unknown`: in the shell's own type graph `wp.os` is
	 * the full public API — a hundred-odd methods this library has no
	 * business implementing. What Mio actually calls on it is one
	 * optional method, and that is all this stands up.
	 */
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
