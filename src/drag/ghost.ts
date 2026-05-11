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
 * Since 0.20.0 the ghost also paints a small "drop hint" chip next
 * to the cursor that updates with the current accept/reject state.
 * Plugin authors get a text affordance for free; the chip text can
 * be customised per payload via `payload.ghost.hint`.
 *
 * @since 0.18.0
 */

import { __ } from '../i18n';
import type { DragPayload, GhostHintConfig } from './types';

const GHOST_CLASS = 'desktop-mode-drag-ghost';
const GHOST_ACCEPT_CLASS = 'desktop-mode-drag-ghost--accept';
const GHOST_REJECT_CLASS = 'desktop-mode-drag-ghost--reject';

const HINT_CLASS = 'desktop-mode-drag-hint';
const HINT_ACCEPT_CLASS = 'desktop-mode-drag-hint--accept';
const HINT_REJECT_CLASS = 'desktop-mode-drag-hint--reject';
const HINT_NEUTRAL_CLASS = 'desktop-mode-drag-hint--neutral';

/** Horizontal offset of the hint chip from the cursor, in CSS px. */
const HINT_OFFSET_X = 16;
/** Vertical offset of the hint chip from the cursor, in CSS px. */
const HINT_OFFSET_Y = 18;

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

	const labels = resolveHintLabels( payload );
	const hint = labels ? buildHintChip() : null;
	if ( hint ) {
		document.body.appendChild( hint );
	}

	const handle: GhostHandle = {
		get element() {
			return ghost;
		},
		moveTo( cx, cy ) {
			ghost.style.transform = `translate3d(${ cx - offsetX }px, ${ cy - offsetY }px, 0)`;
			if ( hint ) {
				hint.style.transform = `translate3d(${ cx + HINT_OFFSET_X }px, ${ cy + HINT_OFFSET_Y }px, 0)`;
			}
		},
		setMode( mode ) {
			ghost.classList.remove( GHOST_ACCEPT_CLASS, GHOST_REJECT_CLASS );
			if ( mode === 'accept' ) {
				ghost.classList.add( GHOST_ACCEPT_CLASS );
			} else if ( mode === 'reject' ) {
				ghost.classList.add( GHOST_REJECT_CLASS );
			}
			if ( hint && labels ) {
				hint.classList.remove(
					HINT_ACCEPT_CLASS,
					HINT_REJECT_CLASS,
					HINT_NEUTRAL_CLASS,
				);
				if ( mode === 'accept' ) {
					hint.classList.add( HINT_ACCEPT_CLASS );
					hint.textContent = labels.accept;
				} else if ( mode === 'reject' ) {
					hint.classList.add( HINT_REJECT_CLASS );
					hint.textContent = labels.reject;
				} else {
					hint.classList.add( HINT_NEUTRAL_CLASS );
					hint.textContent = labels.neutral;
				}
				// Empty-string labels collapse the chip — useful for
				// plugin-defined payloads that only want feedback on
				// accept/reject states.
				hint.hidden = ! hint.textContent;
			}
		},
		withHidden( fn ) {
			const prevG = ghost.style.visibility;
			const prevH = hint?.style.visibility ?? '';
			ghost.style.visibility = 'hidden';
			if ( hint ) {
				hint.style.visibility = 'hidden';
			}
			try {
				return fn();
			} finally {
				ghost.style.visibility = prevG;
				if ( hint ) {
					hint.style.visibility = prevH;
				}
			}
		},
		dispose() {
			if ( ghost.isConnected ) {
				ghost.remove();
			}
			if ( hint?.isConnected ) {
				hint.remove();
			}
		},
	};

	handle.moveTo( clientX, clientY );
	handle.setMode( 'neutral' );
	return handle;
}

function buildHintChip(): HTMLElement {
	const chip = document.createElement( 'div' );
	chip.className = HINT_CLASS;
	chip.setAttribute( 'aria-hidden', 'true' );
	chip.setAttribute( 'role', 'presentation' );
	chip.style.position = 'fixed';
	chip.style.left = '0';
	chip.style.top = '0';
	chip.style.margin = '0';
	chip.style.pointerEvents = 'none';
	// Same z-stack as the ghost so the chip never tucks behind a window.
	chip.style.zIndex = '2147483647';
	chip.style.willChange = 'transform';
	return chip;
}

interface ResolvedHintLabels {
	accept: string;
	reject: string;
	neutral: string;
}

/**
 * Resolve the hint chip's text per state. Returns `null` when the
 * caller has opted out via `payload.ghost.hint.hidden`. Defaults
 * fall through by payload type so framework gestures get sensible
 * copy without per-call wiring.
 */
function resolveHintLabels(
	payload: DragPayload,
): ResolvedHintLabels | null {
	const cfg: GhostHintConfig | undefined = payload.ghost?.hint;
	if ( cfg?.hidden ) {
		return null;
	}
	return {
		accept: cfg?.accept ?? defaultAcceptLabel( payload ),
		reject: cfg?.reject ?? defaultRejectLabel( payload ),
		neutral: cfg?.neutral ?? defaultNeutralLabel( payload ),
	};
}

function defaultAcceptLabel( payload: DragPayload ): string {
	if ( payload.type === 'shortcut' ) {
		return __( 'Drop here to create shortcut', 'desktop-mode' );
	}
	if ( payload.type === 'desktop-file' ) {
		return __( 'Drop here to move', 'desktop-mode' );
	}
	return __( 'Drop here', 'desktop-mode' );
}

function defaultRejectLabel( _payload: DragPayload ): string {
	return __( 'Can’t drop here', 'desktop-mode' );
}

function defaultNeutralLabel( payload: DragPayload ): string {
	if ( payload.type === 'shortcut' ) {
		return __(
			'Drop on the desktop or a folder',
			'desktop-mode',
		);
	}
	if ( payload.type === 'desktop-file' ) {
		return __( 'Drop in a folder', 'desktop-mode' );
	}
	return '';
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
