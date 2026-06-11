/**
 * Content Graph — Galaxy Pixi scene.
 *
 * Alternate render path for the Content Graph window. Instead of icons +
 * spokes + labelled satellites, every post is a tiny glowing dot, every
 * group is a coloured nebula glow behind its members, and recently-
 * edited posts (plus the pinned/focused post) sparkle with a slow
 * twinkle pulse. The same `ForceSim` from `sim.ts` drives clustering,
 * so the layout primitives — `groupAssignment`, `groupOrder`,
 * `setGroupAssignment()` — carry over from `GraphScene` verbatim.
 *
 * Visual encoding (mirroring the reference image the design was
 * adapted from):
 *
 *   - **Color**     = active group facet (per-facet palettes, hashed
 *                     hue for authors/terms, chronological ramp for
 *                     year / year-month).
 *   - **Brightness** = `comment_count` + `word_count`, log-normalised
 *                     so a 50k-word post doesn't drown out a 200-word
 *                     post. See `dotBrightness()` for the curve.
 *   - **Twinkle**   = (a) posts modified in the last 30 days, and
 *                     (b) the pinned/focused post and its direct
 *                     edge neighbours.
 *
 * Why a separate file vs. extending `scene.ts`: the two scenes share
 * almost nothing at the render layer (sprites vs. graphics + DOM
 * labels, additive blending vs. dashicon text). Keeping them apart
 * means each can evolve without the other dragging it through
 * "is the mode active" branching everywhere.
 *
 * @public
 * @since 0.9.2
 */

import { __ } from '../i18n';
import {
	getPixi,
	type DesktopApiLike,
	type PixiApp,
	type PixiContainer,
	type PixiNamespace,
	type PixiSprite,
	type PixiTexture,
} from './pixi-types';
import { DEFAULT_SIM_OPTIONS, ForceSim } from './sim';
import type {
	GalaxyTab,
	GraphEdge,
	GraphGroupCatalogs,
	GraphNode,
	GraphPayload,
	GroupFacet,
	PostDetail,
} from './types';
import { galaxyTabFilter, dotBrightness } from './galaxy-encodings';

const BG_COLOR = 0x0b0d18;
// Wide zoom-out floor: with grouping active the cluster lattice can
// span thousands of world units, and fit-to-view must be allowed to
// frame all of it. 0.5 (the old floor) silently clamped the fit and
// left most clusters outside the camera.
const ZOOM_MIN = 0.08;
const ZOOM_MAX = 4;
// How many ticker frames fit-to-view keeps following the simulation
// after a data load or grouping change. Generous (~15s at 60fps)
// because the layout keeps expanding until the sim's alpha decays
// below its settle threshold (~10s) — following must outlast that.
// In practice the follow exits early via `sim.isSettled`; any user
// wheel / drag also cancels immediately so we never fight manual
// navigation.
const FIT_FOLLOW_FRAMES = 900;
// Cluster labels + nebulae fade in after a grouping change instead of
// appearing instantly: at t=0 every cluster's centroid is the same
// point (the still-entangled ball), so instant labels render as a
// stack of 26 names floating over one blob. By REVEAL_DELAY frames the
// clusters have visibly separated; the ramp then eases them in.
const GROUP_REVEAL_DELAY_FRAMES = 150;
const GROUP_REVEAL_RAMP_FRAMES = 90;
const ZOOM_SENSITIVITY = 0.0008;
const CAMERA_EASE = 0.18;
const CAMERA_EPSILON = 0.001;
// 30 days in unix seconds — the "Recent" tab and the twinkle layer
// share this window.
const RECENT_WINDOW_SECONDS = 30 * 24 * 3600;
const NEBULA_BASE_RADIUS = 240;

/**
 * Per-facet base colour (used as a tint seed for the dot palette). When
 * the active facet has its own per-group hue (every facet does — see
 * `colorForGroupKey()`), this constant is the fallback for the "no
 * grouping" case and for nodes the scene couldn't assign to a group.
 */
const UNGROUPED_TINT = 0x8aa8ff;

export interface GalaxySceneCallbacks {
	onNodeClick?: ( node: GraphNode ) => void;
	onBackgroundClick?: () => void;
	onVisibleCountChange?: ( visible: number, total: number ) => void;
}

interface DotView {
	node: GraphNode;
	sprite: PixiSprite;
	twinkle: PixiSprite | null;
	twinklePhase: number;
}

interface NebulaView {
	key: string;
	sprite: PixiSprite;
	memberIds: number[];
}

interface LabelView {
	key: string;
	name: string;
	el: HTMLDivElement;
	memberIds: number[];
}

export class GalaxyScene {
	private app!: PixiApp;
	private pixi!: PixiNamespace;
	private world!: PixiContainer;
	private nebulaLayer!: PixiContainer;
	private dotLayer!: PixiContainer;
	private twinkleLayer!: PixiContainer;
	private brushTexture!: PixiTexture;
	private nebulaTexture!: PixiTexture;
	private sparkleTexture!: PixiTexture;
	private labelOverlay: HTMLDivElement | null = null;
	private tooltipEl: HTMLDivElement | null = null;
	private legendEl: HTMLDivElement | null = null;
	private dotViews = new Map< number, DotView >();
	private nebulae = new Map< string, NebulaView >();
	private labels = new Map< string, LabelView >();
	private nodes: GraphNode[] = [];
	private edgeNeighbours = new Map< number, Set< number > >();
	private nowSeconds = 0;
	private sim: ForceSim | null = null;
	private grouping: GroupFacet | null = null;
	private catalogs: GraphGroupCatalogs = {
		authors: {},
		categories: {},
		tags: {},
	};
	private activeTab: GalaxyTab = 'all';
	private minComments = 0;
	private host: HTMLElement;
	private callbacks: GalaxySceneCallbacks;
	private tick = ( ticker: { deltaTime: number } ) => {
		this.advance( ticker.deltaTime );
	};
	private resizeObserver: ResizeObserver | null = null;
	private cameraTarget = { x: 0, y: 0, scale: 1 };
	private dragState: {
		pointerId: number;
		startX: number;
		startY: number;
		camStartX: number;
		camStartY: number;
	} | null = null;
	private focusedId: number | null = null;
	private animTime = 0;
	/**
	 * True between a dot sprite's Pixi `pointerdown` and the canvas's
	 * DOM `pointerup`. Pixi dispatches sprite events from its own
	 * (earlier-registered) canvas listener, so the flag is already set
	 * when our DOM pointerdown runs — it suppresses both pan-start and
	 * the background-click-on-release so a dot tap doesn't immediately
	 * close the focus it just opened. Mirrors `GraphScene.nodeClickActive`.
	 */
	private nodeClickActive = false;
	/**
	 * Remaining ticker frames during which `advance()` re-runs
	 * fit-to-view every frame, so the camera follows the clusters as
	 * the simulation spreads them out after a load or grouping change.
	 * Any user wheel / pointer-down zeroes it immediately.
	 */
	private fitFollowFrames = 0;
	private lastResizeWidth = 0;
	private lastResizeHeight = 0;
	/**
	 * `animTime` stamp of the last grouping (re)build — drives the
	 * fade-in of cluster labels + nebulae (see GROUP_REVEAL_*).
	 */
	private groupVisualsBuiltAt = 0;

	constructor( host: HTMLElement, callbacks: GalaxySceneCallbacks ) {
		this.host = host;
		this.callbacks = callbacks;
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

		const app = new pixi.Application();
		await app.init( {
			background: BG_COLOR,
			antialias: true,
			autoDensity: true,
			resolution: window.devicePixelRatio || 1,
			resizeTo: this.host,
			// Galaxy windows are independent of any other Pixi app in
			// the desktop. A shared ticker would entangle their
			// lifecycles and surface the v8 multi-Application destroy
			// race documented in the categories-mindmap module.
			sharedTicker: false,
		} );
		this.app = app;
		this.host.classList.add( 'is-galaxy' );
		this.host.appendChild( app.canvas );

		// Loose-canvas guard: if WebGL context drops (browser eviction
		// under multi-app pressure), stop ticking so the next frame
		// doesn't try to render through a dead context.
		app.canvas.addEventListener( 'webglcontextlost', ( ev: Event ) => {
			ev.preventDefault();
			app.ticker.stop();
		} );

		this.world = new pixi.Container();
		app.stage.addChild( this.world );

		this.nebulaLayer = new pixi.Container();
		this.dotLayer = new pixi.Container();
		this.twinkleLayer = new pixi.Container();
		this.world.addChild( this.nebulaLayer );
		this.world.addChild( this.dotLayer );
		this.world.addChild( this.twinkleLayer );

		this.brushTexture = buildBrushTexture( pixi, 128 );
		this.nebulaTexture = buildNebulaTexture( pixi, 256 );
		this.sparkleTexture = buildSparkleTexture( pixi, 96 );

		this.attachOverlays();
		this.attachPointerHandlers();
		this.attachResizeObserver();

		app.ticker.add( this.tick );
	}

	setData( payload: GraphPayload ): void {
		this.tearDownNodes();
		this.catalogs = payload.groups;
		// Stamp "now" at data-set time so the Recent filter + the
		// twinkle layer agree on the same clock for this load.
		this.nowSeconds = Math.floor( Date.now() / 1000 );

		// Build live in-memory nodes. We borrow the same shape
		// (`GraphNode`) the existing GraphScene uses so the
		// `ForceSim` accepts us without changes.
		const ringR = 480;
		const nodes: GraphNode[] = payload.nodes.map( ( n, idx ) => {
			const a = ( idx / Math.max( 1, payload.nodes.length ) ) * Math.PI * 2;
			return {
				...n,
				x: Math.cos( a ) * ringR,
				y: Math.sin( a ) * ringR,
				vx: 0,
				vy: 0,
				pinned: false,
				radius: 4,
				color: UNGROUPED_TINT,
				degree: 0,
			};
		} );
		const nodeById = new Map< number, GraphNode >();
		for ( const n of nodes ) {
			nodeById.set( n.id, n );
		}
		const edges: GraphEdge[] = [];
		this.edgeNeighbours.clear();
		for ( const e of payload.edges ) {
			const from = nodeById.get( e.from );
			const to = nodeById.get( e.to );
			if ( ! from || ! to ) {
				continue;
			}
			edges.push( { from, to } );
			from.degree++;
			to.degree++;
			if ( ! this.edgeNeighbours.has( e.from ) ) {
				this.edgeNeighbours.set( e.from, new Set() );
			}
			if ( ! this.edgeNeighbours.has( e.to ) ) {
				this.edgeNeighbours.set( e.to, new Set() );
			}
			this.edgeNeighbours.get( e.from )!.add( e.to );
			this.edgeNeighbours.get( e.to )!.add( e.from );
		}
		this.nodes = nodes;

		this.sim = new ForceSim( nodes, edges );

		// Build the dot sprites.
		for ( const node of nodes ) {
			const sprite = new this.pixi.Sprite( this.brushTexture );
			sprite.anchor.set( 0.5 );
			sprite.blendMode = 'add';
			sprite.tint = UNGROUPED_TINT;
			sprite.eventMode = 'static';
			sprite.cursor = 'pointer';
			sprite.on( 'pointerover', () => {
				this.showTooltip( node );
			} );
			sprite.on( 'pointerout', () => {
				this.hideTooltip();
			} );
			sprite.on( 'pointerdown', ( ev: unknown ) => {
				( ev as { stopPropagation?: () => void } ).stopPropagation?.();
				this.nodeClickActive = true;
			} );
			sprite.on( 'pointertap', ( ev: unknown ) => {
				( ev as { stopPropagation?: () => void } ).stopPropagation?.();
				this.callbacks.onNodeClick?.( node );
			} );
			this.dotLayer.addChild( sprite );
			this.dotViews.set( node.id, {
				node,
				sprite,
				twinkle: null,
				twinklePhase: Math.random() * Math.PI * 2,
			} );
		}

		this.refreshEncodings();
		this.refreshTwinkles();
		this.refreshVisibility();
		this.fitToView();
		// Follow the layout while the fresh simulation spreads out, so
		// the initial constellation stays framed instead of escaping
		// the viewport mid-settle.
		this.fitFollowFrames = FIT_FOLLOW_FRAMES;
	}

	setGrouping( facet: GroupFacet | null ): void {
		this.grouping = facet;
		if ( ! this.sim ) {
			return;
		}
		const assignment = facet ? this.buildAssignmentMap( facet ) : null;
		const order = facet ? this.buildGroupOrder( facet ) : null;
		this.sim.setGroupAssignment( assignment, order );
		// Stronger pull than the GraphScene default: galaxy clusters are
		// single-membership (see buildAssignmentMap) so there's no
		// balancing force to preserve, and the tighter gather reads
		// better against the nebula glow.
		this.sim.groupAttractorStrength = 0.18;
		// Hyperlink springs all but disable cluster separation on a
		// well-linked corpus: a single cross-cluster link at lattice
		// distance pulls with (d - springLen) * k, which dwarfs the
		// attractor. While grouping is active the springs drop to a
		// whisper — enough to keep linked posts on facing cluster
		// edges, too weak to drag whole clusters together.
		this.sim.opts = {
			...DEFAULT_SIM_OPTIONS,
			springK: facet ? 0.002 : DEFAULT_SIM_OPTIONS.springK,
		};
		this.sim.groupOrderSpacing = facet === 'year_month' ? 200 : 320;
		this.sim.groupOrderStaggerY = facet === 'year_month' ? 160 : 0;
		this.rebuildNebulae();
		this.rebuildLabels();
		this.refreshEncodings();
		// Clusters spread far beyond the current viewport as the
		// attractor separates them — keep the camera following until
		// the layout settles (or the user takes over with wheel/drag).
		this.fitFollowFrames = FIT_FOLLOW_FRAMES;
		// Restart the label/nebula fade-in (they ride the separation).
		this.groupVisualsBuiltAt = this.animTime;
	}

	setTab( tab: GalaxyTab ): void {
		this.activeTab = tab;
		this.refreshVisibility();
	}

	setMinComments( min: number ): void {
		this.minComments = Math.max( 0, Math.floor( min ) );
		this.refreshVisibility();
	}

	setZoom( zoom: number ): void {
		const clamped = Math.max( ZOOM_MIN, Math.min( ZOOM_MAX, zoom ) );
		this.cameraTarget.scale = clamped;
	}

	setFocus( id: number | null ): void {
		this.focusedId = id;
		this.refreshTwinkles();
	}

	setFocusedDetail( _detail: PostDetail | null ): void {
		// Galaxy view doesn't render satellites — focus state alone is
		// enough to drive the twinkle layer. Kept for parity with
		// `GraphScene` so `index.ts` can call it uniformly.
	}

	getNodes(): GraphNode[] {
		return this.nodes;
	}

	getFocusedId(): number | null {
		return this.focusedId;
	}

	clearFocus(): void {
		this.setFocus( null );
	}

	focusNode( id: number ): void {
		this.setFocus( id );
	}

	/**
	 * No-op for the satellite registry (Galaxy has no satellites). Kept
	 * to match `GraphScene`'s API so the host can call it generically.
	 */
	setSatelliteSelectedKey( _key: unknown ): void {
		// Intentional no-op.
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
		const padding = 120;
		const spanX = maxX - minX + padding * 2;
		const spanY = maxY - minY + padding * 2;
		const w = this.app.canvas.width / this.app.renderer.resolution;
		const h = this.app.canvas.height / this.app.renderer.resolution;
		const sx = w / spanX;
		const sy = h / spanY;
		const scale = Math.max(
			ZOOM_MIN,
			Math.min( ZOOM_MAX, Math.min( sx, sy ) ),
		);
		const cx = ( minX + maxX ) / 2;
		const cy = ( minY + maxY ) / 2;
		this.cameraTarget.scale = scale;
		this.cameraTarget.x = w / 2 - cx * scale;
		this.cameraTarget.y = h / 2 - cy * scale;
	}

	destroy(): void {
		this.app?.ticker.remove( this.tick );
		this.app?.ticker.stop();
		this.tearDownNodes();
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		this.labelOverlay?.remove();
		this.labelOverlay = null;
		this.tooltipEl?.remove();
		this.tooltipEl = null;
		this.legendEl?.remove();
		this.legendEl = null;
		try {
			this.brushTexture?.destroy( true );
			this.nebulaTexture?.destroy( true );
			this.sparkleTexture?.destroy( true );
		} catch {
			// Texture might already be gone if the WebGL context was lost.
		}
		// IMPORTANT: do NOT call `this.app.destroy()`. The Pixi v8
		// batched renderer can hit a "Cannot read properties of null
		// (reading 'clear')" race when an unrelated Pixi app destroys
		// concurrently (e.g. a tags-cloud window the user just closed).
		// Stopping the ticker + detaching the canvas frees the heavy
		// state; GC reclaims the rest at a safe time.
		try {
			this.app?.canvas.remove();
		} catch {
			// Canvas already detached — fine.
		}
		this.host.classList.remove( 'is-galaxy' );
	}

	// ─────────────────────────────────────────────────────────────────
	// Internals
	// ─────────────────────────────────────────────────────────────────

	private attachOverlays(): void {
		const labelOverlay = document.createElement( 'div' );
		labelOverlay.className = 'desktop-mode-content-graph__galaxy-labels';
		this.host.appendChild( labelOverlay );
		this.labelOverlay = labelOverlay;

		const tooltip = document.createElement( 'div' );
		tooltip.className = 'desktop-mode-content-graph__galaxy-tooltip';
		tooltip.hidden = true;
		this.host.appendChild( tooltip );
		this.tooltipEl = tooltip;

		const legend = document.createElement( 'div' );
		legend.className = 'desktop-mode-content-graph__galaxy-legend';
		legend.innerHTML =
			`<span><strong>${ escapeHtml( __( 'Color' ) ) }</strong> ${ escapeHtml( __( 'group' ) ) }</span>` +
			`<span><strong>${ escapeHtml( __( 'Brightness' ) ) }</strong> ${ escapeHtml( __( 'comments + length' ) ) }</span>` +
			`<span><strong>${ escapeHtml( __( 'Twinkle' ) ) }</strong> ${ escapeHtml( __( 'recent or focused' ) ) }</span>` +
			'<span class="desktop-mode-content-graph__galaxy-legend-spacer"></span>' +
			`<span>${ escapeHtml( __( 'Scroll to zoom' ) ) }</span>` +
			`<span>${ escapeHtml( __( 'Drag to pan' ) ) }</span>`;
		this.host.appendChild( legend );
		this.legendEl = legend;
	}

	private attachPointerHandlers(): void {
		const canvas = this.app.canvas;
		canvas.addEventListener( 'wheel', ( ev: WheelEvent ) => {
			ev.preventDefault();
			// Manual navigation takes priority over auto-fit-follow.
			this.fitFollowFrames = 0;
			const factor = Math.exp( -ev.deltaY * ZOOM_SENSITIVITY );
			const nextScale = Math.max(
				ZOOM_MIN,
				Math.min( ZOOM_MAX, this.cameraTarget.scale * factor ),
			);
			const rect = canvas.getBoundingClientRect();
			const px = ev.clientX - rect.left;
			const py = ev.clientY - rect.top;
			// Anchor zoom to the cursor position so users can drill into
			// a specific cluster without losing their place.
			const ratio = nextScale / this.cameraTarget.scale;
			this.cameraTarget.x = px - ( px - this.cameraTarget.x ) * ratio;
			this.cameraTarget.y = py - ( py - this.cameraTarget.y ) * ratio;
			this.cameraTarget.scale = nextScale;
		}, { passive: false } );

		canvas.addEventListener( 'pointerdown', ( ev: PointerEvent ) => {
			if ( ev.target !== canvas ) {
				return;
			}
			// Pixi already routed this press to a dot sprite — don't
			// start a camera pan underneath the in-flight node click.
			if ( this.nodeClickActive ) {
				return;
			}
			this.fitFollowFrames = 0;
			try {
				canvas.setPointerCapture( ev.pointerId );
			} catch {
				// Pointer already gone (pen lift, synthetic event) —
				// the drag still works, move/up arrive via bubbling.
			}
			this.dragState = {
				pointerId: ev.pointerId,
				startX: ev.clientX,
				startY: ev.clientY,
				camStartX: this.cameraTarget.x,
				camStartY: this.cameraTarget.y,
			};
		} );
		canvas.addEventListener( 'pointermove', ( ev: PointerEvent ) => {
			if ( ! this.dragState || ev.pointerId !== this.dragState.pointerId ) {
				return;
			}
			this.cameraTarget.x =
				this.dragState.camStartX + ( ev.clientX - this.dragState.startX );
			this.cameraTarget.y =
				this.dragState.camStartY + ( ev.clientY - this.dragState.startY );
		} );
		const endDrag = ( ev: PointerEvent ): void => {
			const nodeWasTarget = this.nodeClickActive;
			this.nodeClickActive = false;
			if ( this.dragState && ev.pointerId === this.dragState.pointerId ) {
				try {
					canvas.releasePointerCapture( ev.pointerId );
				} catch {
					// Capture already released — fine.
				}
				const moved =
					Math.abs( ev.clientX - this.dragState.startX ) +
						Math.abs( ev.clientY - this.dragState.startY ) >
					4;
				this.dragState = null;
				if ( ! moved && ! nodeWasTarget ) {
					this.callbacks.onBackgroundClick?.();
				}
			}
		};
		canvas.addEventListener( 'pointerup', endDrag );
		canvas.addEventListener( 'pointercancel', endDrag );
	}

	private attachResizeObserver(): void {
		if ( typeof ResizeObserver === 'undefined' ) {
			return;
		}
		this.lastResizeWidth = this.host.clientWidth;
		this.lastResizeHeight = this.host.clientHeight;
		this.resizeObserver = new ResizeObserver( () => {
			const w = this.host.clientWidth;
			const h = this.host.clientHeight;
			// Hidden / detached host reports 0×0 — resizing the renderer
			// to zero puts Pixi v8's batched renderer into a state that
			// crashes the next render (see GraphScene.bindResize for the
			// full history). Skip and catch up on the next observation.
			if ( w <= 0 || h <= 0 ) {
				return;
			}
			// Pixi's `resizeTo` only reacts to BROWSER window resizes; a
			// desktop-mode window maximize/restore/drag-resize changes the
			// host element without firing one, so resize explicitly.
			try {
				this.app.renderer.resize( w, h );
			} catch {
				return;
			}
			try {
				this.app.render();
			} catch {
				// Teardown race — fine.
			}
			const dw = Math.abs( w - this.lastResizeWidth );
			const dh = Math.abs( h - this.lastResizeHeight );
			if ( dw >= 24 || dh >= 24 ) {
				this.lastResizeWidth = w;
				this.lastResizeHeight = h;
				this.fitToView();
			}
		} );
		this.resizeObserver.observe( this.host );
	}

	private tearDownNodes(): void {
		for ( const view of this.dotViews.values() ) {
			view.sprite.destroy( { children: true } );
			view.twinkle?.destroy( { children: true } );
		}
		this.dotViews.clear();
		for ( const neb of this.nebulae.values() ) {
			neb.sprite.destroy( { children: true } );
		}
		this.nebulae.clear();
		for ( const lab of this.labels.values() ) {
			lab.el.remove();
		}
		this.labels.clear();
	}

	private buildAssignmentMap(
		facet: GroupFacet,
	): Map< number, string[] > | null {
		const map = new Map< number, string[] >();
		for ( const node of this.nodes ) {
			map.set( node.id, galaxyKeysFor( node, facet ) );
		}
		return map;
	}

	private buildGroupOrder( facet: GroupFacet ): string[] | null {
		if ( facet !== 'year' && facet !== 'year_month' ) {
			return null;
		}
		const seen = new Set< string >();
		const order: string[] = [];
		for ( const node of this.nodes ) {
			for ( const key of deriveGroupKeys( node, facet ) ) {
				if ( ! seen.has( key ) ) {
					seen.add( key );
					order.push( key );
				}
			}
		}
		// Year keys sort naturally; year-month does too because both are
		// zero-padded numeric prefixes.
		order.sort();
		return order;
	}

	/**
	 * Cluster-key → member-node-ids using the SAME single-membership
	 * commit as the force assignment and the colour encoding. Labels
	 * and nebulae must agree with the layout: if a label counted every
	 * taxonomy membership while the dots only sit in their first
	 * cluster, the label centroid would be polluted by members that
	 * physically live in other clusters and drift toward the global
	 * centre (which is exactly the bug this replaced).
	 */
	private collectGalaxyMembers(): Map< string, number[] > {
		const byKey = new Map< string, number[] >();
		if ( ! this.grouping ) {
			return byKey;
		}
		for ( const node of this.nodes ) {
			for ( const k of galaxyKeysFor( node, this.grouping ) ) {
				const list = byKey.get( k );
				if ( list ) {
					list.push( node.id );
				} else {
					byKey.set( k, [ node.id ] );
				}
			}
		}
		return byKey;
	}

	private rebuildNebulae(): void {
		for ( const neb of this.nebulae.values() ) {
			neb.sprite.destroy( { children: true } );
		}
		this.nebulae.clear();
		if ( ! this.grouping ) {
			return;
		}
		const byKey = this.collectGalaxyMembers();
		for ( const [ key, memberIds ] of byKey ) {
			// Dedicated soft texture, NOT the dot brush: the brush has an
			// opaque white core, and 20+ additive nebulae stacked during
			// sim convergence (when every cluster still overlaps near the
			// origin) blew out to a solid white wall. The nebula texture
			// peaks well below full alpha so even heavy overlap stays a
			// glow, not a flashbang.
			const sprite = new this.pixi.Sprite( this.nebulaTexture );
			sprite.anchor.set( 0.5 );
			sprite.blendMode = 'add';
			sprite.tint = colorForGroupKey( key );
			// Starts invisible — `advance()` fades it in once the
			// clusters have separated (see GROUP_REVEAL_*).
			sprite.alpha = 0;
			sprite.visible = false;
			sprite.eventMode = 'none';
			this.nebulaLayer.addChild( sprite );
			this.nebulae.set( key, { key, sprite, memberIds } );
		}
	}

	private rebuildLabels(): void {
		if ( ! this.labelOverlay ) {
			return;
		}
		for ( const lab of this.labels.values() ) {
			lab.el.remove();
		}
		this.labels.clear();
		if ( ! this.grouping ) {
			return;
		}
		const byKey = this.collectGalaxyMembers();
		for ( const [ key, memberIds ] of byKey ) {
			const el = document.createElement( 'div' );
			el.className = 'desktop-mode-content-graph__galaxy-label';
			const name = labelForGroupKey( key, this.catalogs );
			el.dataset.key = key;
			this.labelOverlay.appendChild( el );
			this.labels.set( key, { key, name, el, memberIds } );
		}
		this.refreshLabelText();
	}

	private refreshLabelText(): void {
		for ( const lab of this.labels.values() ) {
			const visible = lab.memberIds.filter( ( id ) => {
				const dot = this.dotViews.get( id );
				return dot && dot.sprite.visible;
			} ).length;
			// The newline between the spans keeps screen-reader output
			// ("News 142 posts") from running the name into the count;
			// visually the flex-column stacking ignores it.
			lab.el.innerHTML =
				`<span class="desktop-mode-content-graph__galaxy-label-name">${ escapeHtml( lab.name ) }</span>\n` +
				`<span class="desktop-mode-content-graph__galaxy-label-count">${ visible } ${ escapeHtml( visible === 1 ? __( 'post' ) : __( 'posts' ) ) }</span>`;
		}
	}

	private refreshEncodings(): void {
		// Color: tint each dot to its group key (when a group is active),
		// or fall back to the unmagrouped tint. Multi-membership posts
		// (e.g. two-category post) take the first key — a cheap, stable
		// pick that keeps the dot visually anchored to ONE cluster even
		// as the simulation balances it between centroids.
		for ( const view of this.dotViews.values() ) {
			const node = view.node;
			let tint = UNGROUPED_TINT;
			if ( this.grouping ) {
				const keys = deriveGroupKeys( node, this.grouping );
				if ( keys.length > 0 ) {
					tint = colorForGroupKey( keys[ 0 ] );
				}
			}
			view.sprite.tint = tint;
			const b = dotBrightness( node.comment_count, node.word_count );
			view.sprite.alpha = 0.45 + 0.55 * b;
			// Scale: tiny so the field reads as a starfield rather than
			// a cluster of bubbles. Brightness contributes a small size
			// nudge so "louder" posts feel meatier.
			const s = 0.18 + 0.18 * b;
			view.sprite.scale.set( s );
		}
	}

	private refreshTwinkles(): void {
		const recentCutoff = this.nowSeconds - RECENT_WINDOW_SECONDS;
		const focusId = this.focusedId;
		const neighbours = focusId
			? this.edgeNeighbours.get( focusId ) ?? new Set< number >()
			: new Set< number >();
		for ( const view of this.dotViews.values() ) {
			const node = view.node;
			const isRecent = node.modified_ts >= recentCutoff;
			const isFocusKin =
				focusId !== null &&
				( node.id === focusId || neighbours.has( node.id ) );
			const shouldTwinkle = isRecent || isFocusKin;
			if ( shouldTwinkle && ! view.twinkle ) {
				const sparkle = new this.pixi.Sprite( this.sparkleTexture );
				sparkle.anchor.set( 0.5 );
				sparkle.blendMode = 'add';
				sparkle.tint = isFocusKin ? 0xffffff : view.sprite.tint;
				sparkle.eventMode = 'none';
				this.twinkleLayer.addChild( sparkle );
				view.twinkle = sparkle;
			} else if ( ! shouldTwinkle && view.twinkle ) {
				view.twinkle.destroy( { children: true } );
				view.twinkle = null;
			}
		}
	}

	private refreshVisibility(): void {
		let visible = 0;
		for ( const view of this.dotViews.values() ) {
			const show = galaxyTabFilter(
				view.node,
				this.activeTab,
				this.minComments,
				this.nowSeconds,
				RECENT_WINDOW_SECONDS,
			);
			view.sprite.visible = show;
			if ( view.twinkle ) {
				view.twinkle.visible = show;
			}
			if ( show ) {
				visible++;
			}
		}
		this.refreshLabelText();
		this.callbacks.onVisibleCountChange?.( visible, this.nodes.length );
	}

	private showTooltip( node: GraphNode ): void {
		if ( ! this.tooltipEl ) {
			return;
		}
		this.tooltipEl.textContent = node.title || '#' + node.id;
		this.tooltipEl.hidden = false;
		const view = this.dotViews.get( node.id );
		if ( ! view ) {
			return;
		}
		const screenX = node.x * this.world.scale.x + this.world.x;
		const screenY = node.y * this.world.scale.y + this.world.y;
		this.tooltipEl.style.transform = `translate(${ screenX }px, ${ screenY - 18 }px) translate(-50%, -100%)`;
	}

	private hideTooltip(): void {
		if ( this.tooltipEl ) {
			this.tooltipEl.hidden = true;
		}
	}

	private advance( deltaTime: number ): void {
		this.animTime += deltaTime;
		if ( this.sim ) {
			this.sim.step( deltaTime );
		}

		// Auto-fit-follow: keep re-framing while the simulation spreads
		// the layout (post-load and post-grouping). Stops on its own
		// after FIT_FOLLOW_FRAMES, when the sim settles, or the moment
		// the user navigates manually (wheel / drag zero the counter).
		if ( this.fitFollowFrames > 0 ) {
			this.fitFollowFrames -= deltaTime;
			this.fitToView();
			if ( this.sim?.isSettled ) {
				this.fitFollowFrames = 0;
			}
		}

		// Camera ease.
		const w = this.world;
		const easeX = ( this.cameraTarget.x - w.x ) * CAMERA_EASE;
		const easeY = ( this.cameraTarget.y - w.y ) * CAMERA_EASE;
		const easeS = ( this.cameraTarget.scale - w.scale.x ) * CAMERA_EASE;
		if ( Math.abs( easeX ) > CAMERA_EPSILON ) {
			w.x += easeX;
		}
		if ( Math.abs( easeY ) > CAMERA_EPSILON ) {
			w.y += easeY;
		}
		if ( Math.abs( easeS ) > CAMERA_EPSILON ) {
			w.scale.set( w.scale.x + easeS );
		}

		// Position dots.
		for ( const view of this.dotViews.values() ) {
			view.sprite.x = view.node.x;
			view.sprite.y = view.node.y;
			if ( view.twinkle ) {
				view.twinkle.x = view.node.x;
				view.twinkle.y = view.node.y;
				// Slow sin pulse with per-node phase so the whole layer
				// doesn't blink in unison.
				const pulse =
					0.45 +
					0.55 * Math.abs( Math.sin( this.animTime * 0.035 + view.twinklePhase ) );
				view.twinkle.alpha = pulse;
				const ts = 0.5 + 0.4 * pulse;
				view.twinkle.scale.set( ts );
			}
		}

		// Position nebulae + DOM labels at cluster centroids.
		if ( this.grouping ) {
			// Reveal ramp: 0 → 1 over GROUP_REVEAL_RAMP_FRAMES after a
			// delay. At grouping time every cluster centroid is still the
			// same point (the entangled ball), so instantly-visible
			// labels render as a stack of names floating over one blob.
			// By the end of the delay the clusters have visibly
			// separated; the ramp eases labels + nebulae in over their
			// own clusters.
			const sinceBuild = this.animTime - this.groupVisualsBuiltAt;
			const reveal = Math.max(
				0,
				Math.min(
					1,
					( sinceBuild - GROUP_REVEAL_DELAY_FRAMES ) /
						GROUP_REVEAL_RAMP_FRAMES,
				),
			);
			const camX = w.x;
			const camY = w.y;
			const camS = w.scale.x;
			for ( const neb of this.nebulae.values() ) {
				const c = this.centroidOf( neb.memberIds );
				if ( ! c || reveal <= 0 ) {
					neb.sprite.visible = false;
					continue;
				}
				neb.sprite.visible = true;
				neb.sprite.alpha = 0.2 * reveal;
				neb.sprite.x = c.x;
				neb.sprite.y = c.y;
				const r = Math.max(
					NEBULA_BASE_RADIUS * 0.4,
					Math.min( NEBULA_BASE_RADIUS * 2.5, c.radius + 80 ),
				);
				// Texture is 256px square, so world radius → scale is
				// r / (textureSize / 2).
				const k = r / 128;
				neb.sprite.scale.set( k );
			}
			for ( const lab of this.labels.values() ) {
				const c = this.centroidOf( lab.memberIds );
				if ( ! c || reveal <= 0 ) {
					lab.el.style.display = 'none';
					continue;
				}
				lab.el.style.display = '';
				lab.el.style.opacity = String( reveal );
				// The label sits at the cluster's centroid — the heart of
				// the nebula, like the reference design — NOT floated
				// above its top edge. The centroid tracks the cluster
				// smoothly as it separates; a radius-based offset whips
				// around while the percentile radius is still volatile.
				const sx = c.x * camS + camX;
				const sy = c.y * camS + camY;
				lab.el.style.transform = `translate(${ sx }px, ${ sy }px) translate(-50%, -50%)`;
			}
		}
	}

	private centroidOf(
		memberIds: number[],
	): { x: number; y: number; radius: number } | null {
		let count = 0;
		let sx = 0;
		let sy = 0;
		for ( const id of memberIds ) {
			const dot = this.dotViews.get( id );
			if ( ! dot || ! dot.sprite.visible ) {
				continue;
			}
			sx += dot.node.x;
			sy += dot.node.y;
			count++;
		}
		if ( count === 0 ) {
			return null;
		}
		const cx = sx / count;
		const cy = sy / count;
		// Robust radius: 80th-percentile member distance, not the max.
		// One stray member parked between clusters (cross-cluster
		// hyperlink springs do this) would otherwise balloon the radius
		// to half the layout — every nebula covers everything and every
		// label floats to the top edge of the canvas.
		const d2s: number[] = [];
		for ( const id of memberIds ) {
			const dot = this.dotViews.get( id );
			if ( ! dot || ! dot.sprite.visible ) {
				continue;
			}
			const dx = dot.node.x - cx;
			const dy = dot.node.y - cy;
			d2s.push( dx * dx + dy * dy );
		}
		d2s.sort( ( a, b ) => a - b );
		const idx = Math.min(
			d2s.length - 1,
			Math.floor( d2s.length * 0.8 ),
		);
		return { x: cx, y: cy, radius: Math.sqrt( d2s[ idx ] ?? 0 ) };
	}
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Group-key derivation matches the existing `GraphScene` so the two
 * scenes describe the same clusters. Mirrors the rules documented in
 * `scene.ts`'s `deriveGroupKeys()`.
 */
function deriveGroupKeys( node: GraphNode, facet: GroupFacet ): string[] {
	switch ( facet ) {
		case 'category':
			return Array.isArray( node.category_ids )
				? node.category_ids.map( ( id ) => `cat:${ id }` )
				: [];
		case 'tag':
			return Array.isArray( node.tag_ids )
				? node.tag_ids.map( ( id ) => `tag:${ id }` )
				: [];
		case 'author': {
			const primary = node.author_id > 0 ? `auth:${ node.author_id }` : null;
			const contribs = Array.isArray( node.contributor_ids )
				? node.contributor_ids.map( ( id ) => `auth:${ id }` )
				: [];
			if ( ! primary ) {
				return contribs;
			}
			// Double-weight the primary so the post lands closer to its
			// author's centroid, mirroring `GraphScene`'s behaviour.
			return [ primary, primary, ...contribs ];
		}
		case 'year':
			return node.year > 0 ? [ `year:${ node.year }` ] : [];
		case 'year_month':
			return node.year_month ? [ `ym:${ node.year_month }` ] : [];
	}
}

/**
 * Single-membership commit for the Galaxy view: each dot belongs to
 * its FIRST group key only. Multi-membership pulls (the GraphScene
 * behaviour) read nicely on small graphs, but on a realistic corpus
 * where most posts carry 2-3 categories the shared members chain
 * every cluster to every other and the layout collapses into one
 * entangled ball. The colour encoding, the force assignment, the
 * nebulae, and the labels all use this same commit so what you see
 * is internally consistent.
 */
function galaxyKeysFor( node: GraphNode, facet: GroupFacet ): string[] {
	const keys = deriveGroupKeys( node, facet );
	return keys.length > 0 ? [ keys[ 0 ] ] : [];
}

function labelForGroupKey(
	key: string,
	catalogs: GraphGroupCatalogs,
): string {
	const colon = key.indexOf( ':' );
	if ( colon < 0 ) {
		return key;
	}
	const prefix = key.slice( 0, colon );
	const rest = key.slice( colon + 1 );
	switch ( prefix ) {
		case 'cat':
			return catalogs.categories[ Number( rest ) ]?.name ?? rest;
		case 'tag':
			return catalogs.tags[ Number( rest ) ]?.name ?? rest;
		case 'auth':
			return catalogs.authors[ Number( rest ) ]?.name ?? rest;
		case 'year':
			return rest;
		case 'ym':
			return rest;
		default:
			return key;
	}
}

/**
 * Hash a group key to a hue then to an RGB int. Deterministic — same
 * key always paints the same colour across reloads. Tag/category/author
 * facets ride this hash. Year facets get a chronological ramp inside
 * the scene (see `colorForGroupKey()`).
 */
function colorForGroupKey( key: string ): number {
	// Chronological-ish facets — give them a smooth ramp instead of
	// hashed-random hues, so adjacent years/months sit near each other
	// on the colour wheel.
	if ( key.startsWith( 'year:' ) ) {
		const n = Number( key.slice( 5 ) ) || 2000;
		// 2010 → 0°, 2030 → 180° (warm winter → cool spring → warm summer).
		const hue = ( ( n - 2010 ) * 18 ) % 360;
		return hslToRgbInt( hue < 0 ? hue + 360 : hue, 0.7, 0.6 );
	}
	if ( key.startsWith( 'ym:' ) ) {
		const ym = key.slice( 3 );
		const [ y, m ] = ym.split( '-' ).map( ( s ) => Number( s ) || 0 );
		const months = y * 12 + ( m - 1 );
		const hue = ( months * 11 ) % 360;
		return hslToRgbInt( hue < 0 ? hue + 360 : hue, 0.7, 0.6 );
	}
	// Generic hash for the categorical facets — FNV-1a flavoured but
	// using `Math.imul` + modulo instead of `^` / `>>>` so the lint
	// rule banning bitwise ops doesn't trip. Same shape, same
	// determinism per key.
	let hash = 2166136261;
	for ( let i = 0; i < key.length; i++ ) {
		const diff = ( hash - key.charCodeAt( i ) + 4294967296 ) % 4294967296;
		hash = ( Math.imul( diff, 16777619 ) + 4294967296 ) % 4294967296;
	}
	const hue = hash % 360;
	const sat = 0.65 + ( Math.floor( hash / 256 ) % 25 ) / 100;
	const light = 0.55 + ( Math.floor( hash / 65536 ) % 20 ) / 100;
	return hslToRgbInt( hue, sat, light );
}

function hslToRgbInt( h: number, s: number, l: number ): number {
	const c = ( 1 - Math.abs( 2 * l - 1 ) ) * s;
	const hh = h / 60;
	const x = c * ( 1 - Math.abs( ( hh % 2 ) - 1 ) );
	let r = 0;
	let g = 0;
	let b = 0;
	if ( hh < 1 ) {
		r = c;
		g = x;
	} else if ( hh < 2 ) {
		r = x;
		g = c;
	} else if ( hh < 3 ) {
		g = c;
		b = x;
	} else if ( hh < 4 ) {
		g = x;
		b = c;
	} else if ( hh < 5 ) {
		r = x;
		b = c;
	} else {
		r = c;
		b = x;
	}
	const m = l - c / 2;
	const ri = Math.round( ( r + m ) * 255 );
	const gi = Math.round( ( g + m ) * 255 );
	const bi = Math.round( ( b + m ) * 255 );
	return ri * 65536 + gi * 256 + bi;
}

function buildBrushTexture( pixi: PixiNamespace, size: number ): PixiTexture {
	const canvas = document.createElement( 'canvas' );
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext( '2d' );
	if ( ! ctx ) {
		throw new Error( '[desktop-mode/content-graph] 2D canvas context unavailable.' );
	}
	const center = size / 2;
	const gradient = ctx.createRadialGradient(
		center,
		center,
		0,
		center,
		center,
		center,
	);
	gradient.addColorStop( 0, 'rgba(255, 255, 255, 1)' );
	gradient.addColorStop( 0.18, 'rgba(255, 255, 255, 0.85)' );
	gradient.addColorStop( 0.42, 'rgba(255, 255, 255, 0.28)' );
	gradient.addColorStop( 0.75, 'rgba(255, 255, 255, 0.06)' );
	gradient.addColorStop( 1, 'rgba(255, 255, 255, 0)' );
	ctx.fillStyle = gradient;
	ctx.fillRect( 0, 0, size, size );
	return pixi.Texture.from( canvas );
}

/**
 * Soft cluster-glow texture. Unlike the dot brush, the centre peaks at
 * a LOW alpha (0.35) so dozens of additively-blended nebulae can
 * overlap during simulation convergence without compounding into a
 * white wall. The wide falloff sells the "gas cloud" read.
 */
function buildNebulaTexture( pixi: PixiNamespace, size: number ): PixiTexture {
	const canvas = document.createElement( 'canvas' );
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext( '2d' );
	if ( ! ctx ) {
		throw new Error( '[desktop-mode/content-graph] 2D canvas context unavailable.' );
	}
	const center = size / 2;
	const gradient = ctx.createRadialGradient(
		center,
		center,
		0,
		center,
		center,
		center,
	);
	gradient.addColorStop( 0, 'rgba(255, 255, 255, 0.35)' );
	gradient.addColorStop( 0.35, 'rgba(255, 255, 255, 0.18)' );
	gradient.addColorStop( 0.7, 'rgba(255, 255, 255, 0.05)' );
	gradient.addColorStop( 1, 'rgba(255, 255, 255, 0)' );
	ctx.fillStyle = gradient;
	ctx.fillRect( 0, 0, size, size );
	return pixi.Texture.from( canvas );
}

function buildSparkleTexture(
	pixi: PixiNamespace,
	size: number,
): PixiTexture {
	const canvas = document.createElement( 'canvas' );
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext( '2d' );
	if ( ! ctx ) {
		throw new Error( '[desktop-mode/content-graph] 2D canvas context unavailable.' );
	}
	const center = size / 2;
	const radial = ctx.createRadialGradient(
		center,
		center,
		0,
		center,
		center,
		center * 0.5,
	);
	radial.addColorStop( 0, 'rgba(255, 255, 255, 1)' );
	radial.addColorStop( 0.4, 'rgba(255, 255, 255, 0.5)' );
	radial.addColorStop( 1, 'rgba(255, 255, 255, 0)' );
	ctx.fillStyle = radial;
	ctx.fillRect( 0, 0, size, size );
	ctx.globalCompositeOperation = 'lighter';
	const armWidth = 1.5;
	for ( const isVertical of [ false, true ] ) {
		const grad = isVertical
			? ctx.createLinearGradient( 0, 0, 0, size )
			: ctx.createLinearGradient( 0, 0, size, 0 );
		grad.addColorStop( 0, 'rgba(255, 255, 255, 0)' );
		grad.addColorStop( 0.5, 'rgba(255, 255, 255, 0.85)' );
		grad.addColorStop( 1, 'rgba(255, 255, 255, 0)' );
		ctx.fillStyle = grad;
		if ( isVertical ) {
			ctx.fillRect( center - armWidth, 0, armWidth * 2, size );
		} else {
			ctx.fillRect( 0, center - armWidth, size, armWidth * 2 );
		}
	}
	return pixi.Texture.from( canvas );
}

function escapeHtml( s: string ): string {
	return s
		.replace( /&/g, '&amp;' )
		.replace( /</g, '&lt;' )
		.replace( />/g, '&gt;' )
		.replace( /"/g, '&quot;' );
}
