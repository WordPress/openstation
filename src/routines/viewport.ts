/**
 * Routines — pan + zoom viewport.
 *
 * Wraps the card layer + Pixi canvas in a transformed `<div>` and
 * exposes pan / zoom controls. The CSS transform applies to both
 * the DOM cards AND the Pixi WebGL canvas inside, so connectors,
 * halos, and bursts all stay perfectly aligned with their cards
 * at any zoom level — no double-source-of-truth.
 *
 * Interactions:
 *
 *   - **Cmd/Ctrl + wheel** → zoom toward the cursor (the point under
 *     the pointer stays anchored, so users can zoom into a
 *     specific card without losing their place).
 *   - **Plain wheel** → vertical scroll (default browser behaviour
 *     on the underlying stage; viewport doesn't intercept).
 *   - **Pointer drag on the empty background** → pan. Cards
 *     swallow `pointerdown` via their click handlers, so a drag
 *     that originates ON a card is treated as the start of a
 *     potential card interaction, not a pan.
 *   - **Toolbar** → Reset (1x, centred), Fit (zoom-to-fit), `−` / `+`.
 *   - **Keyboard** → Cmd/Ctrl + 0 / + / − (when canvas focused).
 *
 * @since 0.22.0
 */

import { el } from './dom';

export interface ViewportState {
	pan: { x: number; y: number };
	zoom: number;
}

export interface ViewportHandle {
	root: HTMLElement;
	/** CSS-transformed container — cards live here. */
	content: HTMLElement;
	/**
	 * Sibling of `content`, untransformed and at native viewport
	 * resolution. The Pixi canvas mounts here so it never gets
	 * bitmap-stretched by the parent's CSS transform — Pixi
	 * applies its own scene-graph transform inside the renderer
	 * to keep connectors aligned with their CSS-transformed cards
	 * at any zoom level, vector-perfect with zero pixelation.
	 */
	pixiHost: HTMLElement;
	getState: () => ViewportState;
	setZoom: ( zoom: number, focal?: { x: number; y: number } ) => void;
	resetView: () => void;
	fitToContent: () => void;
	onChange: ( cb: () => void ) => () => void;
}

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.5;
const WHEEL_ZOOM_FACTOR = 0.0015;

/**
 * Mount a pan/zoom viewport inside `host`. Returns a handle whose
 * `content` element is where the caller renders cards + Pixi.
 *
 * @param host Host element that will receive the viewport.
 */
export function mountViewport( host: HTMLElement ): ViewportHandle {
	host.classList.add( 'wpdm-routines__viewport-host' );

	const root = el( 'div', { class: 'wpdm-routines__viewport' } );
	const pixiHost = el( 'div', {
		class: 'wpdm-routines__viewport-pixi',
	} );
	const content = el( 'div', { class: 'wpdm-routines__viewport-content' } );
	// pixiHost first so it paints behind content; both at inset:0.
	root.append( pixiHost, content );

	const toolbar = buildToolbar();
	host.append( toolbar.node, root );

	const state: ViewportState = { pan: { x: 0, y: 0 }, zoom: 1 };
	const listeners = new Set< () => void >(); // eslint-disable-line

	const apply = (): void => {
		// CSS `zoom` (not `transform: scale`) for the size axis —
		// `transform: scale()` rasterises the element at 1× and
		// bitmap-stretches the texture, which softens every glyph
		// of text and every 1px border. `zoom` re-lays-out the
		// content; the browser re-rasterises text at its true
		// on-screen size, keeping the cards perfectly sharp at
		// any zoom level.
		//
		// Pan stays as `transform: translate` — but in zoomed-
		// coordinate space, so we divide by zoom (because `zoom`
		// is applied first conceptually, then transform operates
		// inside the zoomed box).
		content.style.zoom = String( state.zoom );
		content.style.transform = `translate(${ state.pan.x / state.zoom }px, ${ state.pan.y / state.zoom }px)`;
		toolbar.label.textContent = `${ Math.round( state.zoom * 100 ) }%`;
		listeners.forEach( ( cb ) => cb() );
	};

	const setZoom = (
		next: number,
		focal?: { x: number; y: number },
	): void => {
		const clamped = Math.max( MIN_ZOOM, Math.min( MAX_ZOOM, next ) );
		if ( focal ) {
			// Anchor the focal point: solve for new pan such that
			// `(focal - pan) / zoom` stays constant before/after.
			const ratio = clamped / state.zoom;
			state.pan.x = focal.x - ( focal.x - state.pan.x ) * ratio;
			state.pan.y = focal.y - ( focal.y - state.pan.y ) * ratio;
		}
		state.zoom = clamped;
		apply();
	};

	const resetView = (): void => {
		state.pan = { x: 0, y: 0 };
		state.zoom = 1;
		apply();
	};

	const fitToContent = (): void => {
		// Measure at zoom=1, then compute the scale that fits the
		// content into the viewport with a small margin. We have
		// to reset BOTH `zoom` and `transform` on the content
		// before measuring — otherwise `getBoundingClientRect()`
		// returns the previously-zoomed dimensions and the fit
		// calculation drifts (the symptom: clicking Fit jumps to a
		// different "wrong" percentage every time, never settles).
		content.style.zoom = '1';
		content.style.transform = '';
		// Force layout — the next read picks up the post-reset
		// dimensions, not a stale layout cache.
		void content.offsetHeight;

		// Use `scrollWidth/Height` on the cards container, NOT
		// `getBoundingClientRect()` on `content`. The cardLayer is
		// the actual content extent; `content` itself can have
		// extra layout (padding, position context) that throws the
		// fit math off.
		const cards = content.querySelector< HTMLElement >(
			'.wpdm-routines__cards',
		);
		const naturalW = cards?.scrollWidth || content.scrollWidth || 1;
		const naturalH = cards?.scrollHeight || content.scrollHeight || 1;

		const rootRect = root.getBoundingClientRect();
		const margin = 24;
		const fitX = ( rootRect.width - margin * 2 ) / naturalW;
		const fitY = ( rootRect.height - margin * 2 ) / naturalH;

		// Don't auto-zoom past 100% — Fit means "show me everything",
		// not "magnify a tiny routine to fill the window".
		const fit = Math.max(
			MIN_ZOOM,
			Math.min( 1, Math.min( fitX, fitY ) ),
		);
		state.zoom = fit;

		// Centre the (now-zoomed) content in the viewport.
		const scaledW = naturalW * fit;
		const scaledH = naturalH * fit;
		state.pan = {
			x: ( rootRect.width - scaledW ) / 2,
			y: ( rootRect.height - scaledH ) / 2,
		};
		apply();
	};

	// --- Wheel (cmd/ctrl + wheel = zoom; otherwise pass-through) ---
	root.addEventListener(
		'wheel',
		( ev ) => {
			if ( ! ( ev.ctrlKey || ev.metaKey ) ) {
				return; // let the stage scroll naturally
			}
			ev.preventDefault();
			const rect = root.getBoundingClientRect();
			const focal = {
				x: ev.clientX - rect.left,
				y: ev.clientY - rect.top,
			};
			const next = state.zoom * Math.exp( -ev.deltaY * WHEEL_ZOOM_FACTOR );
			setZoom( next, focal );
		},
		{ passive: false },
	);

	// --- Drag-to-pan from empty background ---
	let dragging:
		| {
				pointerId: number;
				startX: number;
				startY: number;
				panX: number;
				panY: number;
			}
		| null = null;
	root.addEventListener( 'pointerdown', ( ev ) => {
		// Pan starts when the press is NOT on a card / button /
		// input / toolbar. Walking up the DOM with `closest()`
		// covers every empty-area target (cardLayer, branch
		// columns, branches row, content itself) without an
		// allowlist of container ids. Cards stop the pan because
		// their click handlers are the user's "open inspector"
		// gesture; mixing pan + click is bad UX.
		const target = ev.target as HTMLElement | null;
		if (
			target?.closest(
				'.wpdm-routines__card, .wpdm-routines__add, button, input, textarea, select, label, [contenteditable], .wpdm-routines__viewport-toolbar',
			)
		) {
			return;
		}
		if ( ev.button !== 0 && ev.button !== 1 ) {
			return; // left or middle click
		}
		dragging = {
			pointerId: ev.pointerId,
			startX: ev.clientX,
			startY: ev.clientY,
			panX: state.pan.x,
			panY: state.pan.y,
		};
		root.setPointerCapture( ev.pointerId );
		root.classList.add( 'is-panning' );
	} );
	root.addEventListener( 'pointermove', ( ev ) => {
		if ( ! dragging || ev.pointerId !== dragging.pointerId ) {
			return;
		}
		state.pan.x = dragging.panX + ( ev.clientX - dragging.startX );
		state.pan.y = dragging.panY + ( ev.clientY - dragging.startY );
		apply();
	} );
	const endDrag = ( ev: PointerEvent ): void => {
		if ( ! dragging || ev.pointerId !== dragging.pointerId ) {
			return;
		}
		root.releasePointerCapture( ev.pointerId );
		root.classList.remove( 'is-panning' );
		dragging = null;
	};
	root.addEventListener( 'pointerup', endDrag );
	root.addEventListener( 'pointercancel', endDrag );

	// --- Keyboard shortcuts ---
	root.tabIndex = 0;
	root.addEventListener( 'keydown', ( ev ) => {
		if ( ! ( ev.ctrlKey || ev.metaKey ) ) {
			return;
		}
		if ( ev.key === '0' ) {
			ev.preventDefault();
			resetView();
		} else if ( ev.key === '+' || ev.key === '=' ) {
			ev.preventDefault();
			setZoom( state.zoom * 1.2 );
		} else if ( ev.key === '-' ) {
			ev.preventDefault();
			setZoom( state.zoom / 1.2 );
		}
	} );

	// --- Toolbar wiring ---
	toolbar.zoomOut.addEventListener( 'click', () => {
		setZoom( state.zoom / 1.2 );
	} );
	toolbar.zoomIn.addEventListener( 'click', () => {
		setZoom( state.zoom * 1.2 );
	} );
	toolbar.reset.addEventListener( 'click', () => resetView() );
	toolbar.fit.addEventListener( 'click', () => fitToContent() );

	apply();

	return {
		root,
		content,
		pixiHost,
		getState: () => state,
		setZoom,
		resetView,
		fitToContent,
		onChange: ( cb ) => {
			listeners.add( cb );
			return () => listeners.delete( cb );
		},
	};
}

interface ToolbarParts {
	node: HTMLElement;
	zoomOut: HTMLButtonElement;
	zoomIn: HTMLButtonElement;
	reset: HTMLButtonElement;
	fit: HTMLButtonElement;
	label: HTMLSpanElement;
}

function buildToolbar(): ToolbarParts {
	const node = el( 'div', { class: 'wpdm-routines__viewport-toolbar' } );
	const zoomOut = el(
		'button',
		{ class: 'wpdm-routines__viewport-btn', type: 'button', title: 'Zoom out' },
		[ '−' ],
	) as HTMLButtonElement;
	const label = el( 'span', { class: 'wpdm-routines__viewport-label' } );
	label.textContent = '100%';
	const zoomIn = el(
		'button',
		{ class: 'wpdm-routines__viewport-btn', type: 'button', title: 'Zoom in' },
		[ '+' ],
	) as HTMLButtonElement;
	const sep = el( 'span', { class: 'wpdm-routines__viewport-sep' } );
	const fit = el(
		'button',
		{ class: 'wpdm-routines__viewport-btn', type: 'button', title: 'Fit to screen' },
		[ 'Fit' ],
	) as HTMLButtonElement;
	const reset = el(
		'button',
		{ class: 'wpdm-routines__viewport-btn', type: 'button', title: 'Reset view' },
		[ 'Reset' ],
	) as HTMLButtonElement;
	node.append( zoomOut, label, zoomIn, sep, fit, reset );
	return { node, zoomOut, zoomIn, reset, fit, label };
}
