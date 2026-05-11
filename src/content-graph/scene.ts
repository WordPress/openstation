/**
 * Content Graph — Pixi scene.
 *
 * Owns the `pixi.Application`, the `world` container (pan + zoom
 * transform), and the four child layers:
 *
 *   1. `edgeLayer`      — line per `GraphEdge` (very thin, low alpha).
 *   2. `nodeLayer`      — small `Graphics` halo + dashicon glyph per
 *      `GraphNode`. The glyph IS the node, sized by degree.
 *   3. `labelLayer`     — text label per node, culled when zoomed out.
 *   4. `satelliteLayer` — `SatelliteLayer` instance fanning out
 *      relationship satellites around the focused node (see
 *      `satellites.ts`).
 *
 * Camera model: smooth target-then-ease, mirroring the `categories-
 * mindmap` reference. Wheel events update `targetScale` / `targetX` /
 * `targetY` exponentially with a sensitivity of 0.0008 per pixel; the
 * tick loop eases the live `world.scale` / `world.x` / `world.y`
 * toward the targets each frame so zoom and recenter feel continuous
 * rather than stepped.
 *
 * Visual policy: dashicon glyph nodes (matching WP admin), dot-grid
 * background (CSS), Obsidian-style sparse mid-zoom layout. Focused
 * node + 1-hop neighbourhood pop in blue; the focused node is
 * *pinned* during focus so it doesn't drift around under the camera.
 *
 * Interactions:
 *   - **Wheel** smoothly zooms with the cursor as the focal point.
 *   - **Drag empty canvas** pans the world.
 *   - **Drag a node** pins it to the cursor and reheats the sim.
 *   - **Click a node** emits `onNodeClick`. The host fetches detail and
 *     calls `setFocusedDetail()`, which paints the satellites.
 *   - **Click background** clears focus + satellites.
 *
 * @public
 * @since 0.8.2
 */

import { resolveDashicon } from '../ui/components/wpd-icon/dashicons-map';
import {
	getPixi,
	type DesktopApiLike,
	type PixiApp,
	type PixiContainer,
	type PixiGraphics,
	type PixiNamespace,
	type PixiText,
} from './pixi-types';
import { ForceSim } from './sim';
import {
	SatelliteLayer,
	type SatelliteOnClick,
	type PostTypeIconLookup,
} from './satellites';
import type {
	GraphEdge,
	GraphNode,
	GraphPayload,
	PostDetail,
	PostTypeDescriptor,
} from './types';

const NODE_FILL = 0x4b5563;
const NODE_FILL_FOCUS = 0x2c6be5;
const NODE_FILL_NEIGHBOUR = 0x4f8bf3;
const EDGE_BASE = 0x9aa6b6;
const EDGE_HOT = 0x2c6be5;

const ZOOM_MIN = 0.15;
const ZOOM_MAX = 4;
const ZOOM_SENSITIVITY = 0.0008;
const CAMERA_EASE = 0.18;
// A tiny snap distance below which we skip easing (avoids the camera
// "buzzing" around the target by sub-pixel amounts forever).
const CAMERA_EPSILON = 0.001;
const RESIZE_RECENTER_THRESHOLD = 24;

export interface SceneCallbacks {
	onNodeClick?: ( node: GraphNode ) => void;
	onBackgroundClick?: () => void;
}

interface NodeView {
	node: GraphNode;
	container: PixiContainer;
	halo: PixiGraphics;
	icon: PixiText;
	labelBox: PixiContainer;
	labelBg: PixiGraphics;
	label: PixiText;
	iconCharCode: string | null;
}

interface EdgeView {
	edge: GraphEdge;
	gfx: PixiGraphics;
}

export class GraphScene {
	private app!: PixiApp;
	private pixi!: PixiNamespace;
	private world!: PixiContainer;
	private edgeLayer!: PixiContainer;
	// Connector spokes from focused node to its satellites — rendered
	// between edges and nodes so the spoke endpoints sit BEHIND the
	// focused node disc instead of being painted across it.
	private spokeLayer!: PixiContainer;
	private nodeLayer!: PixiContainer;
	private labelLayer!: PixiContainer;
	private satellites: SatelliteLayer | null = null;
	private nodeViews = new Map< number, NodeView >();
	private edgeViews: EdgeView[] = [];
	private nodes: GraphNode[] = [];
	private edges: GraphEdge[] = [];
	private sim: ForceSim | null = null;
	private focusedId: number | null = null;
	private hoveredId: number | null = null;
	// Node the pointer is currently interacting with (set on
	// pointerdown, cleared on pointerup/upoutside). Used by every
	// node's `globalpointermove` handler — which fires regardless of
	// which node the user pressed — to early-return if this isn't
	// the press target.
	private pressedNode: GraphNode | null = null;
	private dragOffset = { x: 0, y: 0 };
	private isPanning = false;
	private panStart = { x: 0, y: 0, wx: 0, wy: 0 };
	private nodeClickActive = false;
	private destroyed = false;
	private tickerCb: ( ( t: { deltaTime: number } ) => void ) | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private lastResizeWidth = 0;
	private lastResizeHeight = 0;
	// Camera target system — wheel + focus + fitToView write here, the
	// tick loop eases the actual world.x / world.y / world.scale toward
	// these targets each frame.
	private targetScale = 1;
	private targetX = 0;
	private targetY = 0;
	private host: HTMLElement;
	private callbacks: SceneCallbacks;
	private onSatelliteClick: SatelliteOnClick;
	private postTypeIcon: PostTypeIconLookup;

	constructor(
		host: HTMLElement,
		callbacks: SceneCallbacks,
		onSatelliteClick: SatelliteOnClick,
		postTypes: PostTypeDescriptor[],
	) {
		this.host = host;
		this.callbacks = callbacks;
		this.onSatelliteClick = onSatelliteClick;
		const map = new Map< string, string >();
		for ( const t of postTypes ) {
			map.set( t.slug, normalizeDashiconName( t.icon ) );
		}
		// Always seeded so unknown CPTs without a registered menu_icon
		// still pick up a sensible default.
		this.postTypeIcon = ( slug ) =>
			map.get( slug ) ?? defaultIconForPostType( slug );
	}

	async mount( api: DesktopApiLike ): Promise< void > {
		if ( typeof api.loadModules === 'function' ) {
			await api.loadModules( [ 'pixijs' ] );
		}
		const pixi = getPixi();
		if ( ! pixi ) {
			throw new Error( 'PIXI namespace missing after loadModules.' );
		}
		this.pixi = pixi;

		// Pre-load the dashicons font so Pixi.Text nodes render as
		// glyphs instead of empty boxes on first paint. The font is
		// already declared in WP admin via `dashicons.css`'s @font-face;
		// we just need to force the browser to actually fetch it before
		// we ask Pixi to rasterize text against it.
		if ( typeof document !== 'undefined' && document.fonts ) {
			try {
				await document.fonts.load( '16px dashicons' );
			} catch {
				// Best-effort; if it fails, glyphs may render as boxes
				// momentarily — they pop in once the font lands.
			}
		}

		const app = new pixi.Application();
		await app.init( {
			resizeTo: this.host,
			backgroundAlpha: 0,
			antialias: true,
			autoDensity: true,
			resolution: Math.min( window.devicePixelRatio || 1, 2 ),
		} );
		this.app = app;
		this.host.appendChild( app.canvas );
		app.canvas.classList.add( 'desktop-mode-content-graph__canvas' );

		this.world = new pixi.Container();
		this.world.x = this.host.clientWidth / 2;
		this.world.y = this.host.clientHeight / 2;
		this.world.scale.set( 1 );
		this.targetX = this.world.x;
		this.targetY = this.world.y;
		this.targetScale = 1;
		app.stage.addChild( this.world );

		this.edgeLayer = new pixi.Container();
		this.spokeLayer = new pixi.Container();
		this.nodeLayer = new pixi.Container();
		this.labelLayer = new pixi.Container();
		this.world.addChild(
			this.edgeLayer,
			this.spokeLayer,
			this.nodeLayer,
			this.labelLayer,
		);

		this.satellites = new SatelliteLayer(
			pixi,
			this.world,
			this.spokeLayer,
			this.onSatelliteClick,
			this.host,
			() => {
				this.nodeClickActive = true;
			},
		);

		this.bindStageInput( app.canvas );
		this.bindResize();

		this.tickerCb = ( ticker: { deltaTime: number } ) =>
			this.tick( ticker.deltaTime );
		app.ticker.add( this.tickerCb );
	}

	setData( payload: GraphPayload ): void {
		const prev = new Map< number, GraphNode >();
		for ( const n of this.nodes ) {
			prev.set( n.id, n );
		}

		const nodes: GraphNode[] = payload.nodes.map( ( p ) => {
			const old = prev.get( p.id );
			const angle = Math.random() * Math.PI * 2;
			const r = 150 + Math.random() * 250;
			return {
				...p,
				x: old?.x ?? Math.cos( angle ) * r,
				y: old?.y ?? Math.sin( angle ) * r,
				vx: 0,
				vy: 0,
				pinned: false,
				radius: 4,
				color: NODE_FILL,
				degree: 0,
			};
		} );
		const byId = new Map< number, GraphNode >();
		for ( const n of nodes ) {
			byId.set( n.id, n );
		}

		const edges: GraphEdge[] = [];
		for ( const e of payload.edges ) {
			const f = byId.get( e.from );
			const t = byId.get( e.to );
			if ( ! f || ! t ) {
				continue;
			}
			f.degree++;
			t.degree++;
			edges.push( { from: f, to: t } );
		}
		for ( const n of nodes ) {
			n.radius = 8 + Math.min( 8, Math.sqrt( n.degree ) * 2.4 );
		}

		this.nodes = nodes;
		this.edges = edges;
		this.rebuildSprites();
		this.sim = new ForceSim( nodes, edges );
		this.sim.reheat( 0.12, false );
		// Warm-start: spin the integrator before the first frame so
		// the user opens the window onto a near-settled layout rather
		// than watching the cluster fly into place. Drawing hasn't
		// happened yet (no paint until the ticker fires), so these
		// steps are invisible — they only collapse the period of
		// chaotic motion that made it hard to click a node before.
		const warmupSteps = Math.min( 90, 30 + nodes.length );
		for ( let i = 0; i < warmupSteps; i++ ) {
			this.sim.step( 1 );
		}
	}

	private rebuildSprites(): void {
		this.edgeLayer.removeChildren();
		this.nodeLayer.removeChildren();
		this.labelLayer.removeChildren();
		this.nodeViews.clear();
		this.edgeViews = [];

		for ( const e of this.edges ) {
			const gfx = new this.pixi.Graphics();
			this.edgeLayer.addChild( gfx );
			this.edgeViews.push( { edge: e, gfx } );
		}

		for ( const n of this.nodes ) {
			const container = new this.pixi.Container();
			container.eventMode = 'static';
			container.cursor = 'pointer';
			container.hitArea = new this.pixi.Circle(
				0,
				0,
				Math.max( 18, n.radius + 8 ),
			);
			this.bindNodeInput( container, n );
			this.nodeLayer.addChild( container );

			const halo = new this.pixi.Graphics();
			container.addChild( halo );

			const iconChar = resolveDashicon(
				this.postTypeIcon( n.type ),
			);
			const icon = new this.pixi.Text( {
				text: iconChar ?? '●', // black circle fallback
				style: {
					fontFamily: iconChar ? 'dashicons' : 'sans-serif',
					fontSize: 2 * n.radius,
					fill: NODE_FILL,
				},
				resolution: 2,
				anchor: { x: 0.5, y: 0.5 },
			} );
			container.addChild( icon );

			// Wrap each label in a Container so the backing rect, the
			// text, and the per-node alpha all transform as one unit
			// when the camera zooms. The backing keeps labels readable
			// over busy edge tangles + the dot-grid background — the
			// review feedback flagged unbacked labels as hard to read.
			const labelBox = new this.pixi.Container();
			this.labelLayer.addChild( labelBox );

			const labelBg = new this.pixi.Graphics();
			labelBox.addChild( labelBg );

			const label = new this.pixi.Text( {
				text: this.truncate( n.title || `#${ n.id }`, 32 ),
				style: {
					fill: 0x1f2937,
					fontSize: 11,
					fontFamily:
						'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
					fontWeight: '500',
				},
				resolution: 2,
				anchor: { x: 0.5, y: 0 },
			} );
			labelBox.addChild( label );

			// Draw the backing once now that the text has measured
			// itself. Width doesn't change after construction (we
			// don't mutate label.text after this), so re-painting per
			// frame would be pure waste.
			const padX = 5;
			const padY = 1;
			const lw = label.width + padX * 2;
			const lh = label.height + padY * 2;
			labelBg
				.roundRect( -lw / 2, -padY, lw, lh, 4 )
				.fill( { color: 0xffffff, alpha: 0.78 } )
				.stroke( {
					color: 0x000000,
					alpha: 0.06,
					width: 1,
				} );

			this.nodeViews.set( n.id, {
				node: n,
				container,
				halo,
				icon,
				labelBox,
				labelBg,
				label,
				iconCharCode: iconChar,
			} );
		}
	}

	private truncate( text: string, max: number ): string {
		if ( text.length <= max ) {
			return text;
		}
		return text.slice( 0, max - 1 ).trimEnd() + '…';
	}

	private bindNodeInput( gfx: PixiContainer, node: GraphNode ): void {
		let downAt = { x: 0, y: 0 };
		let isDragging = false;
		// Pointer must travel > 6px to be considered an intentional
		// drag. Below that the pointer-stream is treated as a click,
		// even when Pixi emits incidental `globalpointermove` events
		// between down + up (that incidental flip was the cause of
		// the "click on a moving node didn't open" bug — now we only
		// commit to drag after the user actually moves the cursor).
		const DRAG_THRESHOLD_SQ = 36;
		gfx.on( 'pointerdown', ( evt: unknown ) => {
			const e = evt as {
				global: { x: number; y: number };
				stopPropagation?: () => void;
			};
			e.stopPropagation?.();
			downAt = { x: e.global.x, y: e.global.y };
			this.nodeClickActive = true;
			this.pressedNode = node;
			isDragging = false;
			// Pin so the simulation can't move the node out from
			// under the user's cursor between down and up. We unpin
			// on release (unless this is the focused node, which
			// focusNode pins independently).
			node.pinned = true;
			node.vx = 0;
			node.vy = 0;
		} );
		gfx.on( 'pointerover', () => {
			this.hoveredId = node.id;
			this.draw();
		} );
		gfx.on( 'pointerout', () => {
			if ( this.hoveredId === node.id ) {
				this.hoveredId = null;
				this.draw();
			}
		} );
		gfx.on( 'pointerup', ( evt: unknown ) => {
			const e = evt as { global: { x: number; y: number } };
			const dx = e.global.x - downAt.x;
			const dy = e.global.y - downAt.y;
			// Generous click tolerance even if `isDragging` never
			// flipped — the simulation may still be settling and the
			// cursor may have drifted a few px from the press point.
			if ( ! isDragging && dx * dx + dy * dy <= 256 ) {
				this.callbacks.onNodeClick?.( node );
			}
			node.pinned = this.focusedId === node.id;
			this.pressedNode = null;
			if ( this.sim ) {
				this.sim.dragOrigin = null;
				if ( isDragging ) {
					this.sim.reheat( 0.35, false );
				}
			}
			isDragging = false;
		} );
		gfx.on( 'pointerupoutside', () => {
			node.pinned = this.focusedId === node.id;
			this.pressedNode = null;
			if ( this.sim ) {
				this.sim.dragOrigin = null;
			}
			isDragging = false;
		} );
		gfx.on( 'globalpointermove', ( evt: unknown ) => {
			// Only the pressed node should react. Without this guard,
			// other pinned nodes (e.g. the focused one) would also
			// run the drag-promotion check on every pointer move.
			if ( this.pressedNode !== node ) {
				return;
			}
			const e = evt as { global: { x: number; y: number } };
			const dx = e.global.x - downAt.x;
			const dy = e.global.y - downAt.y;
			const d2 = dx * dx + dy * dy;
			if ( ! isDragging ) {
				if ( d2 < DRAG_THRESHOLD_SQ ) {
					return;
				}
				// Promote: pointer travelled past the threshold, so
				// this is intentional drag. Capture the world-space
				// offset between the cursor and the node's current
				// position so the node "stays put" relative to the
				// cursor while we drag.
				isDragging = true;
				const w = this.toWorld( e.global.x, e.global.y );
				this.dragOffset = { x: node.x - w.x, y: node.y - w.y };
				if ( this.sim ) {
					this.sim.dragOrigin = { x: node.x, y: node.y };
					this.sim.reheat( 0.3, false );
				}
			}
			const w = this.toWorld( e.global.x, e.global.y );
			node.x = w.x + this.dragOffset.x;
			node.y = w.y + this.dragOffset.y;
			node.vx = 0;
			node.vy = 0;
			if ( this.sim ) {
				this.sim.dragOrigin = { x: node.x, y: node.y };
			}
		} );
	}

	private bindStageInput( canvas: HTMLCanvasElement ): void {
		canvas.addEventListener(
			'wheel',
			( ev: WheelEvent ) => {
				ev.preventDefault();
				// Smooth, exponential zoom with cursor-anchored framing.
				// Compose against the *target* (not the live world) so
				// rapid wheel ticks chain correctly while the camera is
				// still easing toward a previous target.
				const factor = Math.exp( -ev.deltaY * ZOOM_SENSITIVITY );
				const nextScale = Math.max(
					ZOOM_MIN,
					Math.min( ZOOM_MAX, this.targetScale * factor ),
				);
				const rect = canvas.getBoundingClientRect();
				const lx = ev.clientX - rect.left;
				const ly = ev.clientY - rect.top;
				const beforeWorldX = ( lx - this.targetX ) / this.targetScale;
				const beforeWorldY = ( ly - this.targetY ) / this.targetScale;
				this.targetScale = nextScale;
				this.targetX = lx - beforeWorldX * nextScale;
				this.targetY = ly - beforeWorldY * nextScale;
			},
			{ passive: false },
		);

		canvas.addEventListener( 'pointerdown', ( ev: PointerEvent ) => {
			if ( ev.target !== canvas ) {
				return;
			}
			if ( this.nodeClickActive ) {
				return;
			}
			this.isPanning = true;
			this.panStart = {
				x: ev.clientX,
				y: ev.clientY,
				wx: this.world.x,
				wy: this.world.y,
			};
		} );
		window.addEventListener( 'pointermove', ( ev: PointerEvent ) => {
			if ( ! this.isPanning || this.nodeClickActive ) {
				return;
			}
			// Direct pan: write both live and target so the camera doesn't
			// lurch back toward an old target after the user releases.
			const newX = this.panStart.wx + ( ev.clientX - this.panStart.x );
			const newY = this.panStart.wy + ( ev.clientY - this.panStart.y );
			this.world.x = newX;
			this.world.y = newY;
			this.targetX = newX;
			this.targetY = newY;
		} );
		window.addEventListener( 'pointerup', ( ev: PointerEvent ) => {
			const nodeWasTarget = this.nodeClickActive;
			this.nodeClickActive = false;
			if ( ! this.isPanning ) {
				return;
			}
			const dx = ev.clientX - this.panStart.x;
			const dy = ev.clientY - this.panStart.y;
			this.isPanning = false;
			if ( ! nodeWasTarget && dx * dx + dy * dy < 9 ) {
				this.callbacks.onBackgroundClick?.();
			}
		} );
	}

	private bindResize(): void {
		this.lastResizeWidth = this.host.clientWidth;
		this.lastResizeHeight = this.host.clientHeight;
		this.resizeObserver = new ResizeObserver( () => {
			const w = this.host.clientWidth;
			const h = this.host.clientHeight;
			this.app.renderer.resize( w, h );
			// Render synchronously so the freshly-resized canvas has
			// pixels NOW. Without this the WebGL drawingBuffer briefly
			// composites as white before the next ticker frame paints —
			// that's the "white flash" the reviewer flagged.
			try {
				this.app.render();
			} catch {
				// Pixi sometimes throws on race during teardown.
			}
			// Sub-pixel sidebar reflows (panel open/close, scroll
			// adjustments) shouldn't trigger camera repositioning. Only
			// genuine window resizes pass the threshold.
			const dw = Math.abs( w - this.lastResizeWidth );
			const dh = Math.abs( h - this.lastResizeHeight );
			if (
				dw >= RESIZE_RECENTER_THRESHOLD ||
				dh >= RESIZE_RECENTER_THRESHOLD
			) {
				this.lastResizeWidth = w;
				this.lastResizeHeight = h;
			}
		} );
		this.resizeObserver.observe( this.host );
	}

	private toWorld(
		clientX: number,
		clientY: number,
	): { x: number; y: number } {
		const rect = this.app.canvas.getBoundingClientRect();
		const lx = clientX - rect.left;
		const ly = clientY - rect.top;
		return {
			x: ( lx - this.world.x ) / this.world.scale.x,
			y: ( ly - this.world.y ) / this.world.scale.y,
		};
	}

	private tick( delta: number ): void {
		if ( this.destroyed ) {
			return;
		}
		this.sim?.step( delta );
		// Ease the camera toward its targets each frame. dt-aware so
		// the feel stays consistent across frame-rate dips. Snap when
		// we're within sub-pixel distance to avoid the buzz.
		const k = 1 - Math.pow( 1 - CAMERA_EASE, delta );
		const ds = this.targetScale - this.world.scale.x;
		if ( Math.abs( ds ) < CAMERA_EPSILON ) {
			this.world.scale.set( this.targetScale );
		} else {
			this.world.scale.set( this.world.scale.x + ds * k );
		}
		const dxc = this.targetX - this.world.x;
		const dyc = this.targetY - this.world.y;
		if ( Math.abs( dxc ) < CAMERA_EPSILON ) {
			this.world.x = this.targetX;
		} else {
			this.world.x += dxc * k;
		}
		if ( Math.abs( dyc ) < CAMERA_EPSILON ) {
			this.world.y = this.targetY;
		} else {
			this.world.y += dyc * k;
		}
		this.draw();
		this.satellites?.drawLinks();
	}

	private draw(): void {
		const focusId = this.focusedId;
		const hoverId = this.hoveredId;

		const focusNeighbours = new Set< number >();
		if ( focusId !== null ) {
			for ( const e of this.edges ) {
				if ( e.from.id === focusId ) {
					focusNeighbours.add( e.to.id );
				}
				if ( e.to.id === focusId ) {
					focusNeighbours.add( e.from.id );
				}
			}
			focusNeighbours.add( focusId );
		}

		const dimmed = focusId !== null;
		// Edges fade in as the user zooms in. At the overview-fit
		// zoom (~0.45-0.55) the graph reads as a constellation of
		// nodes; as the user zooms toward 1×, the post-to-post links
		// crisp up so you can trace connections without having to
		// hover each node. Same band as the labels — edges + labels
		// gain prominence together.
		const edgeZoomFade = smoothstep( 0.45, 1.1, this.world.scale.x );
		const edgeBaseAlpha = 0.2 + edgeZoomFade * 0.35;

		for ( const v of this.edgeViews ) {
			const { edge, gfx } = v;
			gfx.clear();
			const isFocusEdge =
				focusId !== null &&
				( edge.from.id === focusId || edge.to.id === focusId );
			const isHoverEdge =
				hoverId !== null &&
				( edge.from.id === hoverId || edge.to.id === hoverId );
			let alpha: number;
			if ( dimmed ) {
				// Focus edges visible at full prominence; non-focus
				// edges fully hidden (no faint ghost). The line itself
				// is geometry-trimmed so it starts at the focused
				// node's halo edge rather than passing through the
				// disc — see the `lineEndpoints` computation below.
				alpha = isFocusEdge ? 0.85 : 0;
			} else if ( isHoverEdge ) {
				alpha = 0.7;
			} else {
				alpha = edgeBaseAlpha;
			}
			const color = isFocusEdge || isHoverEdge ? EDGE_HOT : EDGE_BASE;
			const width = isFocusEdge || isHoverEdge ? 1.2 : 0.7;
			// Trim either endpoint when it sits on the focused node so
			// the visible line stops at the halo's outer edge instead
			// of running into the disc's centre. The halo radius is
			// `node.radius + 8` (mirrors the halo paint below).
			let sx = edge.from.x;
			let sy = edge.from.y;
			let ex = edge.to.x;
			let ey = edge.to.y;
			if ( focusId !== null ) {
				if ( edge.from.id === focusId ) {
					const p = pointOnSegment(
						edge.from.x,
						edge.from.y,
						edge.to.x,
						edge.to.y,
						edge.from.radius + 8,
					);
					sx = p.x;
					sy = p.y;
				}
				if ( edge.to.id === focusId ) {
					const p = pointOnSegment(
						edge.to.x,
						edge.to.y,
						edge.from.x,
						edge.from.y,
						edge.to.radius + 8,
					);
					ex = p.x;
					ey = p.y;
				}
			}
			gfx.moveTo( sx, sy )
				.lineTo( ex, ey )
				.stroke( { color, width, alpha } );
		}

		const inverseScale = 1 / this.world.scale.x;
		// Smooth fade between two zoom thresholds rather than a hard
		// cutoff. At <= 0.55 labels are invisible; at >= 0.95 they're
		// fully present; in between the alpha eases via smoothstep so
		// pinch-zoom doesn't pop them in/out.
		const zoomFade = smoothstep( 0.55, 0.95, this.world.scale.x );
		for ( const v of this.nodeViews.values() ) {
			const { node, container, halo, icon, labelBox } = v;
			const isFocus = node.id === focusId;
			const isHover = node.id === hoverId;
			const isNeighbour =
				focusId !== null && focusNeighbours.has( node.id );
			const inFocus = focusId === null || isNeighbour;
			const baseAlpha = inFocus ? 1 : 0.25;

			container.x = node.x;
			container.y = node.y;
			container.alpha = baseAlpha;

			let fill = NODE_FILL;
			if ( isFocus ) {
				fill = NODE_FILL_FOCUS;
			} else if ( isNeighbour ) {
				fill = NODE_FILL_NEIGHBOUR;
			}

			halo.clear();
			if ( isFocus || isHover ) {
				halo.circle( 0, 0, node.radius + 8 ).fill( {
					color: fill,
					alpha: 0.18,
				} );
			}

			icon.style.fill = fill;
			icon.style.fontSize = 2 * node.radius;

			labelBox.x = node.x;
			labelBox.y = node.y + node.radius + 4;
			labelBox.scale.set( inverseScale );
			let baseLabelAlpha: number;
			if ( isFocus ) {
				baseLabelAlpha = 1;
			} else if ( inFocus ) {
				baseLabelAlpha = 0.92;
			} else {
				baseLabelAlpha = 0.32;
			}
			labelBox.alpha = baseLabelAlpha * zoomFade;
			labelBox.visible = labelBox.alpha > 0.01;
		}
	}

	focusNode( id: number ): void {
		// Unpin previous focus (if any) so the cluster can move freely.
		if ( this.focusedId !== null ) {
			const prev = this.nodeViews.get( this.focusedId );
			if ( prev ) {
				prev.node.pinned = false;
			}
		}
		this.focusedId = id;
		// Deliberately NO reheat here. With the focused node pinned and
		// the cluster already in equilibrium, reheating would inject a
		// random velocity into every other node and the whole graph
		// would visibly jiggle. The reviewer flagged this as "all nodes
		// move when selecting a node". Camera ease + satellites are
		// enough animation for the focus moment.
		const view = this.nodeViews.get( id );
		if ( view ) {
			view.node.pinned = true;
			view.node.vx = 0;
			view.node.vy = 0;
			const target = view.node;
			const newScale = Math.max( this.targetScale, 1.6 );
			this.targetScale = newScale;
			this.targetX = this.host.clientWidth / 2 - target.x * newScale;
			this.targetY = this.host.clientHeight / 2 - target.y * newScale;
		}
		this.draw();
	}

	setFocusedDetail( detail: PostDetail | null ): void {
		if ( ! this.satellites ) {
			return;
		}
		if ( ! detail || this.focusedId === null ) {
			this.satellites.clear();
			return;
		}
		const node = this.nodeViews.get( this.focusedId )?.node;
		if ( ! node ) {
			this.satellites.clear();
			return;
		}
		this.satellites.setFocused( node, detail );
		// No reheat — satellites have their own entrance animation and
		// reheating here would shake the whole cluster (see focusNode).
	}

	clearFocus(): void {
		if ( this.focusedId !== null ) {
			const view = this.nodeViews.get( this.focusedId );
			if ( view ) {
				view.node.pinned = false;
			}
		}
		this.focusedId = null;
		this.satellites?.clear();
		// Calm re-settle: keep the integrator alive briefly so the
		// previously-pinned node can ease back to equilibrium without
		// a global kick that would jiggle the rest of the cluster.
		this.sim?.reheat( 0.25, false );
		this.draw();
	}

	/**
	 * Mark a satellite by its synthetic key as selected (e.g. when
	 * the side panel switches to that satellite's dossier). Pass
	 * `null` to clear the selection — done when the panel navigates
	 * back to the post view or closes entirely.
	 */
	setSatelliteSelectedKey( key: string | null ): void {
		this.satellites?.setSelectedKey( key );
	}

	getNode( id: number ): GraphNode | undefined {
		return this.nodes.find( ( n ) => n.id === id );
	}

	getNodes(): GraphNode[] {
		return this.nodes;
	}

	fitToView(): void {
		if ( this.nodes.length === 0 ) {
			return;
		}
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for ( const n of this.nodes ) {
			if ( n.x < minX ) {
				minX = n.x;
			}
			if ( n.y < minY ) {
				minY = n.y;
			}
			if ( n.x > maxX ) {
				maxX = n.x;
			}
			if ( n.y > maxY ) {
				maxY = n.y;
			}
		}
		const padding = 100;
		const w = maxX - minX + padding * 2;
		const h = maxY - minY + padding * 2;
		const sx = this.host.clientWidth / w;
		const sy = this.host.clientHeight / h;
		const s = Math.max( ZOOM_MIN, Math.min( 1.5, Math.min( sx, sy ) ) );
		const cx = ( minX + maxX ) / 2;
		const cy = ( minY + maxY ) / 2;
		this.targetScale = s;
		this.targetX = this.host.clientWidth / 2 - cx * s;
		this.targetY = this.host.clientHeight / 2 - cy * s;
	}

	destroy(): void {
		this.destroyed = true;
		if ( this.tickerCb ) {
			this.app.ticker.remove( this.tickerCb );
			this.tickerCb = null;
		}
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		this.satellites?.destroy();
		this.satellites = null;
		try {
			this.app.destroy( true, { children: true } );
		} catch {
			// ignore — Pixi sometimes throws on race during teardown.
		}
	}
}

/**
 * Strip a leading `dashicons-` prefix and reject http(s) URL icons
 * (those are theme-supplied images, not part of the dashicons font).
 * Returns a sensible default if the input doesn't match a dashicon.
 */
function normalizeDashiconName( raw: string ): string {
	if ( typeof raw !== 'string' || raw === '' ) {
		return 'admin-generic';
	}
	if ( raw.startsWith( 'http://' ) || raw.startsWith( 'https://' ) ) {
		return 'admin-generic';
	}
	return raw.replace( /^dashicons-/, '' );
}

/**
 * Walk `distance` units from `(fromX, fromY)` along the ray that
 * points at `(toX, toY)`. Used to trim edge / spoke endpoints to the
 * focused node's halo edge so lines don't visibly run through the
 * disc.
 */
function pointOnSegment(
	fromX: number,
	fromY: number,
	toX: number,
	toY: number,
	distance: number,
): { x: number; y: number } {
	const dx = toX - fromX;
	const dy = toY - fromY;
	const d = Math.sqrt( dx * dx + dy * dy );
	if ( d === 0 ) {
		return { x: fromX, y: fromY };
	}
	const t = Math.min( distance / d, 1 );
	return { x: fromX + dx * t, y: fromY + dy * t };
}

function smoothstep( a: number, b: number, x: number ): number {
	if ( x <= a ) {
		return 0;
	}
	if ( x >= b ) {
		return 1;
	}
	const t = ( x - a ) / ( b - a );
	return t * t * ( 3 - 2 * t );
}

function defaultIconForPostType( slug: string ): string {
	switch ( slug ) {
		case 'post':
			return 'admin-post';
		case 'page':
			return 'admin-page';
		case 'attachment':
			return 'admin-media';
		default:
			return 'admin-generic';
	}
}
