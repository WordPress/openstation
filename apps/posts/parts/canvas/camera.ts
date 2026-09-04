/**
 * Posts app — the camera and the gesture bookkeeping both term
 * canvases share: smooth-zoom targets eased per frame, cursor-anchored
 * wheel zoom, pan, fit-to-view inside the desktop's work area, the
 * focus framing, and the resize-settle observer that refits only when
 * the stage really changed size.
 *
 * @public
 */

import { workAreaInsetsOf } from '../../../../src/work-area';
import type { PixiApp, PixiContainer, PixiNamespace, PixiPoint, PixiPointerEvent } from './pixi';

/** The keep-out ring the satellite posts deploy on. */
export const POST_RING_RADIUS = 170;

export interface Bounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

/**
 * Timestamps and distances the click-vs-drag-vs-pan disambiguation
 * reads. Pixi paints into the canvas, so a click on a node, a
 * satellite or a pager arrow ALSO fires a DOM `click` on the canvas;
 * the canvas-click "close focus" handler bails when a Pixi child just
 * handled a pointer, when the focus just changed, or when the gesture
 * was a pan.
 */
export interface Interaction {
	pixiInteractionAt: number;
	lastFocusChange: number;
	panMovedDist: number;
	panActive: boolean;
	panStart: PixiPoint | null;
}

export const createInteraction = (): Interaction => ( {
	pixiInteractionAt: 0,
	lastFocusChange: 0,
	panMovedDist: 0,
	panActive: false,
	panStart: null,
} );

/** Stop a Pixi pointer event and mark the interaction. */
export function stopBubble( interaction: Interaction, e: unknown ): void {
	( e as PixiPointerEvent ).stopPropagation?.();
	interaction.pixiInteractionAt = performance.now();
}

/** How far a pointer travelled since a press — a tap stays under a few px. */
export function pointerTravel( from: PixiPoint | null, ev?: PixiPointerEvent ): number {
	if ( ! from || ! ev?.global ) {
		return Infinity;
	}
	return Math.hypot( ev.global.x - from.x, ev.global.y - from.y );
}

/** Whether a DOM click on the canvas is a genuine "tap on empty space". */
export function isEmptyCanvasClick( interaction: Interaction, e: MouseEvent, canvas: HTMLCanvasElement ): boolean {
	const now = performance.now();
	if ( now - interaction.lastFocusChange < 250 || now - interaction.pixiInteractionAt < 250 ) {
		return false;
	}
	// A pan with any meaningful movement never counts as a tap.
	if ( interaction.panMovedDist > 4 ) {
		return false;
	}
	return e.target === canvas;
}

export interface Camera {
	targetScale: number;
	targetWorldX: number;
	targetWorldY: number;
	/** Per-frame easing of the live world transform toward the targets. */
	ease(): void;
	stageToWorld( global: PixiPoint ): PixiPoint;
	/** Pan by a screen delta, keeping the targets in step. */
	pan( dx: number, dy: number ): void;
	/** Frame a bounds box; `animate` eases, otherwise snaps. */
	fitToView( bounds: Bounds | null, opts?: { padding?: number; animate?: boolean } ): void;
	/** Frame a focused node + its post ring; false when the stage has no size. */
	frameOn( x: number, y: number ): boolean;
	dispose(): void;
}

/**
 * The camera over a world container inside a stage element. Wheel
 * zoom is bound on the STAGE (a common ancestor of the canvas and
 * any overlay), exponential so trackpads and mice both feel smooth,
 * and anchored at the cursor.
 */
export function createCamera( world: PixiContainer, stage: HTMLElement ): Camera {
	const camera: Camera = {
		targetScale: world.scale.x,
		targetWorldX: world.x,
		targetWorldY: world.y,
		ease() {
			// k≈0.22 settles in ~3-4 frames at 60fps. Skipping the writes
			// at the target avoids floating-point drift over long idles.
			const ZOOM_EASE = 0.22;
			const ds = camera.targetScale - world.scale.x;
			const dwx = camera.targetWorldX - world.x;
			const dwy = camera.targetWorldY - world.y;
			if ( Math.abs( ds ) > 0.0005 || Math.abs( dwx ) > 0.5 || Math.abs( dwy ) > 0.5 ) {
				world.scale.set( world.scale.x + ds * ZOOM_EASE );
				world.x += dwx * ZOOM_EASE;
				world.y += dwy * ZOOM_EASE;
			}
		},
		stageToWorld( global ) {
			return {
				x: ( global.x - world.x ) / world.scale.x,
				y: ( global.y - world.y ) / world.scale.y,
			};
		},
		pan( dx, dy ) {
			world.x += dx;
			world.y += dy;
			camera.targetWorldX += dx;
			camera.targetWorldY += dy;
		},
		fitToView( bounds, opts = {} ) {
			const padding = opts.padding ?? 90;
			const animate = opts.animate ?? false;
			const r = stage.getBoundingClientRect();
			// Fit into the REACHABLE part of the stage: a maximized
			// window's stage runs under the dock pill.
			const inset = workAreaInsetsOf( stage );
			const viewX = inset.left;
			const viewY = inset.top;
			const viewW = Math.max( 0, r.width - inset.left - inset.right );
			const viewH = Math.max( 0, r.height - inset.top - inset.bottom );
			if ( ! bounds || viewW === 0 || viewH === 0 ) {
				const cx = viewX + viewW / 2;
				const cy = viewY + viewH / 2;
				camera.targetScale = 1;
				camera.targetWorldX = cx;
				camera.targetWorldY = cy;
				if ( ! animate ) {
					world.x = cx;
					world.y = cy;
					world.scale.set( 1 );
				}
				return;
			}
			const w = Math.max( 1, bounds.maxX - bounds.minX );
			const h = Math.max( 1, bounds.maxY - bounds.minY );
			const sx = ( viewW - padding * 2 ) / w;
			const sy = ( viewH - padding * 2 ) / h;
			// Cap zoom-IN at 1.5× (tiny graphs shouldn't balloon), allow
			// zoom-OUT to 0.2× so a 200-node tree stays inside the canvas.
			const scale = Math.max( 0.2, Math.min( 1.5, Math.min( sx, sy ) ) );
			const cx = ( bounds.minX + bounds.maxX ) / 2;
			const cy = ( bounds.minY + bounds.maxY ) / 2;
			const newWorldX = viewX + viewW / 2 - cx * scale;
			const newWorldY = viewY + viewH / 2 - cy * scale;
			camera.targetScale = scale;
			camera.targetWorldX = newWorldX;
			camera.targetWorldY = newWorldY;
			if ( ! animate ) {
				world.scale.set( scale );
				world.x = newWorldX;
				world.y = newWorldY;
			}
		},
		frameOn( x, y ) {
			const r = stage.getBoundingClientRect();
			if ( r.width <= 0 || r.height <= 0 ) {
				return false;
			}
			const half = POST_RING_RADIUS + 70;
			const sx = ( r.width * 0.85 ) / ( 2 * half );
			const sy = ( r.height * 0.85 ) / ( 2 * half );
			const newScale = Math.max( 0.5, Math.min( 1.6, Math.min( sx, sy ) ) );
			camera.targetScale = newScale;
			camera.targetWorldX = r.width / 2 - x * newScale;
			camera.targetWorldY = r.height / 2 - y * newScale;
			return true;
		},
		dispose() {
			stage.removeEventListener( 'wheel', onWheel );
		},
	};

	function onWheel( e: WheelEvent ): void {
		e.preventDefault();
		// `Math.exp( -delta * k )` self-adapts: a 100-unit mouse detent
		// → ~1.083×, a 10-unit trackpad nudge → ~1.008×.
		const SENSITIVITY = 0.0008;
		const factor = Math.exp( -e.deltaY * SENSITIVITY );
		const prev = camera.targetScale;
		const next = Math.max( 0.3, Math.min( 2.5, prev * factor ) );
		if ( Math.abs( next - prev ) < 0.0005 ) {
			return;
		}
		const r = stage.getBoundingClientRect();
		const sx = e.clientX - r.left;
		const sy = e.clientY - r.top;
		// Keep the world point under the cursor stationary — against the
		// TARGET transform, so the anchor is stable across rapid ticks.
		const wx = ( sx - camera.targetWorldX ) / prev;
		const wy = ( sy - camera.targetWorldY ) / prev;
		camera.targetScale = next;
		camera.targetWorldX = sx - wx * next;
		camera.targetWorldY = sy - wy * next;
	}
	stage.addEventListener( 'wheel', onWheel, { passive: false } );
	return camera;
}

/**
 * Resize the renderer with the stage and refit only when the size
 * really changed. The first callback with a non-zero size is the
 * "stage is laid out" signal (first fit + reveal); after that an 80ms
 * debounce plus a 24px threshold separates maximize / drag-resize /
 * snap from the sub-pixel reflows a sidebar repaint causes.
 */
export function watchStageSize(
	pixi: PixiNamespace,
	app: PixiApp,
	stage: HTMLElement,
	hooks: { onFirstFit: () => void; onSettle: () => void; onResize?: () => void },
): () => void {
	let firstFitDone = false;
	let settledW = 0;
	let settledH = 0;
	const SETTLE_THRESHOLD_PX = 24;
	const SETTLE_DEBOUNCE_MS = 80;
	let settleTimer: number | null = null;
	const onResize = (): void => {
		const r = stage.getBoundingClientRect();
		app.renderer.resize( r.width, r.height );
		app.stage.hitArea = new pixi.Rectangle( 0, 0, r.width, r.height );
		if ( ! firstFitDone && r.width > 0 && r.height > 0 ) {
			firstFitDone = true;
			settledW = r.width;
			settledH = r.height;
			hooks.onFirstFit();
			stage.classList.remove( 'is-loading' );
		}
		if ( settleTimer !== null ) {
			window.clearTimeout( settleTimer );
		}
		settleTimer = window.setTimeout( () => {
			settleTimer = null;
			const cur = stage.getBoundingClientRect();
			if ( Math.abs( cur.width - settledW ) >= SETTLE_THRESHOLD_PX || Math.abs( cur.height - settledH ) >= SETTLE_THRESHOLD_PX ) {
				settledW = cur.width;
				settledH = cur.height;
				hooks.onSettle();
			}
		}, SETTLE_DEBOUNCE_MS );
		// Render NOW so a continuous resize gesture never leaves the
		// canvas blank between ticker frames.
		app.render();
		// The stage came back (a tab switched to, a window restored):
		// the caller's loop may resume.
		hooks.onResize?.();
	};
	const ro = new ResizeObserver( onResize );
	ro.observe( stage );
	return () => {
		ro.disconnect();
		if ( settleTimer !== null ) {
			window.clearTimeout( settleTimer );
		}
	};
}
