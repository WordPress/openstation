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

import { __ } from '../i18n';
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
	GraphGroupCatalogs,
	GraphNode,
	GraphPayload,
	GroupFacet,
	PostDetail,
	PostTypeDescriptor,
} from './types';

const NODE_FILL = 0x4b5563;
const NODE_FILL_FOCUS = 0x2c6be5;
const NODE_FILL_NEIGHBOUR = 0x4f8bf3;
const EDGE_BASE = 0x9aa6b6;
const EDGE_HOT = 0x2c6be5;

/**
 * Per-dashicon visual-centre nudge applied on top of the
 * `(0.5, 0.5)` text anchor — same idea as satellites'
 * `KIND_ICON_NUDGE`, but stored as a fraction of the live fontSize
 * because the node icon's size scales with `2 * node.radius`. Values
 * are bbox-centre → visible-centre offsets:
 *
 *   - `Y_ASCENT` is a universal baseline correction (the dashicons
 *     font's bbox is `ascent + descent` and the descent below the
 *     baseline is unused space, so bbox-centred always parks the
 *     visible glyph slightly above world-y=0).
 *   - Per-icon entries override the baseline when the glyph is also
 *     visually off-balance left-right (e.g. `admin-post`'s pushpin
 *     head sits in the upper-left of its bbox, so the visible glyph
 *     reads as top-left unless we nudge it down + right).
 *
 * Values are tuned against rendered output; pushing further without
 * re-checking at multiple zoom levels usually over-shoots.
 */
const ICON_NUDGE_Y_ASCENT = 0;
const ICON_NUDGE: Record< string, { x: number; y: number } > = {
	'admin-post': { x: 0.06, y: 0.06 },
};

/**
 * Per-facet tint for cluster label pills. Picked so each facet
 * reads as its own "kind" at a glance and so cluster labels
 * cannot be confused with node titles (which are dark text on
 * a white pill). White text on a saturated background gives
 * the visual contrast.
 *
 * The year + year-month facets share the orange tint — both are
 * date buckets, so visually grouping them is correct.
 *
 * CSS strings (not Pixi colour ints) because cluster labels
 * render as DOM elements over the canvas, not as Pixi children.
 * Earlier they were Pixi `Graphics + Text`, but Pixi v8's batched
 * renderer would intermittently crash with "Cannot read properties
 * of null (reading 'clear')" when an external event (e.g. opening
 * another desktop-mode window in an iframe) perturbed the canvas's
 * GL context. DOM labels sidestep the Pixi renderer entirely.
 */
const GROUP_LABEL_COLOR: Record< GroupFacet, string > = {
	category: '#2c6be5',
	tag: '#2ca97a',
	author: '#7c3aed',
	year: '#ea580c',
	year_month: '#ea580c',
};

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
	iconName: string;
}

interface EdgeView {
	edge: GraphEdge;
	gfx: PixiGraphics;
}

/**
 * One label marker per non-empty cluster. Rendered as a DOM
 * element overlaid on the Pixi canvas (see `GROUP_LABEL_COLOR`
 * for why DOM, not Pixi). Repositioned each tick at the centroid
 * of its member nodes, projected from world coords to canvas-local
 * screen coords. `members` is the node-id list captured at grouping
 * time so the per-frame centroid recompute is O(memberCount)
 * instead of O(all nodes).
 */
interface GroupView {
	key: string;
	label: string;
	el: HTMLDivElement;
	members: number[];
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
	// Per-cluster label DOM overlay — see the `GROUP_LABEL_COLOR`
	// comment for why these are DOM elements, not Pixi children.
	// The overlay sits absolutely positioned inside `host`, above
	// the Pixi canvas, with `pointer-events: none` so it never
	// steals interaction from the node layer.
	private groupLabelOverlay: HTMLDivElement | null = null;
	private satellites: SatelliteLayer | null = null;
	private nodeViews = new Map< number, NodeView >();
	private edgeViews: EdgeView[] = [];
	private groupViews = new Map< string, GroupView >();
	private currentGrouping: GroupFacet | null = null;
	// Captured at setData() time; consulted by setGrouping() to
	// resolve display labels for cluster markers (e.g. category names,
	// author display names) without re-fetching.
	private groupCatalogs: GraphGroupCatalogs = {
		authors: {},
		categories: {},
		tags: {},
	};
	/**
	 * Active grouping-change tween, or `null` when no transition is in
	 * flight. While set, the per-frame tick lerps each non-pinned
	 * node's position from its `start` to its `target` (ease-out
	 * cubic) and SKIPS the sim integration so the two layout
	 * mechanisms don't fight. When complete, the sim resumes and the
	 * cluster force refines the final positions.
	 *
	 * Lets the user see a smooth flow to clusters instead of the
	 * earlier hard snap, while still arriving at the well-separated
	 * end state from the first frame (no need to drag a node to
	 * trigger the "good" layout).
	 */
	private groupingTween: {
		startTime: number;
		duration: number;
		starts: Map< number, { x: number; y: number } >;
		targets: Map< number, { x: number; y: number } >;
	} | null = null;
	// Auto-fit-follow loop. After grouping is applied, the initial
	// `fitToViewOfTargets` frames the seed positions; the cluster
	// force then refines and members can drift past the framed
	// viewport. While the layout is still moving, refit every tick;
	// once peak velocity falls below the threshold, stop chasing.
	// Hard-capped at `fitFollowMaxDurationMs` so a stuck high-motion
	// situation (e.g. user drags a node mid-settle) never grabs the
	// camera forever.
	private fitFollowActive = false;
	private fitFollowStartedAt = 0;
	// Has any peak-velocity sample since arming been above the threshold?
	// Without this gate, the first `advanceFitFollow` after the tween
	// ends finds velocities at exactly 0 (the tween zeroes them every
	// frame by design) and disarms before the cluster force has a
	// chance to inject any motion at all.
	private fitFollowSawMotion = false;
	private readonly fitFollowMaxDurationMs = 3000;
	private readonly fitFollowVelocityThreshold = 1.0;
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
	private postTypes: PostTypeDescriptor[];

	constructor(
		host: HTMLElement,
		callbacks: SceneCallbacks,
		onSatelliteClick: SatelliteOnClick,
		postTypes: PostTypeDescriptor[],
	) {
		this.host = host;
		this.callbacks = callbacks;
		this.onSatelliteClick = onSatelliteClick;
		this.postTypes = postTypes;
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
			// Dedicated ticker, NOT the shared one. Other desktop-mode
			// bundles (posts-window, recycle-bin, …) also load Pixi via
			// `loadModules('pixijs')` — sharing `Ticker.shared` across
			// independent Application instances has bitten us: a render
			// triggered by another bundle's app would also drive our
			// renderer, sometimes while the browser had perturbed our
			// canvas (iframe mount, layout shift) and our pipes weren't
			// ready, producing the "Cannot read properties of null
			// (reading 'clear')" crash inside `Batcher.break()`.
			sharedTicker: false,
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
		// DOM overlay for cluster labels, layered above the Pixi
		// canvas. Pointer-events disabled so clicks pass through to
		// the canvas.
		this.groupLabelOverlay = document.createElement( 'div' );
		this.groupLabelOverlay.className =
			'desktop-mode-content-graph__group-labels';
		this.host.appendChild( this.groupLabelOverlay );

		// Pixi v8's WebGL context can be lost when the browser shuffles
		// canvases around (e.g. when another desktop-mode window opens
		// in an iframe and forces a reflow). Without this guard the
		// ticker keeps trying to render against a dead GL context and
		// floods the console with "Cannot read properties of null"
		// crashes. We stop the ticker on loss; the user can reload to
		// recover. Restoration would require rebuilding all GPU pipes
		// — deferred.
		app.canvas.addEventListener(
			'webglcontextlost',
			( ev ) => {
				ev.preventDefault();
				try {
					this.app?.ticker?.stop();
				} catch {
					// Ignore — best-effort.
				}
			},
			false,
		);

		// Belt-and-braces: wrap the renderer's `render()` method so any
		// internal Pixi crash (e.g., the `Batcher.break()` "Cannot read
		// properties of null (reading 'clear')" race triggered when
		// another Pixi.Application on the page destroys shared state)
		// catches the throw, stops our ticker, and prevents the
		// infinite-rAF console spam the user reported. The Pixi auto-
		// render runs on the same ticker our `tickerCb` is on, so an
		// unhandled throw inside it would otherwise keep firing every
		// frame forever.
		const renderer = app.renderer as { render: ( ...a: unknown[] ) => unknown };
		const origRender = renderer.render.bind( renderer );
		renderer.render = ( ...a: unknown[] ) => {
			try {
				return origRender( ...a );
			} catch ( err ) {
				try {
					this.app?.ticker?.stop();
				} catch {
					// Ignore.
				}
				// eslint-disable-next-line no-console
				console.warn(
					'[content-graph] Pixi render threw, stopping ticker:',
					err,
				);
				return undefined;
			}
		};

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
		// Capture the group catalog up-front so subsequent setGrouping()
		// calls (including the auto-re-apply at the end of this method
		// when the user had a facet active across a refetch) can
		// resolve display labels without a round-trip.
		this.groupCatalogs = payload.groups ?? {
			authors: {},
			categories: {},
			tags: {},
		};

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
		// If a grouping was active before this rebuild (e.g. the post-type
		// filter changed mid-session), re-derive the assignment against
		// the new node set so the cluster force keeps working.
		if ( this.currentGrouping ) {
			this.setGrouping( this.currentGrouping );
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

			const iconName = this.postTypeIcon( n.type );
			const iconChar = resolveDashicon( iconName );
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
				iconName,
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
			if ( this.destroyed ) {
				return;
			}
			const w = this.host.clientWidth;
			const h = this.host.clientHeight;
			// Hidden / detached host has clientWidth/clientHeight = 0.
			// `renderer.resize(0, 0)` puts Pixi v8's batched renderer
			// into a state that crashes the next render with
			// "Cannot read properties of null (reading 'clear')",
			// which then floods rAF for the rest of the session. Skip
			// the resize entirely while we're zero-sized; the next
			// observation, when the host has dimensions again, will
			// catch up.
			if ( w <= 0 || h <= 0 ) {
				return;
			}
			try {
				this.app.renderer.resize( w, h );
			} catch {
				return;
			}
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
		// Defensive: the Pixi app's ticker also drives the internal
		// renderer. If we've been torn down between frames, bail
		// before touching any layer / graphics state.
		if ( ! this.app || ! this.world ) {
			return;
		}
		if ( this.groupingTween ) {
			// While the grouping tween is active, lerp positions
			// toward the targets and SKIP the sim integration so the
			// two layout mechanisms don't fight. Once the tween
			// completes the sim resumes and the cluster force
			// polishes the final positions.
			this.advanceGroupingTween();
		} else {
			this.sim?.step( delta );
		}
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
		this.drawGroupLabels();
		this.satellites?.drawLinks();
		this.advanceFitFollow();
	}

	/**
	 * Per-tick auto-fit while the layout is still moving after a
	 * grouping change. Re-frames the camera at the current node
	 * bounds whenever peak velocity is above the threshold; once
	 * the layout has settled (or the hard cap has elapsed) the
	 * loop disarms and the camera stays put. Skips while the
	 * grouping tween is mid-lerp — velocities are zeroed there by
	 * design, and the initial `fitToViewOfTargets` already framed
	 * the target bounds.
	 */
	private advanceFitFollow(): void {
		if ( ! this.fitFollowActive ) {
			return;
		}
		if (
			performance.now() - this.fitFollowStartedAt >
			this.fitFollowMaxDurationMs
		) {
			this.fitFollowActive = false;
			return;
		}
		// During the tween, our `advanceGroupingTween` zeroes vx/vy
		// every frame — peak velocity is 0 by construction. Don't
		// disarm on that account: wait until the tween hands control
		// back to the sim and real motion (or stillness) is observable.
		if ( this.groupingTween ) {
			return;
		}
		let peakVelocity = 0;
		for ( const n of this.nodes ) {
			if ( n.pinned ) {
				continue;
			}
			const v = Math.hypot( n.vx, n.vy );
			if ( v > peakVelocity ) {
				peakVelocity = v;
			}
		}
		if ( peakVelocity >= this.fitFollowVelocityThreshold ) {
			this.fitFollowSawMotion = true;
			this.fitToView();
		} else if ( this.fitFollowSawMotion ) {
			// Only disarm AFTER we've observed non-zero motion at
			// least once. Otherwise the first tick after the tween
			// ends — when the sim hasn't yet run a step and velocities
			// are still zero from the tween — would disarm before the
			// cluster force gets a chance to spread members past the
			// initial fit framing.
			this.fitFollowActive = false;
		}
	}

	private postTypeSupportsTaxonomy( typeSlug: string, taxonomy: 'category' | 'post_tag' ): boolean {
		const pt = this.postTypes.find( ( t ) => t.slug === typeSlug );
		// Unknown type (not registered in the scene's post-type list) is
		// treated as not supporting the taxonomy so it gets its own
		// cat:type_<slug> / tag:type_<slug> cluster rather than silently
		// merging into the shared Uncategorized / Untagged pool.
		return pt ? pt.taxonomies[ taxonomy ] : false;
	}

	private postTypeLabel( typeSlug: string ): string {
		const pt = this.postTypes.find( ( t ) => t.slug === typeSlug );
		return pt?.label ?? typeSlug;
	}

	private deriveGroupKeys( n: GraphNode, facet: GroupFacet ): string[] {
		switch ( facet ) {
			case 'category':
				if ( ! this.postTypeSupportsTaxonomy( n.type, 'category' ) ) {
					return [ `cat:type_${ n.type }` ];
				}
				if ( n.category_ids.length === 0 ) {
					return [ 'cat:uncat' ];
				}
				return n.category_ids.map( ( id ) => `cat:${ id }` );
			case 'tag':
				if ( ! this.postTypeSupportsTaxonomy( n.type, 'post_tag' ) ) {
					return [ `tag:type_${ n.type }` ];
				}
				if ( n.tag_ids.length === 0 ) {
					return [ 'tag:untagged' ];
				}
				return n.tag_ids.map( ( id ) => `tag:${ id }` );
			case 'author': {
				const primaryId = n.author_id || 0;
				const primaryKey = `author:${ primaryId }`;
				// List the primary author TWICE so the cluster
				// attractor weights its pull 2× per contributor.
				// Result: a post with one contributor settles at the
				// (2·primary + 1·contributor) / 3 balance point —
				// between the two authors but closer to the primary.
				// Posts with no contributors get the same 2× pull,
				// which is mathematically equivalent to a single
				// entry (force magnitude is unchanged after the
				// sim's `perKey = k / keys.length` normalisation),
				// so doubling is safe across the board.
				const keys = [ primaryKey, primaryKey ];
				// Defensive: an older cached server payload (predates
				// the `contributor_ids` field) deserialises to
				// undefined here. TS thinks it's required, but at
				// runtime we accept missing/null/non-array and treat
				// it as an empty contributor list rather than throwing.
				const contribs = Array.isArray( n.contributor_ids )
					? n.contributor_ids
					: [];
				for ( const cid of contribs ) {
					if ( cid > 0 && cid !== primaryId ) {
						keys.push( `author:${ cid }` );
					}
				}
				return keys;
			}
			case 'year':
				return [ `year:${ n.year || 0 }` ];
			case 'year_month':
				return [ `ym:${ n.year_month || 'unknown' }` ];
		}
	}

	private labelForGroupKey( key: string ): string {
		const idx = key.indexOf( ':' );
		const facet = key.slice( 0, idx );
		const rest = key.slice( idx + 1 );
		switch ( facet ) {
			case 'cat': {
				if ( rest === 'uncat' ) {
					return __( 'Uncategorized' );
				}
				if ( rest.startsWith( 'type_' ) ) {
					return this.postTypeLabel( rest.slice( 5 ) );
				}
				const id = Number( rest );
				return this.groupCatalogs.categories[ id ]?.name ?? `#${ id }`;
			}
			case 'tag': {
				if ( rest === 'untagged' ) {
					return __( 'Untagged' );
				}
				if ( rest.startsWith( 'type_' ) ) {
					return this.postTypeLabel( rest.slice( 5 ) );
				}
				const id = Number( rest );
				return this.groupCatalogs.tags[ id ]?.name ?? `#${ id }`;
			}
			case 'author': {
				const id = Number( rest );
				if ( id <= 0 ) {
					return __( 'Unknown author' );
				}
				return this.groupCatalogs.authors[ id ]?.name ?? `#${ id }`;
			}
			case 'year': {
				const y = Number( rest );
				if ( y <= 0 ) {
					return __( 'Undated' );
				}
				return String( y );
			}
			case 'ym': {
				if ( rest === 'unknown' || rest === '' ) {
					return __( 'Undated' );
				}
				return formatYearMonth( rest );
			}
		}
		return key;
	}

	private buildGroupViews(
		members: Map< string, number[] >,
		facet: GroupFacet,
	): void {
		if ( ! this.groupLabelOverlay ) {
			return;
		}
		const tint = GROUP_LABEL_COLOR[ facet ];
		for ( const [ key, ids ] of members ) {
			if ( ids.length === 0 ) {
				continue;
			}
			// Suffix the member count so readers see cluster size at a
			// glance, e.g. "Recipe (15)" / "Untagged (3)".
			const label = `${ this.labelForGroupKey( key ) } (${ ids.length })`;
			const el = document.createElement( 'div' );
			el.className = 'desktop-mode-content-graph__group-label';
			el.textContent = label;
			el.style.setProperty( '--wpd-cg-cluster-color', tint );
			this.groupLabelOverlay.appendChild( el );
			this.groupViews.set( key, { key, label, el, members: ids } );
		}
	}

	private clearGroupViews(): void {
		for ( const v of this.groupViews.values() ) {
			v.el.remove();
		}
		this.groupViews.clear();
	}

	/**
	 * Per-frame paint of the cluster label markers. Centroid is the
	 * running average of member positions, scale is inverse of world
	 * scale (so labels stay legible across zoom), alpha fades the
	 * labels OUT as you zoom past the focused-node range so they
	 * don't clutter the close-up view.
	 */
	private drawGroupLabels(): void {
		if ( this.destroyed || this.groupViews.size === 0 ) {
			return;
		}
		// Mirror of the node-label fade, inverted: present at low
		// zoom (cluster reading), gone at high zoom (close-up).
		const fade = 1 - smoothstep( 1.2, 2.4, this.world.scale.x );
		const scale = this.world.scale.x;
		const ox = this.world.x;
		const oy = this.world.y;
		for ( const v of this.groupViews.values() ) {
			let sumX = 0;
			let sumY = 0;
			let count = 0;
			for ( const id of v.members ) {
				const node = this.nodeViews.get( id )?.node;
				if ( ! node ) {
					continue;
				}
				sumX += node.x;
				sumY += node.y;
				count++;
			}
			if ( count === 0 || fade <= 0.02 ) {
				v.el.style.display = 'none';
				continue;
			}
			// Pure centroid positioning — labels glide smoothly with
			// the cluster's centre of mass. Tried and rejected: top-of-
			// bounding-box anchoring (read as detached from the
			// cluster), and per-frame collision push-away (members
			// rotating under the label made it twitch). Fluidity over
			// strict non-overlap; some overlap with a node passing
			// through the label is the accepted trade-off.
			const screenX = ox + ( sumX / count ) * scale;
			const screenY = oy + ( sumY / count ) * scale;
			v.el.style.display = '';
			v.el.style.transform = `translate(${ screenX }px, ${ screenY }px) translate(-50%, -50%)`;
			v.el.style.opacity = String( fade );
		}
	}

	private draw(): void {
		if ( this.destroyed ) {
			return;
		}
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
			const fontSize = 2 * node.radius;
			icon.style.fontSize = fontSize;
			// Nudge the glyph onto the visible disc centre. Without this
			// the bbox-centred anchor leaves glyphs (notably `admin-post`
			// — the pushpin head is in the upper-left of its bbox) reading
			// as top-left of where the user expects them.
			const nudge = ICON_NUDGE[ v.iconName ];
			icon.x = ( nudge?.x ?? 0 ) * fontSize;
			icon.y = ( ( nudge?.y ?? ICON_NUDGE_Y_ASCENT ) ) * fontSize;

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

	/**
	 * Swap the active clustering facet. Pass `null` to disable
	 * clustering entirely. Computes the per-node group assignment from
	 * the current node set, hands it to the sim (which reheats), and
	 * rebuilds the per-cluster label markers in `groupLabelLayer`.
	 *
	 * Cheap to call repeatedly — there's no Pixi teardown beyond
	 * destroying / recreating the small `GroupView` containers.
	 */
	setGrouping( facet: GroupFacet | null ): void {
		this.currentGrouping = facet;
		this.clearGroupViews();
		if ( ! facet || ! this.sim ) {
			this.sim?.setGroupAssignment( null );
			return;
		}
		const assignment = new Map< number, string[] >();
		// `members` is built alongside the assignment so the per-frame
		// centroid recompute in drawGroupLabels() doesn't have to walk
		// every node for every group.
		const members = new Map< string, number[] >();
		for ( const n of this.nodes ) {
			const keys = this.deriveGroupKeys( n, facet );
			assignment.set( n.id, keys );
			// Dedupe before populating `members` — `deriveGroupKeys`
			// can list the same key twice on purpose (e.g. the
			// primary author gets a 2× weighting), and we don't want
			// that duplication to inflate the visual "(15)" count
			// or pull the cluster centroid toward duplicated nodes.
			const seen = new Set< string >();
			for ( const key of keys ) {
				if ( seen.has( key ) ) {
					continue;
				}
				seen.add( key );
				const list = members.get( key );
				if ( list ) {
					list.push( n.id );
				} else {
					members.set( key, [ n.id ] );
				}
			}
		}
		const order = this.chronologicalOrder( facet, members );
		// Year-month produces ~60 clusters on a long-lived blog, all
		// jammed onto one horizontal line in chronological order →
		// crowded. Alternating Y above / below the axis gives each
		// cluster its own vertical "lane" while keeping the time
		// reading. Year alone (single-digit cluster count) stays on
		// the straight axis.
		this.sim.groupOrderStaggerY = facet === 'year_month' ? 160 : 0;
		// Hand the assignment to the sim BEFORE starting the tween so
		// the cluster force is already wired up when the tween hands
		// motion control back. The sim's reheat does nothing visible
		// during the tween (tick skips sim.step while the tween runs).
		this.sim.setGroupAssignment( assignment, order );
		// Build per-node target positions on the seed lattice, then
		// hand them to the tween. Camera is fit-to-view'd against the
		// targets so it zooms in parallel with the layout instead of
		// waiting for the tween to finish.
		const targets = this.buildGroupSeedTargets( assignment, members, order );
		this.startGroupingTween( targets );
		this.fitToViewOfTargets( targets );
		this.buildGroupViews( members, facet );
		// Arm the auto-fit-follow. Stays active until peak velocity
		// falls below the threshold post-tween (sim has settled) or
		// the hard-cap duration elapses, whichever comes first.
		this.fitFollowActive = true;
		this.fitFollowStartedAt = performance.now();
		this.fitFollowSawMotion = false;
	}

	/**
	 * Drive one frame of the active grouping tween. Lerps each
	 * non-pinned node from its captured start position to its target
	 * with an ease-out cubic. Cleans up + resumes the sim when done.
	 */
	private advanceGroupingTween(): void {
		if ( this.destroyed ) {
			return;
		}
		const tween = this.groupingTween;
		if ( ! tween ) {
			return;
		}
		const t = Math.min( 1, ( performance.now() - tween.startTime ) / tween.duration );
		const k = 1 - Math.pow( 1 - t, 3 );
		for ( const [ nodeId, start ] of tween.starts ) {
			const target = tween.targets.get( nodeId );
			if ( ! target ) {
				continue;
			}
			const node = this.nodeViews.get( nodeId )?.node;
			if ( ! node || node.pinned ) {
				continue;
			}
			node.x = start.x + ( target.x - start.x ) * k;
			node.y = start.y + ( target.y - start.y ) * k;
			node.vx = 0;
			node.vy = 0;
		}
		if ( t >= 1 ) {
			this.groupingTween = null;
			// Brief reheat so the cluster force can polish positions
			// post-tween (clusters land near their seeds; the force
			// settles any small drift from emergent Y centroids).
			this.sim?.reheat( 0.18, false );
		}
	}

	/**
	 * Compute a per-cluster seed position + per-node target on that
	 * seed. The tween animates each node from its current position
	 * to its target so the user sees a smooth flow into clusters
	 * instead of an instant snap.
	 *
	 * Seeds:
	 *   - **Ordered facets** (year, year-month): a horizontal lattice
	 *     matching the order array, so chronological clusters land
	 *     in the same left-to-right slots the cluster force pins
	 *     them to. Unordered keys (e.g. `'ym:unknown'`) sit to the
	 *     right of the chronological range.
	 *   - **Unordered facets** (category, tag, author): polar
	 *     distribution around the origin, radius scaling with the
	 *     number of groups. Floor keeps small group counts (2–3)
	 *     visually distinct.
	 *
	 * Multi-membership posts (a post in two categories) target the
	 * average of their group seeds so they start at the force-balance
	 * midpoint instead of being arbitrarily assigned to one cluster.
	 */
	private buildGroupSeedTargets(
		assignment: Map< number, string[] >,
		members: Map< string, number[] >,
		order: string[] | null,
	): Map< number, { x: number; y: number } > {
		const targets = new Map< number, { x: number; y: number } >();
		if ( ! this.sim ) {
			return targets;
		}
		const groupKeys = Array.from( members.keys() );
		const seeds = new Map< string, { x: number; y: number } >();
		const spacing = this.sim.groupOrderSpacing;

		if ( order && order.length > 0 ) {
			const n = order.length;
			// Mirror the sim's zig-zag exactly so the tween lands on
			// the cluster force's target Y instead of snapping at
			// `y=0` then jumping to ±stagger on the first sim step.
			const stagger = this.sim.groupOrderStaggerY;
			const staggerY = ( idx: number ): number => {
				if ( stagger <= 0 ) {
					return 0;
				}
				return idx % 2 === 0 ? -stagger : stagger;
			};
			for ( let i = 0; i < n; i++ ) {
				seeds.set( order[ i ], {
					x: ( i - ( n - 1 ) / 2 ) * spacing,
					y: staggerY( i ),
				} );
			}
			let extra = n;
			for ( const k of groupKeys ) {
				if ( seeds.has( k ) ) {
					continue;
				}
				seeds.set( k, {
					x: ( extra - ( n - 1 ) / 2 ) * spacing,
					y: staggerY( extra ),
				} );
				extra++;
			}
		} else {
			const n = groupKeys.length;
			const radius = Math.max( 220, 120 + n * 40 );
			for ( let i = 0; i < n; i++ ) {
				const angle = ( i / Math.max( 1, n ) ) * Math.PI * 2 - Math.PI / 2;
				seeds.set( groupKeys[ i ], {
					x: Math.cos( angle ) * radius,
					y: Math.sin( angle ) * radius,
				} );
			}
		}

		const jitter = 40;
		for ( const node of this.nodes ) {
			if ( node.pinned ) {
				continue;
			}
			const keys = assignment.get( node.id );
			if ( ! keys || keys.length === 0 ) {
				continue;
			}
			let sx = 0;
			let sy = 0;
			let count = 0;
			for ( const k of keys ) {
				const s = seeds.get( k );
				if ( ! s ) {
					continue;
				}
				sx += s.x;
				sy += s.y;
				count++;
			}
			if ( count === 0 ) {
				continue;
			}
			targets.set( node.id, {
				x: sx / count + ( Math.random() - 0.5 ) * jitter,
				y: sy / count + ( Math.random() - 0.5 ) * jitter,
			} );
		}
		return targets;
	}

	/**
	 * Capture the current positions as the tween starts, set the
	 * tween clock, and let `tick()` drive each frame from there.
	 * Replaces any in-flight tween — picking a new facet mid-tween
	 * just retargets from wherever the nodes currently sit.
	 */
	private startGroupingTween(
		targets: Map< number, { x: number; y: number } >,
	): void {
		if ( targets.size === 0 ) {
			this.groupingTween = null;
			return;
		}
		const starts = new Map< number, { x: number; y: number } >();
		for ( const nodeId of targets.keys() ) {
			const node = this.nodeViews.get( nodeId )?.node;
			if ( ! node ) {
				continue;
			}
			starts.set( nodeId, { x: node.x, y: node.y } );
		}
		this.groupingTween = {
			startTime: performance.now(),
			// Fast enough to feel responsive, long enough to read as
			// a real transition (not a snap). Tuned by feel; if it
			// looks sluggish on slow machines, drop to 350.
			duration: 450,
			starts,
			targets,
		};
	}

	/**
	 * Frame the camera against the target bounds (not the current
	 * node positions) so the zoom-out animates IN PARALLEL with the
	 * layout tween instead of waiting for it to settle.
	 */
	private fitToViewOfTargets(
		targets: Map< number, { x: number; y: number } >,
	): void {
		if ( targets.size === 0 ) {
			return;
		}
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for ( const t of targets.values() ) {
			if ( t.x < minX ) {
				minX = t.x;
			}
			if ( t.y < minY ) {
				minY = t.y;
			}
			if ( t.x > maxX ) {
				maxX = t.x;
			}
			if ( t.y > maxY ) {
				maxY = t.y;
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

	/**
	 * For date facets, sort the keys oldest-to-newest so the cluster
	 * attractor can lay them out left-to-right. For other facets,
	 * returns `null` — those clusters stay fully emergent.
	 *
	 * `'year:<unknown>'` and `'ym:unknown'` are skipped from the
	 * order: an undated post shouldn't bias one end of the timeline.
	 */
	private chronologicalOrder(
		facet: GroupFacet,
		members: Map< string, number[] >,
	): string[] | null {
		if ( facet !== 'year' && facet !== 'year_month' ) {
			return null;
		}
		const ordered: { key: string; sort: string }[] = [];
		for ( const key of members.keys() ) {
			const idx = key.indexOf( ':' );
			const rest = key.slice( idx + 1 );
			if ( facet === 'year' ) {
				const y = Number( rest );
				if ( ! Number.isFinite( y ) || y <= 0 ) {
					continue;
				}
				// Zero-pad so string-sort is identical to numeric-sort
				// without parsing twice.
				ordered.push( { key, sort: String( y ).padStart( 6, '0' ) } );
			} else {
				// year-month tokens are already in YYYY-MM, which
				// string-sorts chronologically.
				if ( rest === 'unknown' || rest === '' ) {
					continue;
				}
				ordered.push( { key, sort: rest } );
			}
		}
		ordered.sort( ( a, b ) => {
			if ( a.sort < b.sort ) {
				return -1;
			}
			if ( a.sort > b.sort ) {
				return 1;
			}
			return 0;
		} );
		return ordered.map( ( e ) => e.key );
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

	/**
	 * Currently focused node id, or `null` when nothing is focused.
	 * Used by the host orchestrator to implement click-to-deselect:
	 * if the user clicks the already-focused node, the host calls
	 * `clearFocus()` instead of re-focusing.
	 */
	getFocusedId(): number | null {
		return this.focusedId;
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
		// Park the Pixi app's ticker FIRST. The ticker auto-runs an
		// internal render every frame regardless of our own
		// `tickerCb`; if we destroy graphics objects (via satellites /
		// app cascade) while the ticker is still scheduled to fire,
		// the next auto-render hits half-destroyed state and crashes
		// in the batched renderer. Stopping the ticker quiets the
		// auto-render before we touch any child.
		try {
			this.app?.ticker?.stop();
		} catch {
			// Ignore — destroy is best-effort.
		}
		if ( this.tickerCb ) {
			try {
				this.app?.ticker?.remove( this.tickerCb );
			} catch {
				// Ignore.
			}
			this.tickerCb = null;
		}
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		this.satellites?.destroy();
		this.satellites = null;
		// DOM overlay for cluster labels lives outside the Pixi
		// cascade — remove it explicitly.
		this.clearGroupViews();
		this.groupLabelOverlay?.remove();
		this.groupLabelOverlay = null;
		// Group views, edge views, node views, etc. are destroyed by
		// the `app.destroy({children: true})` cascade below. Doing it
		// here explicitly was redundant and could double-destroy.
		try {
			// `{ removeView: true }`, NEVER `true`: a literal `true` runs
			// `releaseGlobalResources()`, wiping Pixi's page-global pools
			// out from under every other live Application on the page
			// (canvas wallpaper, previews, the categories mindmap).
			this.app.destroy( { removeView: true }, { children: true } );
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

/**
 * Render a `'YYYY-MM'` token as a user-facing month label
 * (e.g. `'2024-03'` → `'Mar 2024'`) using the browser's locale.
 * Falls back to the raw token if parsing fails.
 */
function formatYearMonth( token: string ): string {
	const m = /^(\d{4})-(\d{2})$/.exec( token );
	if ( ! m ) {
		return token;
	}
	const monthIdx = Number( m[ 2 ] ) - 1;
	if ( monthIdx < 0 || monthIdx > 11 ) {
		return token;
	}
	const year = Number( m[ 1 ] );
	try {
		const d = new Date( Date.UTC( year, monthIdx, 1 ) );
		return new Intl.DateTimeFormat( undefined, {
			month: 'short',
			year: 'numeric',
			timeZone: 'UTC',
		} ).format( d );
	} catch {
		return token;
	}
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
