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
import { ForceSim, type ClusterMembership } from './sim';
import {
	SatelliteLayer,
	type SatelliteOnClick,
	type PostTypeIconLookup,
} from './satellites';
import type {
	EdgeKind,
	EdgeKindDescriptor,
	GraphEdge,
	GraphNode,
	GraphPayload,
	LensId,
	PostDetail,
	PostTypeDescriptor,
} from './types';

const NODE_FILL = 0x4b5563;
const NODE_FILL_FOCUS = 0x2c6be5;
const NODE_FILL_NEIGHBOUR = 0x4f8bf3;
const EDGE_BASE = 0x9aa6b6;
const EDGE_HOT = 0x2c6be5;

/**
 * Sentinel cluster key used by `setClusterTaxonomy()` for nodes with
 * no in-scope memberships in the active clustering taxonomy. Mirrors
 * the corresponding constant used by `ForceSim`'s attractor force.
 *
 * @since 0.9.0
 */
const UNCATEGORIZED_KEY = '__uncategorized__';

/**
 * Per-lens config. Constellation keeps today's force-directed layout
 * with no clustering; Galaxy adds the cluster attractor and applies
 * bridge highlighting to edges. Future lenses (Sitemap, Timeline)
 * drop in by adding a third entry.
 *
 * @since 0.9.0
 */
interface LensConfig {
	id: LensId;
	attractorStrength: number;
	showClusterLabels: boolean;
	bridgeHighlighting: boolean;
	intraDimAlpha: number;
}

const LENSES: Record< LensId, LensConfig > = {
	constellation: {
		id: 'constellation',
		attractorStrength: 0,
		showClusterLabels: false,
		bridgeHighlighting: false,
		intraDimAlpha: 0.18,
	},
	galaxy: {
		id: 'galaxy',
		attractorStrength: 0.04,
		showClusterLabels: true,
		bridgeHighlighting: true,
		intraDimAlpha: 0.06,
	},
};

/**
 * Default per-edge-kind visual palette. Mirrors what the server emits
 * via `desktop_mode_content_graph_edge_kind_descriptors()` so the
 * scene can render before the orchestrator hands over the
 * server-provided palette.
 *
 * @since 0.9.0
 */
const DEFAULT_EDGE_PALETTE: Record< EdgeKind, { color: number; weight: number } > = {
	link: { color: EDGE_BASE, weight: 0.7 },
	co_tag: { color: 0x2c6be5, weight: 0.7 },
	co_author: { color: 0x7c3aed, weight: 0.7 },
	hierarchy: { color: 0x059669, weight: 0.7 },
	menu: { color: 0xd97706, weight: 0.7 },
};

function paletteFromDescriptors(
	descriptors: EdgeKindDescriptor[] | undefined,
): Record< EdgeKind, { color: number; weight: number } > {
	if ( ! descriptors || descriptors.length === 0 ) {
		return DEFAULT_EDGE_PALETTE;
	}
	const out: Record< EdgeKind, { color: number; weight: number } > = {
		...DEFAULT_EDGE_PALETTE,
	};
	for ( const d of descriptors ) {
		// Color comes in as a CSS hex string ("#rrggbb") from PHP; parse to int.
		let color = DEFAULT_EDGE_PALETTE[ d.slug ].color;
		const m = /^#([0-9a-f]{6})$/i.exec( d.color );
		if ( m ) {
			color = parseInt( m[ 1 ], 16 );
		}
		out[ d.slug ] = { color, weight: d.weight };
	}
	return out;
}

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
	private nodeLayer!: PixiContainer;
	private clusterLabelLayer!: PixiContainer;
	private labelLayer!: PixiContainer;
	private satellites: SatelliteLayer | null = null;
	private nodeViews = new Map< number, NodeView >();
	private edgeViews: EdgeView[] = [];
	private clusterLabels = new Map< string, PixiText >();
	private nodes: GraphNode[] = [];
	private edges: GraphEdge[] = [];
	private sim: ForceSim | null = null;
	private focusedId: number | null = null;
	private hoveredId: number | null = null;
	private dragNode: GraphNode | null = null;
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
	// Lens state.
	private activeLens: LensConfig = LENSES.constellation;
	private visibleEdgeKinds: Set< EdgeKind > = new Set( [ 'link' ] );
	private clusterTaxonomy: string | null = null;
	private clusterMembership: ClusterMembership | null = null;
	private edgePalette: Record< EdgeKind, { color: number; weight: number } > =
		DEFAULT_EDGE_PALETTE;
	/**
	 * Optional override for cluster-label rendering. Receives the
	 * cluster key (`<taxonomy>:<term_id>` or `__uncategorized__`) and
	 * the live member count, returns the user-facing label string.
	 * When unset, labels default to `#<term_id> (count)` form.
	 *
	 * @since 0.9.0
	 */
	private clusterLabelLookup: ( ( key: string, count: number ) => string ) | null = null;

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
		this.nodeLayer = new pixi.Container();
		this.clusterLabelLayer = new pixi.Container();
		this.labelLayer = new pixi.Container();
		this.world.addChild(
			this.edgeLayer,
			this.nodeLayer,
			this.clusterLabelLayer,
			this.labelLayer,
		);

		this.satellites = new SatelliteLayer(
			pixi,
			this.world,
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
		// Snapshot the focused id BEFORE we rebuild so we can carry
		// it forward when the focused node still exists in the new
		// payload (feasibility-2 fix). Camera target is left untouched
		// across rebuilds; loadGraph()'s lens-switch path explicitly
		// avoids fitToView()/clearFocus() so this state persists.
		const previouslyFocusedId = this.focusedId;

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
			edges.push( { from: f, to: t, kind: e.kind } );
		}
		for ( const n of nodes ) {
			n.radius = 8 + Math.min( 8, Math.sqrt( n.degree ) * 2.4 );
		}

		this.nodes = nodes;
		this.edges = edges;
		this.rebuildSprites();
		this.sim = new ForceSim( nodes, edges, {
			...this.sim?.opts,
			repulsion: 26000,
			springK: 0.04,
			springLen: 200,
			gravity: 0.0035,
			damping: 0.86,
			attractorStrength: this.activeLens.attractorStrength,
		} );
		// Re-apply current cluster membership so the new node set
		// inherits the active Galaxy clustering without an explicit
		// setClusterTaxonomy() round-trip from the orchestrator.
		if ( this.clusterTaxonomy ) {
			this.recomputeClusterMembership();
		}
		this.sim.reheat( 0.15, false );

		// Carry forward focus when the focused node survived the
		// rebuild. If it didn't, clear focus — but DO NOT call
		// fitToView(), the camera target stays where the user left it.
		if (
			previouslyFocusedId !== null &&
			byId.has( previouslyFocusedId )
		) {
			const view = this.nodeViews.get( previouslyFocusedId );
			if ( view ) {
				view.node.pinned = true;
				this.focusedId = previouslyFocusedId;
			} else {
				this.focusedId = null;
			}
		} else {
			this.focusedId = null;
			this.satellites?.clear();
		}
	}

	/**
	 * Switch the active lens. Mutates the sim's force config in
	 * place; does NOT remount the Pixi Application or recreate the
	 * scene graph. Camera target and focused-node state survive the
	 * switch (per AE4).
	 *
	 * @since 0.9.0
	 */
	setLens( lensId: LensId ): void {
		const lens = LENSES[ lensId ];
		if ( ! lens ) {
			return;
		}
		this.activeLens = lens;
		if ( this.sim ) {
			this.sim.setForceConfig( {
				attractorStrength: lens.attractorStrength,
			} );
			this.sim.setClusters(
				lens.attractorStrength > 0 ? this.clusterMembership : null,
			);
			this.sim.reheat( 0.3, false );
		}
		this.draw();
	}

	/**
	 * Set the taxonomy that drives Galaxy clustering. Recomputes
	 * per-node membership from the current node set's `terms` field
	 * and pushes the new map into the sim if Galaxy is active.
	 *
	 * @since 0.9.0
	 */
	setClusterTaxonomy( taxonomySlug: string | null ): void {
		this.clusterTaxonomy = taxonomySlug;
		if ( ! taxonomySlug ) {
			this.clusterMembership = null;
		} else {
			this.recomputeClusterMembership();
		}
		if ( this.sim ) {
			this.sim.setClusters(
				this.activeLens.attractorStrength > 0
					? this.clusterMembership
					: null,
			);
			this.sim.reheat( 0.3, false );
		}
	}

	/**
	 * Replace the visible-edge-kinds set. Pure rendering-only state;
	 * does not refetch.
	 *
	 * @since 0.9.0
	 */
	setVisibleEdgeKinds( kinds: EdgeKind[] ): void {
		this.visibleEdgeKinds = new Set( kinds );
		this.draw();
	}

	/**
	 * Override the per-edge-kind visual palette. Typically supplied
	 * by the orchestrator from `cfg.edgeKinds` so the look-and-feel
	 * is server-controllable.
	 *
	 * @since 0.9.0
	 */
	setEdgePalette( descriptors: EdgeKindDescriptor[] | undefined ): void {
		this.edgePalette = paletteFromDescriptors( descriptors );
		this.draw();
	}

	/**
	 * Override the cluster-label formatter. Orchestrators can plug in
	 * a lookup that maps cluster keys to human-readable term names.
	 *
	 * @since 0.9.0
	 */
	setClusterLabelLookup(
		fn: ( ( key: string, count: number ) => string ) | null,
	): void {
		this.clusterLabelLookup = fn;
	}

	private recomputeClusterMembership(): void {
		const tax = this.clusterTaxonomy;
		if ( ! tax ) {
			this.clusterMembership = null;
			return;
		}
		const m: ClusterMembership = new Map();
		for ( const n of this.nodes ) {
			const ids = n.terms?.[ tax ];
			if ( ids && ids.length > 0 ) {
				m.set(
					n.id,
					ids.map( ( tid ) => `${ tax }:${ tid }` ),
				);
			} else {
				m.set( n.id, [ UNCATEGORIZED_KEY ] );
			}
		}
		this.clusterMembership = m;
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
			label.alpha = 0.85;
			this.labelLayer.addChild( label );

			this.nodeViews.set( n.id, {
				node: n,
				container,
				halo,
				icon,
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
		let isDragging = false;
		let downAt = { x: 0, y: 0 };
		gfx.on( 'pointerdown', ( evt: unknown ) => {
			const e = evt as {
				global: { x: number; y: number };
				stopPropagation?: () => void;
			};
			e.stopPropagation?.();
			isDragging = false;
			downAt = { x: e.global.x, y: e.global.y };
			this.dragNode = node;
			this.nodeClickActive = true;
			node.pinned = true;
			const w = this.toWorld( e.global.x, e.global.y );
			this.dragOffset = { x: node.x - w.x, y: node.y - w.y };
			if ( this.sim ) {
				this.sim.dragOrigin = { x: node.x, y: node.y };
				this.sim.reheat( 0.3, false );
			}
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
			const moved = dx * dx + dy * dy > 9;
			if ( ! moved && ! isDragging ) {
				this.callbacks.onNodeClick?.( node );
			} else {
				// Genuine drag — un-pin so the sim can re-equilibrate
				// around the new position. Click that escalated into
				// focusNode keeps the node pinned (focusNode pins it
				// itself).
				node.pinned = this.focusedId === node.id;
			}
			this.dragNode = null;
			if ( this.sim ) {
				this.sim.dragOrigin = null;
				this.sim.reheat( 0.35, false );
			}
		} );
		gfx.on( 'pointerupoutside', () => {
			node.pinned = this.focusedId === node.id;
			this.dragNode = null;
			if ( this.sim ) {
				this.sim.dragOrigin = null;
			}
		} );
		gfx.on( 'globalpointermove', ( evt: unknown ) => {
			if ( this.dragNode !== node ) {
				return;
			}
			const e = evt as { global: { x: number; y: number } };
			const w = this.toWorld( e.global.x, e.global.y );
			node.x = w.x + this.dragOffset.x;
			node.y = w.y + this.dragOffset.y;
			node.vx = 0;
			node.vy = 0;
			isDragging = true;
			if ( this.sim ) {
				this.sim.dragOrigin = { x: node.x, y: node.y };
				this.sim.reheat( 0.3, false );
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
		this.drawClusterLabels();
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
		const lens = this.activeLens;
		const membership = this.clusterMembership;

		for ( const v of this.edgeViews ) {
			const { edge, gfx } = v;
			gfx.clear();
			// Hide edges of kinds the user has muted via the toolbar.
			if ( ! this.visibleEdgeKinds.has( edge.kind ) ) {
				continue;
			}
			const isFocusEdge =
				focusId !== null &&
				( edge.from.id === focusId || edge.to.id === focusId );
			const isHoverEdge =
				hoverId !== null &&
				( edge.from.id === hoverId || edge.to.id === hoverId );

			// Bridge highlighting (Galaxy only): edges whose endpoints
			// share at least one cluster key fade to the lens's
			// intra-cluster dim alpha; edges that cross clusters or
			// reach into Uncategorized pop at full intensity. Focused
			// satellites (the focused node's own edges) are exempt
			// from fading so the existing satellite UX is unchanged.
			let isIntraCluster = false;
			if ( lens.bridgeHighlighting && membership && ! isFocusEdge ) {
				const a = membership.get( edge.from.id );
				const b = membership.get( edge.to.id );
				if ( a && b ) {
					for ( const k of a ) {
						if ( b.includes( k ) ) {
							isIntraCluster = true;
							break;
						}
					}
				}
			}

			let alpha: number;
			if ( dimmed ) {
				alpha = isFocusEdge ? 0.85 : 0.05;
			} else if ( isIntraCluster ) {
				alpha = lens.intraDimAlpha;
			} else if ( isHoverEdge ) {
				alpha = 0.7;
			} else {
				alpha = 0.55;
			}

			const palette = this.edgePalette[ edge.kind ];
			const baseColor = palette ? palette.color : EDGE_BASE;
			const baseWidth = palette ? palette.weight : 0.7;
			const color =
				isFocusEdge || isHoverEdge ? EDGE_HOT : baseColor;
			const width = isFocusEdge || isHoverEdge ? 1.2 : baseWidth;
			gfx.moveTo( edge.from.x, edge.from.y )
				.lineTo( edge.to.x, edge.to.y )
				.stroke( { color, width, alpha } );
		}

		const inverseScale = 1 / this.world.scale.x;
		const showLabels = this.world.scale.x > 0.85;
		for ( const v of this.nodeViews.values() ) {
			const { node, container, halo, icon, label } = v;
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

			label.x = node.x;
			label.y = node.y + node.radius + 4;
			label.scale.set( inverseScale );
			let labelAlpha = 0;
			if ( showLabels ) {
				if ( isFocus ) {
					labelAlpha = 1;
				} else if ( inFocus ) {
					labelAlpha = 0.85;
				} else {
					labelAlpha = 0.18;
				}
			}
			label.alpha = labelAlpha;
		}
	}

	private drawClusterLabels(): void {
		// Only Galaxy renders cluster labels.
		if ( ! this.activeLens.showClusterLabels || ! this.clusterMembership || ! this.clusterTaxonomy ) {
			// Clear any leftover labels from a prior lens.
			if ( this.clusterLabels.size > 0 ) {
				this.clusterLabelLayer.removeChildren();
				this.clusterLabels.clear();
			}
			return;
		}

		// Compute live centroids + counts. Skip Uncategorized in the
		// label set unless it actually has members; empty terms are
		// hidden by default per R9.
		const centroids = new Map<
			string,
			{ sx: number; sy: number; n: number }
		>();
		for ( const n of this.nodes ) {
			const keys = this.clusterMembership.get( n.id );
			if ( ! keys ) {
				continue;
			}
			for ( const k of keys ) {
				const c = centroids.get( k );
				if ( c ) {
					c.sx += n.x;
					c.sy += n.y;
					c.n += 1;
				} else {
					centroids.set( k, { sx: n.x, sy: n.y, n: 1 } );
				}
			}
		}

		// Reuse PixiText nodes by cluster key; create on first appearance,
		// remove when a cluster has zero members in a subsequent tick.
		const seen = new Set< string >();
		const showLabels = this.world.scale.x > 0.6;
		const inverseScale = 1 / this.world.scale.x;
		for ( const [ key, c ] of centroids ) {
			if ( c.n === 0 ) {
				continue;
			}
			seen.add( key );
			const cx = c.sx / c.n;
			const cy = c.sy / c.n;
			const labelText = this.formatClusterLabel( key, c.n );
			let label = this.clusterLabels.get( key );
			if ( ! label ) {
				label = new this.pixi.Text( {
					text: labelText,
					style: {
						fill: 0x111827,
						fontSize: 12,
						fontFamily:
							'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
						fontWeight: '600',
					},
					resolution: 2,
					anchor: { x: 0.5, y: 1 },
				} );
				this.clusterLabelLayer.addChild( label );
				this.clusterLabels.set( key, label );
			} else if ( label.text !== labelText ) {
				label.text = labelText;
			}
			label.x = cx;
			label.y = cy - 36;
			label.scale.set( inverseScale );
			label.alpha = showLabels ? 0.9 : 0;
		}
		// Tear down labels for clusters that disappeared this tick.
		for ( const [ key, label ] of this.clusterLabels ) {
			if ( ! seen.has( key ) ) {
				this.clusterLabelLayer.removeChild( label );
				try {
					label.destroy();
				} catch {
					// ignore — Pixi sometimes throws on race during teardown.
				}
				this.clusterLabels.delete( key );
			}
		}
	}

	private formatClusterLabel( clusterKey: string, count: number ): string {
		if ( this.clusterLabelLookup ) {
			return this.clusterLabelLookup( clusterKey, count );
		}
		// Default fallback when no lookup is wired up. Cluster key is
		// `<taxonomy>:<term_id>` (or sentinel `__uncategorized__`).
		if ( clusterKey === UNCATEGORIZED_KEY ) {
			return `Uncategorized (${ count })`;
		}
		const idx = clusterKey.lastIndexOf( ':' );
		const tail = idx >= 0 ? clusterKey.slice( idx + 1 ) : clusterKey;
		return `#${ tail } (${ count })`;
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
