/**
 * Desktop Mode — Drag ghost element.
 *
 * The ghost is the visual element the user sees following the
 * pointer during a drag. By default it's a deep clone of the source
 * element, positioned `fixed`, with `pointer-events: none` so it
 * doesn't interfere with `elementFromPoint` hit-testing of the drop
 * surfaces underneath.
 *
 * The clone strategy works because every interactive draggable in
 * the shell (file tile, entity tile) is a self-contained DOM node
 * whose visual appearance is captured by class+style at clone time.
 * If a future caller needs a custom ghost (e.g. a thumbnail-only
 * card during a Media Library drag) they pass `payload.ghost.element`
 * and the manager renders that instead.
 *
 * @since 0.18.0
 */

import type { DragPayload } from './types';

const GHOST_CLASS = 'desktop-mode-drag-ghost';
const GHOST_ACCEPT_CLASS = 'desktop-mode-drag-ghost--accept';
const GHOST_REJECT_CLASS = 'desktop-mode-drag-ghost--reject';

export interface GhostHandle {
	readonly element: HTMLElement;
	/** Position the ghost so its origin sits at (clientX, clientY) minus its offset. */
	moveTo( clientX: number, clientY: number ): void;
	/** Toggle visual feedback for over-accepting vs over-rejecting target. */
	setMode( mode: 'accept' | 'reject' | 'neutral' ): void;
	/**
	 * Hide the ghost from `elementFromPoint` without removing it from
	 * the DOM. Used during hit-testing so the ghost itself isn't
	 * returned as the topmost element.
	 */
	withHidden< T >( fn: () => T ): T;
	/** Remove from the DOM. Idempotent. */
	dispose(): void;
}

/**
 * Mount a ghost element under the pointer at `(clientX, clientY)`.
 * The caller should call `moveTo()` on subsequent `pointermove`
 * events and `dispose()` on cancel/commit.
 */
export function mountGhost(
	payload: DragPayload,
	clientX: number,
	clientY: number,
): GhostHandle {
	const ghost = buildGhost( payload );
	const offsetX = payload.ghost?.offsetX ?? defaultOffsetX( payload.source );
	const offsetY = payload.ghost?.offsetY ?? defaultOffsetY( payload.source );

	ghost.classList.add( GHOST_CLASS );
	ghost.setAttribute( 'aria-hidden', 'true' );
	ghost.style.position = 'fixed';
	ghost.style.left = '0';
	ghost.style.top = '0';
	ghost.style.margin = '0';
	ghost.style.pointerEvents = 'none';
	// Above every shell layer, including the system dock and any
	// modal. We want to track the pointer literally.
	ghost.style.zIndex = '2147483647';
	ghost.style.willChange = 'transform';
	// Pointer-events:none on the ghost is sufficient — the manager
	// also temporarily applies visibility:hidden during elementFromPoint
	// hit-tests as a belt-and-braces safeguard against engines that
	// honour pointer-events but still report hidden-by-pointer-events
	// elements at the top of the stack.

	document.body.appendChild( ghost );

	const handle: GhostHandle = {
		get element() {
			return ghost;
		},
		moveTo( cx, cy ) {
			ghost.style.transform = `translate3d(${ cx - offsetX }px, ${ cy - offsetY }px, 0)`;
		},
		setMode( mode ) {
			ghost.classList.remove( GHOST_ACCEPT_CLASS, GHOST_REJECT_CLASS );
			if ( mode === 'accept' ) {
				ghost.classList.add( GHOST_ACCEPT_CLASS );
			} else if ( mode === 'reject' ) {
				ghost.classList.add( GHOST_REJECT_CLASS );
			}
		},
		withHidden( fn ) {
			const prev = ghost.style.visibility;
			ghost.style.visibility = 'hidden';
			try {
				return fn();
			} finally {
				ghost.style.visibility = prev;
			}
		},
		dispose() {
			if ( ghost.isConnected ) {
				ghost.remove();
			}
		},
	};

	handle.moveTo( clientX, clientY );
	handle.setMode( 'neutral' );
	return handle;
}

function buildGhost( payload: DragPayload ): HTMLElement {
	if ( payload.ghost?.element ) {
		return payload.ghost.element;
	}
	const clone = payload.source.cloneNode( true ) as HTMLElement;
	// Remove identifiers that could collide with the source — IDs
	// must be unique, and the clone's `data-placement-id` etc. could
	// be read by debugging tools that walk the DOM looking for state.
	clone.removeAttribute( 'id' );
	// Mirror the source's measured size so layout-sensitive ghosts
	// (tiles whose width is set by a parent grid) don't collapse.
	const rect = payload.source.getBoundingClientRect();
	clone.style.width = `${ rect.width }px`;
	clone.style.height = `${ rect.height }px`;
	return clone;
}

function defaultOffsetX( source: HTMLElement ): number {
	return source.offsetWidth / 2;
}

function defaultOffsetY( source: HTMLElement ): number {
	return source.offsetHeight / 2;
}
