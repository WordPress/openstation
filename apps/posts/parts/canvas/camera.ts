import { wirePinchInput } from '../../../../src/content-graph/pinch-input';
import { workAreaInsetsOf } from '../../../../src/work-area';
import type { PixiApp, PixiContainer, PixiNamespace, PixiPoint, PixiPointerEvent } from './pixi';

export const POST_RING_RADIUS = 170;

export interface Bounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export interface Interaction {
	pixiInteractionAt: number;
	pinchUntil: number;
	lastFocusChange: number;
	panMovedDist: number;
	panActive: boolean;
	panStart: PixiPoint | null;
}

export const createInteraction = (): Interaction => ( {
	pixiInteractionAt: 0, pinchUntil: 0,
	lastFocusChange: 0,
	panMovedDist: 0,
	panActive: false,
	panStart: null,
} );

export const isPinchGesture = ( interaction: Interaction ): boolean => performance.now() < interaction.pinchUntil;

export function stopBubble( interaction: Interaction, e: unknown ): void {
	( e as PixiPointerEvent ).stopPropagation?.();
	interaction.pixiInteractionAt = performance.now();
}

export function pointerTravel( from: PixiPoint | null, ev?: PixiPointerEvent ): number {
	if ( ! from || ! ev?.global ) {
		return Infinity;
	}
	return Math.hypot( ev.global.x - from.x, ev.global.y - from.y );
}

export function isEmptyCanvasClick( interaction: Interaction, e: MouseEvent, canvas: HTMLCanvasElement ): boolean {
	const now = performance.now();
	if ( isPinchGesture( interaction ) || now - interaction.lastFocusChange < 250 || now - interaction.pixiInteractionAt < 250 ) {
		return false;
	}

	if ( interaction.panMovedDist > 4 ) {
		return false;
	}
	return e.target === canvas;
}

export interface Camera {
	targetScale: number;
	targetWorldX: number;
	targetWorldY: number;

	ease(): void;
	stageToWorld( global: PixiPoint ): PixiPoint;

	pan( dx: number, dy: number ): void;

	fitToView( bounds: Bounds | null, opts?: { padding?: number; animate?: boolean } ): void;

	frameOn( x: number, y: number ): boolean;
	dispose(): void;
}

export function createCamera( world: PixiContainer, stage: HTMLElement, gesture?: { start(): void; end(): void } ): Camera {
	const camera: Camera = {
		targetScale: world.scale.x,
		targetWorldX: world.x,
		targetWorldY: world.y,
		ease() {
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
			pinch.dispose();
		},
	};

	function onWheel( e: WheelEvent ): void {
		e.preventDefault();

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

		const wx = ( sx - camera.targetWorldX ) / prev;
		const wy = ( sy - camera.targetWorldY ) / prev;
		camera.targetScale = next;
		camera.targetWorldX = sx - wx * next;
		camera.targetWorldY = sy - wy * next;
	}
	const pinch = wirePinchInput( stage, {
		read: () => ( { x: world.x, y: world.y, scale: world.scale.x } ),
		write: ( next ) => {
			world.scale.set( next.scale ); world.x = next.x; world.y = next.y;
			camera.targetScale = next.scale; camera.targetWorldX = next.x; camera.targetWorldY = next.y;
		},
		bounds: { min: .2, max: 2.5 },
		start: () => gesture?.start(), end: () => gesture?.end(),
	} );
	stage.addEventListener( 'wheel', onWheel, { passive: false } );
	return camera;
}

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

		app.render();

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
