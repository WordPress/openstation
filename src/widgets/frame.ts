/**
 * Desktop Mode — Widget frame.
 *
 * The shell-side wrapper around each widget's body. Owns:
 *
 *   - the card DOM (close button, optional chrome header, body slot)
 *   - the optional resize handles
 *   - pointer logic for dragging from the chrome + resizing from a
 *     handle
 *   - "liberate on drag" transition: a column-docked movable widget
 *     flips to absolute positioning the instant the user first drags
 *     it, then stays floating.
 *
 * Kept separate from `layer.ts` so the lifecycle / persistence logic
 * and the pointer math don't pile up in one file. The frame knows
 * nothing about localStorage — it calls back via `handlers` so the
 * layer can persist + fire hooks at the right moments.
 *
 * @since 0.8.0
 */

import { __, sprintf } from '../i18n';
import type { WidgetDef, WidgetGeometry } from './types';

const FLOATING_CLASS = 'desktop-mode-widgets__card--floating';
const MOVABLE_CLASS = 'desktop-mode-widgets__card--movable';
const RESIZABLE_CLASS = 'desktop-mode-widgets__card--resizable';
const DRAGGING_CLASS = 'desktop-mode-widgets__card--dragging';
const RESIZING_CLASS = 'desktop-mode-widgets__card--resizing';

/** Safe fallback minimums for widgets that don't declare their own. */
const DEFAULT_MIN_WIDTH = 160;
const DEFAULT_MIN_HEIGHT = 80;
const DEFAULT_WIDTH = 280;
const DEFAULT_HEIGHT = 180;

/** Keep 20 px between the card and the viewport edges during drag. */
const VIEWPORT_MARGIN = 20;

/**
 * Drag threshold (squared) — pointer must move this far from the
 * pointerdown origin before the drag gesture commits. Below this,
 * the press + release is treated as a click (no liberate, no geometry
 * change). Matches the window title-bar threshold so the two gestures
 * feel consistent.
 *
 * Squared to save a sqrt in the hot move handler.
 */
const DRAG_THRESHOLD_PX = 5;
const DRAG_THRESHOLD_SQUARED = DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX;

/**
 * Non-chrome inputs that must NEVER initiate a drag even if the user's
 * pointerdown lands on their parent chrome. Stops the classic
 * "try-to-type-in-input → drag-the-widget" UX bug.
 */
const DRAG_EXCLUDED_SELECTORS =
	'input, textarea, select, button, a, [contenteditable="true"]';

/** One resize direction: both axes combined. `null` axis = locked. */
type ResizeDir = 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export interface FrameHandlers {
	/** Fired when the user clicks the × button in the chrome / card corner. */
	onRemove(): void;
	/**
	 * Fired after the user finishes a drag or resize — handler
	 * persists + fires hooks. Called with the current geometry in
	 * desktop-area-local coordinates; handler is free to clamp /
	 * reject.
	 */
	onGeometryChanged( geometry: WidgetGeometry ): void;
	/**
	 * Fired the first time a column-docked movable widget is dragged
	 * (the "liberate" transition). Handler should re-parent the card
	 * into the floating container and flag the widget as floating in
	 * its state.
	 */
	onLiberate( initialGeometry: WidgetGeometry ): void;
	/**
	 * Fired when the user clicks the re-dock button in the chrome of
	 * a floating widget. Handler should clear persisted geometry,
	 * re-parent the card back into the right-column list, and remove
	 * the `--floating` class so the card drops back into flow.
	 * Inverse of `onLiberate`.
	 */
	onRedock(): void;
}

export interface FrameContext {
	/**
	 * Parent element that floating widgets live inside. Used both for
	 * re-parenting on liberate and for bounds clamping during drag +
	 * resize.
	 */
	floatingParent: HTMLElement;
	/** Persisted geometry for this id, or undefined for column-docked. */
	geometry: WidgetGeometry | undefined;
}

export interface Frame {
	card: HTMLElement;
	body: HTMLElement;
	/** Remove all DOM + tear down pointer listeners. */
	dispose(): void;
}

/**
 * Build the widget frame for `def`. Initial parent/placement is up
 * to the caller — the frame only returns the pre-wired DOM tree.
 * When the user acts (drag / resize / remove), the corresponding
 * handler fires.
 */
export function buildFrame(
	def: WidgetDef,
	ctx: FrameContext,
	handlers: FrameHandlers,
): Frame {
	const card = document.createElement( 'div' );
	card.className = 'desktop-mode-widgets__card';
	card.dataset.widgetId = def.id;

	const movable = def.movable === true;
	const resizable = def.resizable === true;
	if ( movable ) {
		card.classList.add( MOVABLE_CLASS );
	}
	if ( resizable ) {
		card.classList.add( RESIZABLE_CLASS );
	}

	// Chrome header only renders for movable widgets. Non-movable
	// widgets keep the classic close-on-hover × in the top-right.
	if ( movable ) {
		card.appendChild( buildChrome( def, handlers.onRemove, handlers.onRedock ) );
	} else {
		card.appendChild( buildCornerClose( def, handlers.onRemove ) );
	}

	const body = document.createElement( 'div' );
	body.className = 'desktop-mode-widgets__card-body';
	card.appendChild( body );

	// Pre-apply saved geometry if the widget is already floating. The
	// caller (layer) handles which parent to insert into — we just
	// own the inline styles.
	let isFloating = false;
	if ( ctx.geometry ) {
		applyGeometry( card, ctx.geometry );
		card.classList.add( FLOATING_CLASS );
		isFloating = true;
	}

	// Resize handles — always built for resizable widgets, but only
	// the ones that match the movable state are visible (CSS hides
	// non-matching dirs). We attach listeners to every handle
	// regardless; the hidden ones simply never receive pointerdown.
	const resizeCleanups: Array< () => void > = [];
	if ( resizable ) {
		for ( const dir of allHandleDirs() ) {
			const handle = document.createElement( 'div' );
			handle.className = `desktop-mode-widgets__resize desktop-mode-widgets__resize--${ dir }`;
			handle.setAttribute( 'aria-hidden', 'true' );
			handle.dataset.dir = dir;
			card.appendChild( handle );
			resizeCleanups.push(
				attachResize( card, handle, dir, def, ctx, handlers, () => isFloating ),
			);
		}
	}

	// Drag only wires on the chrome (querySelector on the built card).
	// Re-capture the chrome ref after append so we don't close over a
	// stale reference if a future refactor swaps in a different
	// builder.
	let dragCleanup: ( () => void ) | null = null;
	if ( movable ) {
		const chrome = card.querySelector<HTMLElement>(
			'.desktop-mode-widgets__chrome',
		);
		if ( chrome ) {
			dragCleanup = attachDrag( card, chrome, def, ctx, handlers, ( next ) => {
				isFloating = next;
			} );
		}
	}

	return {
		card,
		body,
		dispose: () => {
			for ( const fn of resizeCleanups ) {
				try {
					fn();
				} catch {
					/* best effort */
				}
			}
			if ( dragCleanup ) {
				try {
					dragCleanup();
				} catch {
					/* best effort */
				}
			}
			card.remove();
		},
	};
}

// ------------------------------------------------------------------
// DOM builders
// ------------------------------------------------------------------

function buildChrome(
	def: WidgetDef,
	onRemove: () => void,
	onRedock: () => void,
): HTMLElement {
	const chrome = document.createElement( 'header' );
	chrome.className = 'desktop-mode-widgets__chrome';

	const grip = document.createElement( 'span' );
	grip.className = 'desktop-mode-widgets__grip';
	grip.setAttribute( 'aria-hidden', 'true' );
	// Six dots in a 2×3 pattern — universal "drag me" affordance,
	// rendered via CSS background so we ship no extra SVG.
	chrome.appendChild( grip );

	const title = document.createElement( 'span' );
	title.className = 'desktop-mode-widgets__title';
	title.textContent = def.label;
	chrome.appendChild( title );

	// Re-dock button — inverse of the drag-to-liberate transition.
	// Rendered unconditionally but hidden by CSS unless the card
	// carries `--floating`, so a docked widget shows only the close
	// button while a floating widget shows re-dock + close side by
	// side. Cheaper than rebuilding chrome on state change.
	chrome.appendChild( buildRedockButton( def, onRedock ) );

	const close = buildCloseButton( def, onRemove );
	chrome.appendChild( close );

	return chrome;
}

/**
 * Build the re-dock button — arrow pointing to the right-column
 * home. Click fires `onRedock`, which the layer turns into a
 * "remove geometry + re-parent to column" op (the inverse of
 * liberate). Visibility is CSS-gated on the `--floating` class so
 * it never appears on a docked widget; the DOM stays stable
 * regardless.
 */
function buildRedockButton(
	def: WidgetDef,
	onRedock: () => void,
): HTMLButtonElement {
	const btn = document.createElement( 'button' );
	btn.type = 'button';
	btn.className = 'desktop-mode-widgets__card-redock';
	btn.setAttribute(
		'aria-label',
		// translators: %s is the widget label (e.g., "Clock")
		sprintf( __( 'Dock %s back to widget column' ), def.label ),
	);
	// Right-arrow + edge glyph: a rail-ish affordance pointing to
	// where the widget is going back to. Inline SVG so the icon
	// picks up `currentColor` like the close button above.
	btn.innerHTML =
		'<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">' +
		'<path d="M2 6h6M5.5 3.5L8 6l-2.5 2.5M10 2.5v7" ' +
		'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" ' +
		'stroke-linejoin="round" fill="none"/></svg>';
	btn.addEventListener( 'click', ( e ) => {
		e.preventDefault();
		e.stopPropagation();
		onRedock();
	} );
	// Drag-excluded — click on the button must fire the handler
	// cleanly, not start a reparent-drag on the chrome.
	btn.dataset.noDrag = 'true';
	return btn;
}

function buildCornerClose( def: WidgetDef, onRemove: () => void ): HTMLElement {
	// Non-movable widgets keep today's top-right floating × — unchanged
	// from the pre-0.8 layout.
	const close = buildCloseButton( def, onRemove );
	close.classList.add( 'desktop-mode-widgets__card-close--corner' );
	return close;
}

function buildCloseButton(
	def: WidgetDef,
	onRemove: () => void,
): HTMLButtonElement {
	const close = document.createElement( 'button' );
	close.type = 'button';
	close.className = 'desktop-mode-widgets__card-close';
	// translators: %s is the widget label (e.g., "Clock")
	close.setAttribute( 'aria-label', sprintf( __( 'Remove %s' ), def.label ) );
	close.innerHTML =
		'<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">' +
		'<path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" ' +
		'stroke-width="1.6" stroke-linecap="round"/></svg>';
	close.addEventListener( 'click', ( e ) => {
		e.preventDefault();
		e.stopPropagation();
		onRemove();
	} );
	return close;
}

// ------------------------------------------------------------------
// Pointer: drag
// ------------------------------------------------------------------

function attachDrag(
	card: HTMLElement,
	chrome: HTMLElement,
	def: WidgetDef,
	ctx: FrameContext,
	handlers: FrameHandlers,
	setFloating: ( next: boolean ) => void,
): () => void {
	let pointerId: number | null = null;
	let startX = 0;
	let startY = 0;
	let initialLeft = 0;
	let initialTop = 0;
	/**
	 * True once the pointer has moved past `DRAG_THRESHOLD_PX` from
	 * its origin — only then do we liberate a docked widget, add the
	 * `--dragging` class, and fire `onGeometryChanged` on release. A
	 * plain click on the chrome (press + release without crossing
	 * the threshold) is a no-op, so clicking the title to e.g.
	 * dismiss a tooltip doesn't accidentally fling the widget out of
	 * the column.
	 */
	let committed = false;

	const onDown = ( e: PointerEvent ): void => {
		if ( e.button !== 0 ) {
			return;
		}
		const target = e.target as HTMLElement | null;
		// Don't hijack clicks on interactive chrome children (close btn,
		// future toolbar buttons). Drag-excluded selectors also cover
		// the unlikely case of a custom chrome extension putting an
		// input in the header.
		if ( target && target.closest( DRAG_EXCLUDED_SELECTORS ) ) {
			return;
		}
		e.preventDefault();

		pointerId = e.pointerId;
		startX = e.clientX;
		startY = e.clientY;
		committed = false;
		// Capture the CURRENT geometry so the first real move-frame has
		// a correct anchor. For docked cards this stays zero and is
		// overwritten by `commitDrag` once the user crosses the
		// threshold; for floating cards we read the live inline-style
		// values so drag math works without a special case later.
		initialLeft = parseFloat( card.style.left ) || 0;
		initialTop = parseFloat( card.style.top ) || 0;
		chrome.setPointerCapture( pointerId );
	};

	/**
	 * Cross-the-threshold commit. For a docked card this is the
	 * liberate transition: snapshot on-screen position, re-parent
	 * into the floating host, fire `onLiberate`. For an already-
	 * floating card it's just "start drag visuals" — the geometry
	 * was already written on the card. Called at most once per
	 * drag session.
	 */
	const commitDrag = (): void => {
		if ( ! card.classList.contains( FLOATING_CLASS ) ) {
			const parentRect = ctx.floatingParent.getBoundingClientRect();
			const rect = card.getBoundingClientRect();
			// Preserve the CURRENT on-screen size when liberating —
			// fall back to the registered defaults only when the
			// card hasn't been laid out yet (rect.width / height ===
			// 0). The previous order (`def.defaultWidth ?? rect.width`)
			// always snapped back to the registered size, which broke
			// widgets that mutate their own height in column mode —
			// e.g. the Heartbeat widget's compact (88 px) state was
			// stretched back to its registered 230 px on liberate,
			// leaving an empty band where the heart used to be. What
			// the user sees in the column is what they should keep
			// when floating.
			const initial: WidgetGeometry = {
				x: rect.left - parentRect.left,
				y: rect.top - parentRect.top,
				width: rect.width || def.defaultWidth || DEFAULT_WIDTH,
				height: rect.height || def.defaultHeight || DEFAULT_HEIGHT,
			};
			applyGeometry( card, initial );
			card.classList.add( FLOATING_CLASS );
			setFloating( true );
			handlers.onLiberate( initial );
			// Re-read the inline styles — the applyGeometry call
			// above just wrote them. Without this, the first
			// move-frame would anchor at 0,0 and the card would jump
			// to the cursor instead of moving relative to its
			// on-screen position.
			initialLeft = parseFloat( card.style.left ) || 0;
			initialTop = parseFloat( card.style.top ) || 0;
		}
		card.classList.add( DRAGGING_CLASS );
	};

	const onMove = ( e: PointerEvent ): void => {
		if ( pointerId === null || e.pointerId !== pointerId ) {
			return;
		}
		const dx = e.clientX - startX;
		const dy = e.clientY - startY;

		// Threshold gate — below it, the press is still ambiguous
		// (click-maybe vs. drag-maybe). Above it, we commit and
		// start moving pixels.
		if ( ! committed ) {
			if ( dx * dx + dy * dy < DRAG_THRESHOLD_SQUARED ) {
				return;
			}
			committed = true;
			commitDrag();
		}

		const clamped = clampToParent(
			initialLeft + dx,
			initialTop + dy,
			card.offsetWidth,
			card.offsetHeight,
			ctx.floatingParent,
		);
		card.style.left = `${ clamped.x }px`;
		card.style.top = `${ clamped.y }px`;
	};

	const onUp = ( e: PointerEvent ): void => {
		if ( pointerId === null || e.pointerId !== pointerId ) {
			return;
		}
		try {
			chrome.releasePointerCapture( pointerId );
		} catch {
			/* already released */
		}
		pointerId = null;
		// Pure-click release (no threshold crossed) — tear down
		// pointer state but don't touch the card's classes or fire
		// `onGeometryChanged`. The widget stays exactly as it was.
		if ( ! committed ) {
			return;
		}
		committed = false;
		card.classList.remove( DRAGGING_CLASS );
		handlers.onGeometryChanged( currentGeometry( card ) );
	};

	chrome.addEventListener( 'pointerdown', onDown );
	chrome.addEventListener( 'pointermove', onMove );
	chrome.addEventListener( 'pointerup', onUp );
	chrome.addEventListener( 'pointercancel', onUp );

	return () => {
		chrome.removeEventListener( 'pointerdown', onDown );
		chrome.removeEventListener( 'pointermove', onMove );
		chrome.removeEventListener( 'pointerup', onUp );
		chrome.removeEventListener( 'pointercancel', onUp );
	};
}

// ------------------------------------------------------------------
// Pointer: resize
// ------------------------------------------------------------------

function attachResize(
	card: HTMLElement,
	handle: HTMLElement,
	dir: ResizeDir,
	def: WidgetDef,
	ctx: FrameContext,
	handlers: FrameHandlers,
	isFloating: () => boolean,
): () => void {
	let pointerId: number | null = null;
	let startX = 0;
	let startY = 0;
	let startLeft = 0;
	let startTop = 0;
	let startW = 0;
	let startH = 0;

	const onDown = ( e: PointerEvent ): void => {
		if ( e.button !== 0 ) {
			return;
		}
		// Non-movable widget — width axis is locked, so a `w` / `e` /
		// corner direction that tries to change width becomes a no-op
		// when the user's pointer moves. We still accept the grab for
		// the height axis when it's a bottom handle; everything else
		// bails early to avoid a dead drag.
		if ( ! isFloating() && ! isHeightOnlyDir( dir ) ) {
			return;
		}
		e.preventDefault();
		e.stopPropagation();

		pointerId = e.pointerId;
		startX = e.clientX;
		startY = e.clientY;
		const rect = card.getBoundingClientRect();
		const parentRect = ctx.floatingParent.getBoundingClientRect();
		startLeft = rect.left - parentRect.left;
		startTop = rect.top - parentRect.top;
		startW = rect.width;
		startH = rect.height;
		handle.setPointerCapture( pointerId );
		card.classList.add( RESIZING_CLASS );
	};

	const onMove = ( e: PointerEvent ): void => {
		if ( pointerId === null || e.pointerId !== pointerId ) {
			return;
		}
		const dx = e.clientX - startX;
		const dy = e.clientY - startY;
		const next = computeResize(
			dir,
			dx,
			dy,
			startLeft,
			startTop,
			startW,
			startH,
			def,
			ctx.floatingParent,
			isFloating(),
		);

		// Only floating widgets get their left/top rewritten — docked
		// widgets stay column-positioned so the column layout keeps
		// flowing around them.
		if ( isFloating() ) {
			card.style.left = `${ next.x }px`;
			card.style.top = `${ next.y }px`;
			card.style.width = `${ next.width }px`;
		}
		card.style.height = `${ next.height }px`;
	};

	const onUp = ( e: PointerEvent ): void => {
		if ( pointerId === null || e.pointerId !== pointerId ) {
			return;
		}
		try {
			handle.releasePointerCapture( pointerId );
		} catch {
			/* already released */
		}
		pointerId = null;
		card.classList.remove( RESIZING_CLASS );
		handlers.onGeometryChanged( currentGeometry( card ) );
	};

	handle.addEventListener( 'pointerdown', onDown );
	handle.addEventListener( 'pointermove', onMove );
	handle.addEventListener( 'pointerup', onUp );
	handle.addEventListener( 'pointercancel', onUp );

	return () => {
		handle.removeEventListener( 'pointerdown', onDown );
		handle.removeEventListener( 'pointermove', onMove );
		handle.removeEventListener( 'pointerup', onUp );
		handle.removeEventListener( 'pointercancel', onUp );
	};
}

// ------------------------------------------------------------------
// Geometry helpers
// ------------------------------------------------------------------

function allHandleDirs(): ResizeDir[] {
	return [ 'n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw' ];
}

function isHeightOnlyDir( dir: ResizeDir ): boolean {
	return dir === 's';
}

export function applyGeometry(
	card: HTMLElement,
	geometry: WidgetGeometry,
): void {
	card.style.left = `${ geometry.x }px`;
	card.style.top = `${ geometry.y }px`;
	card.style.width = `${ geometry.width }px`;
	card.style.height = `${ geometry.height }px`;
}

function currentGeometry( card: HTMLElement ): WidgetGeometry {
	return {
		x: parseFloat( card.style.left ) || 0,
		y: parseFloat( card.style.top ) || 0,
		width: card.offsetWidth,
		height: card.offsetHeight,
	};
}

function clampToParent(
	x: number,
	y: number,
	width: number,
	height: number,
	parent: HTMLElement,
): { x: number; y: number } {
	const parentWidth = parent.clientWidth || parent.getBoundingClientRect().width;
	const parentHeight =
		parent.clientHeight || parent.getBoundingClientRect().height;
	const maxX = Math.max( 0, parentWidth - width - VIEWPORT_MARGIN );
	const maxY = Math.max( 0, parentHeight - height - VIEWPORT_MARGIN );
	return {
		x: Math.min( Math.max( VIEWPORT_MARGIN, x ), maxX ),
		y: Math.min( Math.max( VIEWPORT_MARGIN, y ), maxY ),
	};
}

/**
 * Compute a new `{x, y, width, height}` for a resize drag. Factored
 * out so the move handler stays linear and the bounds logic is unit-
 * testable. Respects per-def min/max and the parent container bounds.
 */
export function computeResize(
	dir: ResizeDir,
	dx: number,
	dy: number,
	startLeft: number,
	startTop: number,
	startW: number,
	startH: number,
	def: WidgetDef,
	parent: HTMLElement,
	floating: boolean,
): WidgetGeometry {
	const minW = def.minWidth ?? DEFAULT_MIN_WIDTH;
	const minH = def.minHeight ?? DEFAULT_MIN_HEIGHT;
	const maxW = def.maxWidth ?? Infinity;
	const maxH = def.maxHeight ?? Infinity;
	const parentWidth = parent.clientWidth || parent.getBoundingClientRect().width;
	const parentHeight =
		parent.clientHeight || parent.getBoundingClientRect().height;

	let x = startLeft;
	let y = startTop;
	let width = startW;
	let height = startH;

	if ( dir === 'e' || dir === 'ne' || dir === 'se' ) {
		width = clamp( startW + dx, minW, Math.min( maxW, parentWidth - startLeft ) );
	}
	if ( dir === 'w' || dir === 'nw' || dir === 'sw' ) {
		const nextWidth = clamp( startW - dx, minW, Math.min( maxW, startLeft + startW ) );
		x = startLeft + ( startW - nextWidth );
		width = nextWidth;
	}
	if ( dir === 's' || dir === 'se' || dir === 'sw' ) {
		height = clamp(
			startH + dy,
			minH,
			Math.min( maxH, parentHeight - startTop ),
		);
	}
	if ( dir === 'n' || dir === 'ne' || dir === 'nw' ) {
		const nextHeight = clamp( startH - dy, minH, Math.min( maxH, startTop + startH ) );
		y = startTop + ( startH - nextHeight );
		height = nextHeight;
	}

	// Non-floating (column-docked) widgets ignore any width change —
	// width stays at startW and x never moves. We still compute the
	// candidate above so `clamp()` runs and the math stays symmetric;
	// here we undo the width axis if the widget is locked.
	if ( ! floating ) {
		width = startW;
		x = startLeft;
	}

	return { x, y, width, height };
}

function clamp( value: number, min: number, max: number ): number {
	if ( max < min ) {
		return min;
	}
	return Math.min( Math.max( value, min ), max );
}
