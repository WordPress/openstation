import { __ } from '../i18n';
import type { DragPayload, GhostHintConfig } from './types';

const GHOST_CLASS = 'os-drag-ghost';
const GHOST_ACCEPT_CLASS = 'os-drag-ghost--accept';
const GHOST_REJECT_CLASS = 'os-drag-ghost--reject';

const HINT_CLASS = 'os-drag-hint';
const HINT_ACCEPT_CLASS = 'os-drag-hint--accept';
const HINT_REJECT_CLASS = 'os-drag-hint--reject';
const HINT_NEUTRAL_CLASS = 'os-drag-hint--neutral';

const HINT_OFFSET_X = 16;

const HINT_OFFSET_Y = 18;

export interface GhostHandle {
	readonly element: HTMLElement;

	moveTo( clientX: number, clientY: number ): void;

	setMode(
		mode: 'accept' | 'reject' | 'neutral',
		overrides?: { acceptLabel?: string },
	): void;

	withHidden< T >( fn: () => T ): T;

	dispose(): void;
}

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

	ghost.style.zIndex = '2147483647';
	ghost.style.willChange = 'transform';

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
		setMode( mode, overrides ) {
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

					hint.textContent = overrides?.acceptLabel ?? labels.accept;
				} else if ( mode === 'reject' ) {
					hint.classList.add( HINT_REJECT_CLASS );
					hint.textContent = labels.reject;
				} else {
					hint.classList.add( HINT_NEUTRAL_CLASS );
					hint.textContent = labels.neutral;
				}

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

	chip.style.zIndex = '2147483647';
	chip.style.willChange = 'transform';
	return chip;
}

interface ResolvedHintLabels {
	accept: string;
	reject: string;
	neutral: string;
}

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

	clone.removeAttribute( 'id' );

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
