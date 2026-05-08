/**
 * Content Graph — Pixi scene.
 *
 * Owns the `pixi.Application`, the `world` container (pan + zoom
 * transform), and the four child layers:
 *
 *   1. `edgeLayer`      — line per `GraphEdge` (very thin, low alpha).
 *   2. `nodeLayer`      — small `Graphics` disc per `GraphNode`.
 *   3. `labelLayer`     — text label per node, culled when zoomed out.
 *   4. `satelliteLayer` — the `SatelliteLayer` instance fanning out
 *      relationship satellites around the focused node (see
 *      `satellites.ts`).
 *
 * Visual policy: deliberately Obsidian-flavoured — small dark dots,
 * pale 1px edges, labels carry the visual weight at mid-zoom. The
 * focused node + its 1-hop neighbourhood is highlighted in blue so
 * the explored region pops without resorting to per-type colours that
 * dominate the canvas.
 *
 * Interactions:
 *   - **Wheel** zooms with the cursor as the focal point.
 *   - **Drag empty canvas** pans the world.
 *   - **Drag a node** pins it to the cursor and reheats the sim.
 *   - **Click a node** emits `onNodeClick`. The host fetches detail and
 *     calls `setFocusedDetail()`, which paints the satellites.
 *   - **Click background** clears focus + satellites.
 *
 * @public
 * @since 0.8.2
 */

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
import { SatelliteLayer, type SatelliteOpenUrl } from './satellites';
import type {
	GraphEdge,
	GraphNode,
	GraphPayload,
	PostDetail,
} from './types';

const NODE_FILL = 0x4b5563;
const NODE_FILL_FOCUS = 0x2c6be5;
const NODE_FILL_NEIGHBOUR = 0x4f8bf3;
const EDGE_BASE = 0x9aa6b6;
const EDGE_HOT = 0x2c6be5;

export interface SceneCallbacks {
	onNodeClick?: ( node: GraphNode ) => void;
	onBackgroundClick?: () => void;
}

interface NodeView {
	node: GraphNode;
	gfx: PixiGraphics;
	label: PixiText;
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
	private labelLayer!: PixiContainer;
	private satellites: SatelliteLayer | null = null;
	private nodeViews = new Map< number, NodeView >();
	private edgeViews: EdgeView[] = [];
	private nodes: GraphNode[] = [];
	private edges: GraphEdge[] = [];
	private sim: ForceSim | null = null;
	private focusedId: number | null = null;
	private hoveredId: number | null = null;
	private dragNode: GraphNode | null = null;
	private dragOffset = { x: 0, y: 0 };
	private isPanning = false;
	private panStart = { x: 0, y: 0, wx: 0, wy: 0 };
	// Pixi's federated pointer events fire on top of the same DOM
	// pointerdown/pointerup that our canvas-level pan logic listens to.
	// When the user clicks a node, BOTH the node handler and the
	// background-click handler would fire, the second one immediately
	// clearing the focus the first one set. This flag suppresses the
	// background path when a node is the actual click target.
	private nodeClickActive = false;
	private destroyed = false;
	private tickerCb: ( ( t: { deltaTime: number } ) => void ) | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private host: HTMLElement;
	private callbacks: SceneCallbacks;
	private openUrl: SatelliteOpenUrl;

	constructor(
		host: HTMLElement,
		callbacks: SceneCallbacks,
		openUrl: SatelliteOpenUrl,
	) {
		this.host = host;
		this.callbacks = callbacks;
		this.openUrl = openUrl;
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
		app.stage.addChild( this.world );

		this.edgeLayer = new pixi.Container();
		this.nodeLayer = new pixi.Container();
		this.labelLayer = new pixi.Container();
		this.world.addChild( this.edgeLayer, this.nodeLayer, this.labelLayer );

		this.satellites = new SatelliteLayer(
			pixi,
			this.world,
			this.openUrl,
			this.host,
		);

		this.bindStageInput( app.canvas );
		this.bindResize();

		this.tickerCb = ( ticker: { deltaTime: number } ) =>
			this.tick( ticker.deltaTime );
		app.ticker.add( this.tickerCb );
	}

	setData( payload: GraphPayload ): void {
		// Build live nodes preserving positions for ids that already
		// exist so a filter-bar change doesn't snap things around.
		const prev = new Map< number, GraphNode >();
		for ( const n of this.nodes ) {
			prev.set( n.id, n );
		}

		const nodes: GraphNode[] = payload.nodes.map( ( p ) => {
			const old = prev.get( p.id );
			const angle = Math.random() * Math.PI * 2;
			// Initial spread roughly matches the final equilibrium
			// radius so springs and repulsion barely have to work to
			// settle. Wider would mean longer travel; tighter would
			// mean huge initial repulsion forces from densely-packed
			// neighbours.
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
		// Obsidian-style sizing: sqrt growth, capped, so a hub is
		// noticeably bigger but never dominates. The minimum (5px) keeps
		// isolated nodes legible at fitToView; the max (16px) makes a
		// well-connected hub stand out at any zoom level.
		for ( const n of nodes ) {
			n.radius = 5 + Math.min( 11, Math.sqrt( n.degree ) * 3 );
		}

		this.nodes = nodes;
		this.edges = edges;
		this.rebuildSprites();
		this.sim = new ForceSim( nodes, edges );
		// Initial layout: very gentle alpha (0.15) and no random kick.
		// Combined with the integrator's per-step velocity clamp this
		// means the opening animation can never travel more than ~2px
		// per frame regardless of how densely packed the random initial
		// positions happened to be. Calm exhale into shape, not a
		// rebalance.
		this.sim.reheat( 0.15, false );
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
			const gfx = new this.pixi.Graphics();
			gfx.eventMode = 'static';
			gfx.cursor = 'pointer';
			// Hit area scales with the visual radius but always stays at
			// least 16px so dots are easy to click even at the wide
			// default zoom. Origin = node center.
			gfx.hitArea = new this.pixi.Circle( 0, 0, Math.max( 16, n.radius + 6 ) );
			this.bindNodeInput( gfx, n );
			this.nodeLayer.addChild( gfx );

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

			this.nodeViews.set( n.id, { node: n, gfx, label } );
		}
	}

	private truncate( text: string, max: number ): string {
		if ( text.length <= max ) {
			return text;
		}
		return text.slice( 0, max - 1 ).trimEnd() + '…';
	}

	private bindNodeInput( gfx: PixiGraphics, node: GraphNode ): void {
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
			// Wake the simulation up so the surrounding nodes
			// visibly respond as the user drags this one.
			this.sim?.reheat( 1 );
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
			}
			node.pinned = false;
			this.dragNode = null;
			// Strong reheat so the dropped node settles back into the
			// layout instead of leaving a frozen hole.
			this.sim?.reheat( 0.8 );
		} );
		gfx.on( 'pointerupoutside', () => {
			node.pinned = false;
			this.dragNode = null;
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
			// Keep the sim hot while the user actively drags so neighbour
			// nodes follow the spring + repulsion forces frame-by-frame.
			this.sim?.reheat( 1 );
		} );
	}

	private bindStageInput( canvas: HTMLCanvasElement ): void {
		canvas.addEventListener(
			'wheel',
			( ev: WheelEvent ) => {
				ev.preventDefault();
				const factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
				const before = this.toWorld( ev.offsetX, ev.offsetY );
				const next = Math.max(
					0.15,
					Math.min( 4, this.world.scale.x * factor ),
				);
				this.world.scale.set( next );
				const after = this.toWorld( ev.offsetX, ev.offsetY );
				this.world.x += ( after.x - before.x ) * this.world.scale.x;
				this.world.y += ( after.y - before.y ) * this.world.scale.y;
				this.draw();
			},
			{ passive: false },
		);

		canvas.addEventListener( 'pointerdown', ( ev: PointerEvent ) => {
			if ( ev.target !== canvas ) {
				return;
			}
			// Pixi's federated `pointerdown` runs synchronously inside the
			// native event dispatch (Pixi listens on the canvas itself), so
			// by the time we get here `nodeClickActive` already reflects
			// whether a node is the actual target. If it is, abandon pan
			// setup entirely — otherwise the world would pan WHILE the
			// user drags a node, fighting the drag.
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
			// Defense-in-depth: even if `nodeClickActive` was set after the
			// native pointerdown ran (unlikely with current Pixi v8, but the
			// listener-ordering contract isn't documented), bail here too.
			if ( ! this.isPanning || this.nodeClickActive ) {
				return;
			}
			this.world.x = this.panStart.wx + ( ev.clientX - this.panStart.x );
			this.world.y = this.panStart.wy + ( ev.clientY - this.panStart.y );
			this.draw();
		} );
		window.addEventListener( 'pointerup', ( ev: PointerEvent ) => {
			// ALWAYS clear `nodeClickActive` first, before any early-
			// return. If a node click didn't escalate into a pan we'd
			// otherwise leave the flag stuck `true` forever, which then
			// blocks every subsequent empty-canvas pan attempt.
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
		this.resizeObserver = new ResizeObserver( () => {
			this.app.renderer.resize(
				this.host.clientWidth,
				this.host.clientHeight,
			);
			this.draw();
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
		this.draw();
		// Satellites are children of the world container so they pan +
		// zoom for free, but the connector lines need a fresh moveTo /
		// lineTo each tick because the focused node moves as the sim
		// settles. Cheap: one Graphics.clear() + N strokes.
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
				alpha = isFocusEdge ? 0.85 : 0.05;
			} else {
				alpha = isHoverEdge ? 0.7 : 0.18;
			}
			const color = isFocusEdge || isHoverEdge ? EDGE_HOT : EDGE_BASE;
			const width = isFocusEdge || isHoverEdge ? 1.2 : 0.7;
			gfx.moveTo( edge.from.x, edge.from.y )
				.lineTo( edge.to.x, edge.to.y )
				.stroke( { color, width, alpha } );
		}

		const inverseScale = 1 / this.world.scale.x;
		// Hide labels at the wide zoom levels the initial fitToView lands
		// on, so a dense graph reads as Obsidian-style dots first; labels
		// reveal as the user zooms in. The focusNode camera move always
		// pulls the user past this threshold (see `focusNode()`).
		const showLabels = this.world.scale.x > 0.85;
		for ( const v of this.nodeViews.values() ) {
			const { node, gfx, label } = v;
			gfx.clear();
			const isFocus = node.id === focusId;
			const isHover = node.id === hoverId;
			const isNeighbour =
				focusId !== null && focusNeighbours.has( node.id );
			const inFocus = focusId === null || isNeighbour;
			const baseAlpha = inFocus ? 1 : 0.18;

			gfx.x = node.x;
			gfx.y = node.y;

			let fill = NODE_FILL;
			if ( isFocus ) {
				fill = NODE_FILL_FOCUS;
			} else if ( isNeighbour ) {
				fill = NODE_FILL_NEIGHBOUR;
			}

			if ( isFocus || isHover ) {
				gfx.circle( 0, 0, node.radius + 4 ).fill( {
					color: fill,
					alpha: 0.16,
				} );
			}
			gfx.circle( 0, 0, node.radius ).fill( {
				color: fill,
				alpha: baseAlpha,
			} );

			label.x = node.x;
			label.y = node.y + node.radius + 3;
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

	focusNode( id: number ): void {
		this.focusedId = id;
		// Reheat hard so the layout keeps breathing while the user
		// inspects the panel. Without this the sim is usually well
		// past its alpha-cooldown by the time you click and the graph
		// appears frozen.
		this.sim?.reheat( 1 );
		const view = this.nodeViews.get( id );
		if ( view ) {
			const target = view.node;
			// Zoom to a comfortable level so labels become legible AND
			// satellites land at human-readable size. Don't zoom OUT if
			// the user already zoomed in further than this.
			const targetScale = Math.max( this.world.scale.x, 1.6 );
			const fromScale = this.world.scale.x;
			const fromX = this.world.x;
			const fromY = this.world.y;
			const toX = this.host.clientWidth / 2 - target.x * targetScale;
			const toY = this.host.clientHeight / 2 - target.y * targetScale;
			animateValues(
				{ x: fromX, y: fromY, s: fromScale },
				{ x: toX, y: toY, s: targetScale },
				300,
				( v ) => {
					this.world.x = v.x;
					this.world.y = v.y;
					this.world.scale.set( v.s );
					this.draw();
				},
			);
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
		// Keep the sim hot so the focused node and its neighbours visibly
		// react to the satellite ring forming around them, instead of
		// looking like a static snapshot.
		this.sim?.reheat( 0.9 );
	}

	/**
	 * Public reheat for the toolbar button. Bumps alpha AND adds a
	 * random velocity kick (handled inside `sim.reheat()`), so the
	 * cluster visibly resettles even from a fully-cooled state.
	 */
	reheat( value = 1 ): void {
		this.sim?.reheat( value );
	}

	clearFocus(): void {
		this.focusedId = null;
		this.satellites?.clear();
		// Closing the panel should make the layout feel "alive" again —
		// reheat the simulation so the cluster gently re-settles
		// (especially after dragging a node), instead of staying frozen.
		this.sim?.reheat( 0.7 );
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
		const w = ( maxX - minX ) + padding * 2;
		const h = ( maxY - minY ) + padding * 2;
		const sx = this.host.clientWidth / w;
		const sy = this.host.clientHeight / h;
		const s = Math.max( 0.15, Math.min( 1.5, Math.min( sx, sy ) ) );
		this.world.scale.set( s );
		const cx = ( minX + maxX ) / 2;
		const cy = ( minY + maxY ) / 2;
		this.world.x = this.host.clientWidth / 2 - cx * s;
		this.world.y = this.host.clientHeight / 2 - cy * s;
		this.draw();
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

function animateValues(
	from: { x: number; y: number; s: number },
	to: { x: number; y: number; s: number },
	durationMs: number,
	step: ( v: { x: number; y: number; s: number } ) => void,
): void {
	const t0 = performance.now();
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const ds = to.s - from.s;
	function frame( now: number ) {
		const t = Math.min( 1, ( now - t0 ) / durationMs );
		const k = 1 - Math.pow( 1 - t, 3 );
		step( {
			x: from.x + dx * k,
			y: from.y + dy * k,
			s: from.s + ds * k,
		} );
		if ( t < 1 ) {
			requestAnimationFrame( frame );
		}
	}
	requestAnimationFrame( frame );
}
