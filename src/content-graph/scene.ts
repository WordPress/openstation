import { __ } from '../i18n';
import { decodeHTML } from '../utils';
import {
	subscribeWorkArea,
	workAreaInsetsOf,
	type WorkAreaInsets,
} from '../work-area';
import { resolveDashicon } from '../ui/components/os-icon/dashicons-map';
import {
	getPixi,
	type DesktopApiLike,
	type PixiApp,
	type PixiContainer,
	type PixiGraphics,
	type PixiNamespace,
	type PixiText,
} from './pixi-types';
import {
	frameBounds,
	JOIN_WARMUP_STEPS,
	randomSeed,
	seedPositions,
	warmupStepLimit,
	type Point,
} from './layout';
import { pinchCamera } from './pinch';
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

const RENDER_SUPERSAMPLE = 1.5;

const RENDER_RESOLUTION = Math.min(
	( ( typeof window !== 'undefined' && window.devicePixelRatio ) || 1 ) *
		RENDER_SUPERSAMPLE,
	3,
);

const TYPE_PALETTE = [
	0x3a6df0,
	0x2ca97a,
	0xe8893a,
	0xa05ed4,
	0x2fa5b8,
	0xd4508f,
	0x6b7785,
];

const DISC_RING = 0xffffff;

export type NodeStyle = 'disc' | 'icon';

const FOCUS_DISC_SCALE = 1.3;

const ICON_NUDGE_Y_ASCENT = 0;
const ICON_NUDGE: Record< string, { x: number; y: number } > = {
	'admin-post': { x: 0.06, y: 0.06 },
};

const GROUP_LABEL_COLOR: Record< GroupFacet, string > = {
	category: '#2c6be5',
	tag: '#2ca97a',
	author: '#7c3aed',
	year: '#ea580c',
	year_month: '#ea580c',
};

const ZOOM_MIN = 0.15;
const ZOOM_MAX = 4;

const FIT_ZOOM_MAX = 1.5;
const FIT_OPTIONS = {
	padding: 100,
	minScale: ZOOM_MIN,
	maxScale: FIT_ZOOM_MAX,
};
const ZOOM_SENSITIVITY = 0.0008;

const PINCH_CLICK_GRACE_MS = 300;
const CAMERA_EASE = 0.18;

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
	disc: PixiGraphics;
	icon: PixiText;
	labelBox: PixiContainer;
	labelBg: PixiGraphics;
	label: PixiText;
	iconCharCode: string | null;
	iconName: string;

	typeColor: number;

	discKey: string;
}

interface EdgeView {
	edge: GraphEdge;
	gfx: PixiGraphics;
}

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

	private spokeLayer!: PixiContainer;
	private nodeLayer!: PixiContainer;
	private labelLayer!: PixiContainer;

	private groupLabelOverlay: HTMLDivElement | null = null;
	private satellites: SatelliteLayer | null = null;
	private nodeViews = new Map< number, NodeView >();
	private edgeViews: EdgeView[] = [];
	private groupViews = new Map< string, GroupView >();
	private currentGrouping: GroupFacet | null = null;

	private groupCatalogs: GraphGroupCatalogs = {
		authors: {},
		categories: {},
		tags: {},
	};

	private groupingTween: {
		startTime: number;
		duration: number;
		starts: Map< number, { x: number; y: number } >;
		targets: Map< number, { x: number; y: number } >;
	} | null = null;

	private fitFollowActive = false;
	private fitFollowStartedAt = 0;

	private fitFollowSawMotion = false;
	private readonly fitFollowMaxDurationMs = 3000;
	private readonly fitFollowVelocityThreshold = 1.0;
	private nodes: GraphNode[] = [];
	private edges: GraphEdge[] = [];
	private sim: ForceSim | null = null;
	private focusedId: number | null = null;
	private hoveredId: number | null = null;

	private pressedNode: GraphNode | null = null;
	private dragOffset = { x: 0, y: 0 };
	private isPanning = false;
	private panStart = { x: 0, y: 0, wx: 0, wy: 0 };
	private nodeClickActive = false;

	private pointers = new Map< number, Point >();
	private pinchUntil = 0;
	private destroyed = false;
	private tickerCb: ( ( t: { deltaTime: number } ) => void ) | null = null;
	private resizeObserver: ResizeObserver | null = null;

	private fitInsets: WorkAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };
	private unsubscribeWorkArea: ( () => void ) | null = null;
	private lastResizeWidth = 0;
	private lastResizeHeight = 0;

	private fitPending = false;

	private targetScale = 1;
	private targetX = 0;
	private targetY = 0;
	private host: HTMLElement;
	private callbacks: SceneCallbacks;
	private onSatelliteClick: SatelliteOnClick;
	private postTypeIcon: PostTypeIconLookup;
	private postTypeBySlug: Map< string, PostTypeDescriptor >;
	private postTypeColor = new Map< string, number >();

	private nodeStyle: NodeStyle = 'disc';

	constructor(
		host: HTMLElement,
		callbacks: SceneCallbacks,
		onSatelliteClick: SatelliteOnClick,
		postTypes: PostTypeDescriptor[],
		nodeStyle: NodeStyle = 'disc',
	) {
		this.host = host;
		this.callbacks = callbacks;
		this.onSatelliteClick = onSatelliteClick;
		this.nodeStyle = nodeStyle;
		const map = new Map< string, string >();
		this.postTypeBySlug = new Map();
		for ( const t of postTypes ) {
			map.set( t.slug, normalizeDashiconName( t.icon ) );
			this.postTypeBySlug.set( t.slug, t );
		}

		postTypes.forEach( ( t, i ) => {
			this.postTypeColor.set(
				t.slug,
				TYPE_PALETTE[ i % TYPE_PALETTE.length ],
			);
		} );

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

		if ( typeof document !== 'undefined' && document.fonts ) {
			try {
				await document.fonts.load( '16px dashicons' );
			} catch {

			}
		}

		const app = new pixi.Application();
		await app.init( {
			resizeTo: this.host,
			backgroundAlpha: 0,
			antialias: true,
			autoDensity: true,

			resolution: RENDER_RESOLUTION,

			sharedTicker: false,
		} );
		this.app = app;
		this.host.appendChild( app.canvas );
		app.canvas.classList.add( 'os-content-graph__canvas' );

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

		this.groupLabelOverlay = document.createElement( 'div' );
		this.groupLabelOverlay.className =
			'os-content-graph__group-labels';
		this.host.appendChild( this.groupLabelOverlay );

		app.canvas.addEventListener(
			'webglcontextlost',
			( ev ) => {
				ev.preventDefault();
				try {
					this.app?.ticker?.stop();
				} catch {

				}
			},
			false,
		);

		const renderer = app.renderer as { render: ( ...a: unknown[] ) => unknown };
		const origRender = renderer.render.bind( renderer );
		renderer.render = ( ...a: unknown[] ) => {
			try {
				return origRender( ...a );
			} catch ( err ) {
				try {
					this.app?.ticker?.stop();
				} catch {

				}

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

		this.groupCatalogs = payload.groups ?? {
			authors: {},
			categories: {},
			tags: {},
		};

		const fromScratch = payload.nodes.every( ( p ) => ! prev.has( p.id ) );
		const seeds = fromScratch
			? seedPositions( payload.nodes.length )
			: null;
		const nodes: GraphNode[] = payload.nodes.map( ( p, i ) => {
			const old = prev.get( p.id );
			const seed = seeds ? seeds[ i ] : randomSeed();
			return {
				...p,
				x: old?.x ?? seed.x,
				y: old?.y ?? seed.y,
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

		const warmupSteps = fromScratch
			? warmupStepLimit( nodes.length )
			: JOIN_WARMUP_STEPS;
		for ( let i = 0; i < warmupSteps && ! this.sim.isSettled; i++ ) {
			this.sim.step( 1 );
		}

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

			const disc = new this.pixi.Graphics();
			container.addChild( disc );

			const iconName = this.postTypeIcon( n.type );
			const iconChar = resolveDashicon( iconName );
			const icon = new this.pixi.Text( {
				text: iconChar ?? '●',
				style: {
					fontFamily: iconChar ? 'dashicons' : 'sans-serif',
					fontSize: 2 * n.radius,
					fill: NODE_FILL,
				},
				resolution: RENDER_RESOLUTION,
				anchor: { x: 0.5, y: 0.5 },
			} );
			container.addChild( icon );

			const labelBox = new this.pixi.Container();
			this.labelLayer.addChild( labelBox );

			const labelBg = new this.pixi.Graphics();
			labelBox.addChild( labelBg );

			const label = new this.pixi.Text( {
				text: this.truncate( decodeHTML( n.title ) || `#${ n.id }`, 32 ),
				style: {
					fill: 0x1f2937,
					fontSize: 11,
					fontFamily:
						'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
					fontWeight: '500',
				},
				resolution: RENDER_RESOLUTION,
				anchor: { x: 0.5, y: 0 },
			} );
			labelBox.addChild( label );

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
				disc,
				icon,
				labelBox,
				labelBg,
				label,
				iconCharCode: iconChar,
				iconName,
				typeColor:
					this.postTypeColor.get( n.type ) ?? TYPE_PALETTE[ 0 ],

				discKey: '',
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

			if ( ! isDragging && dx * dx + dy * dy <= 256 && ! this.pinchRecent() ) {
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

	private pinchRecent(): boolean {
		return this.pointers.size >= 2 || performance.now() < this.pinchUntil;
	}

	private canvasPoint( canvas: HTMLCanvasElement, ev: PointerEvent ): Point {
		const rect = canvas.getBoundingClientRect();
		return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
	}

	private bindStageInput( canvas: HTMLCanvasElement ): void {
		canvas.style.touchAction = 'none';

		canvas.addEventListener(
			'wheel',
			( ev: WheelEvent ) => {
				ev.preventDefault();

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
			this.pointers.set( ev.pointerId, this.canvasPoint( canvas, ev ) );
			if ( this.pointers.size === 2 ) {
				this.isPanning = false;
				this.nodeClickActive = false;
				if ( this.pressedNode ) {
					this.pressedNode.pinned = this.focusedId === this.pressedNode.id;
					this.pressedNode = null;
					if ( this.sim ) {
						this.sim.dragOrigin = null;
					}
				}
				return;
			}
			if ( ev.target !== canvas ) {
				return;
			}
			if ( this.nodeClickActive || this.pointers.size > 1 ) {
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
			if ( this.pointers.has( ev.pointerId ) ) {
				const prev = this.pointers.get( ev.pointerId ) as Point;
				const next = this.canvasPoint( canvas, ev );
				this.pointers.set( ev.pointerId, next );
				if ( this.pointers.size === 2 ) {
					this.pinch( ev.pointerId, prev );
					return;
				}
			}
			if ( ! this.isPanning || this.nodeClickActive || this.pointers.size > 1 ) {
				return;
			}

			const newX = this.panStart.wx + ( ev.clientX - this.panStart.x );
			const newY = this.panStart.wy + ( ev.clientY - this.panStart.y );
			this.world.x = newX;
			this.world.y = newY;
			this.targetX = newX;
			this.targetY = newY;
		} );
		const release = ( ev: PointerEvent ): void => {
			const wasPinch = this.pointers.size >= 2;
			this.pointers.delete( ev.pointerId );
			if ( wasPinch ) {
				this.isPanning = false;
				this.pinchUntil = performance.now() + PINCH_CLICK_GRACE_MS;
			}
		};
		window.addEventListener( 'pointercancel', release );
		window.addEventListener( 'pointerup', ( ev: PointerEvent ) => {
			release( ev );
			const nodeWasTarget = this.nodeClickActive;
			this.nodeClickActive = false;
			if ( ! this.isPanning ) {
				return;
			}
			const dx = ev.clientX - this.panStart.x;
			const dy = ev.clientY - this.panStart.y;
			this.isPanning = false;
			if ( ! nodeWasTarget && ! this.pinchRecent() && dx * dx + dy * dy < 9 ) {
				this.callbacks.onBackgroundClick?.();
			}
		} );
	}

	private pinch( movedId: number, prev: Point ): void {
		let other: Point | null = null;
		let moved: Point | null = null;
		for ( const [ id, p ] of this.pointers ) {
			if ( id === movedId ) {
				moved = p;
			} else {
				other = p;
			}
		}
		if ( ! moved || ! other ) {
			return;
		}
		const next = pinchCamera(
			{ scale: this.world.scale.x, x: this.world.x, y: this.world.y },
			{ a: prev, b: other },
			{ a: moved, b: other },
			{ min: ZOOM_MIN, max: ZOOM_MAX },
		);
		this.world.scale.set( next.scale );
		this.world.x = next.x;
		this.world.y = next.y;
		this.targetScale = next.scale;
		this.targetX = next.x;
		this.targetY = next.y;
		this.pinchUntil = performance.now() + PINCH_CLICK_GRACE_MS;
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

			this.fitInsets = workAreaInsetsOf( this.host );

			if ( w <= 0 || h <= 0 ) {
				return;
			}
			try {
				this.app.renderer.resize( w, h );
			} catch {
				return;
			}

			try {
				this.app.render();
			} catch {

			}
			if ( this.fitPending ) {
				this.fitToView();
			}

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

		this.unsubscribeWorkArea = subscribeWorkArea( () => {
			if ( ! this.destroyed ) {
				this.fitInsets = workAreaInsetsOf( this.host );
			}
		} );
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

		if ( ! this.app || ! this.world ) {
			return;
		}
		if ( this.groupingTween ) {
			this.advanceGroupingTween();
		} else {
			this.sim?.step( delta );
		}

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
			this.fitToView( false );
		} else if ( this.fitFollowSawMotion ) {
			this.fitFollowActive = false;
		}
	}

	private postTypeSupportsTaxonomy( typeSlug: string, taxonomy: 'category' | 'post_tag' ): boolean {
		return this.postTypeBySlug.get( typeSlug )?.taxonomies?.[ taxonomy ] ?? false;
	}

	private postTypeLabel( typeSlug: string ): string {
		return this.postTypeBySlug.get( typeSlug )?.label ?? typeSlug;
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

				const keys = [ primaryKey, primaryKey ];

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

			const label = `${ this.labelForGroupKey( key ) } (${ ids.length })`;
			const el = document.createElement( 'div' );
			el.className = 'os-content-graph__group-label';
			el.textContent = label;
			el.style.setProperty( '--os-ui-cg-cluster-color', tint );
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

	private drawGroupLabels(): void {
		if ( this.destroyed || this.groupViews.size === 0 ) {
			return;
		}

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
				alpha = isFocusEdge ? 0.85 : 0;
			} else if ( isHoverEdge ) {
				alpha = 0.7;
			} else {
				alpha = edgeBaseAlpha;
			}
			const color = isFocusEdge || isHoverEdge ? EDGE_HOT : EDGE_BASE;
			const width = isFocusEdge || isHoverEdge ? 1.2 : 0.7;

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

		const zoomFade = smoothstep( 0.55, 0.95, this.world.scale.x );
		const discs = this.nodeStyle === 'disc';
		for ( const v of this.nodeViews.values() ) {
			const { node, container, halo, disc, icon, labelBox } = v;
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
			const discFill = isFocus ? NODE_FILL_FOCUS : v.typeColor;

			halo.clear();
			if ( isFocus || isHover ) {
				halo.circle( 0, 0, node.radius + 8 ).fill( {
					color: discs ? discFill : fill,
					alpha: 0.18,
				} );
			}

			const discRadius = isFocus
				? node.radius * FOCUS_DISC_SCALE
				: node.radius;
			const ringWidth = isFocus || isHover ? 2.5 : 1.5;
			const discKey = discs
				? `${ discFill }|${ discRadius }|${ ringWidth }`
				: 'off';
			if ( v.discKey !== discKey ) {
				v.discKey = discKey;
				disc.clear();
				if ( discs ) {
					disc.circle( 0, 0, discRadius )
						.fill( { color: discFill, alpha: 0.95 } )
						.stroke( {
							color: DISC_RING,
							width: ringWidth,
							alpha: 1,
						} );
				}
			}

			icon.visible = ! discs || isFocus || isHover;
			icon.style.fill = discs ? DISC_RING : fill;
			const fontSize = discs ? discRadius * 1.35 : 2 * node.radius;
			icon.style.fontSize = fontSize;

			const nudge = ICON_NUDGE[ v.iconName ];
			icon.x = ( nudge?.x ?? 0 ) * fontSize;
			icon.y = ( ( nudge?.y ?? ICON_NUDGE_Y_ASCENT ) ) * fontSize;

			labelBox.x = node.x;

			labelBox.y = node.y + ( discs ? discRadius : node.radius ) + 4;
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
		if ( this.focusedId !== null ) {
			const prev = this.nodeViews.get( this.focusedId );
			if ( prev ) {
				prev.node.pinned = false;
			}
		}
		this.focusedId = id;

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
	}

	setGrouping( facet: GroupFacet | null ): void {
		this.currentGrouping = facet;
		this.clearGroupViews();
		if ( ! facet || ! this.sim ) {
			this.sim?.setGroupAssignment( null );
			return;
		}
		const assignment = new Map< number, string[] >();

		const members = new Map< string, number[] >();
		for ( const n of this.nodes ) {
			const keys = this.deriveGroupKeys( n, facet );
			assignment.set( n.id, keys );

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

		this.sim.groupOrderStaggerY = facet === 'year_month' ? 160 : 0;

		this.sim.setGroupAssignment( assignment, order );

		const targets = this.buildGroupSeedTargets( assignment, members, order );
		this.startGroupingTween( targets );
		this.fitToViewOfTargets( targets );
		this.buildGroupViews( members, facet );

		this.fitFollowActive = true;
		this.fitFollowStartedAt = performance.now();
		this.fitFollowSawMotion = false;
	}

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

			this.sim?.reheat( 0.18, false );
		}
	}

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

			duration: 450,
			starts,
			targets,
		};
	}

	private fitToViewOfTargets(
		targets: Map< number, { x: number; y: number } >,
	): void {
		if ( targets.size === 0 ) {
			return;
		}

		this.fitInsets = workAreaInsetsOf( this.host );
		this.frame( targets.values() );
	}

	private frame( points: Iterable< Point > ): void {
		const inset = this.fitInsets;
		const target = frameBounds(
			points,
			{
				width: this.host.clientWidth - inset.left - inset.right,
				height: this.host.clientHeight - inset.top - inset.bottom,
			},
			FIT_OPTIONS,
		);
		if ( ! target ) {
			this.fitPending = true;
			return;
		}
		this.fitPending = false;
		this.targetScale = target.scale;
		this.targetX = inset.left + target.x;
		this.targetY = inset.top + target.y;
	}

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

				ordered.push( { key, sort: String( y ).padStart( 6, '0' ) } );
			} else {
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

		this.sim?.reheat( 0.25, false );
		this.draw();
	}

	setSatelliteSelectedKey( key: string | null ): void {
		this.satellites?.setSelectedKey( key );
	}

	getNode( id: number ): GraphNode | undefined {
		return this.nodes.find( ( n ) => n.id === id );
	}

	getNodes(): GraphNode[] {
		return this.nodes;
	}

	setNodeStyle( style: NodeStyle ): void {
		if ( this.nodeStyle === style ) {
			return;
		}
		this.nodeStyle = style;
		for ( const v of this.nodeViews.values() ) {
			v.discKey = '';
		}
	}

	getNodeStyle(): NodeStyle {
		return this.nodeStyle;
	}

	getFocusedId(): number | null {
		return this.focusedId;
	}

	fitToView( measure = true ): void {
		if ( this.nodes.length === 0 ) {
			return;
		}
		if ( measure ) {
			this.fitInsets = workAreaInsetsOf( this.host );
		}
		this.frame( this.nodes );
	}

	destroy(): void {
		this.destroyed = true;

		try {
			this.app?.ticker?.stop();
		} catch {

		}
		if ( this.tickerCb ) {
			try {
				this.app?.ticker?.remove( this.tickerCb );
			} catch {

			}
			this.tickerCb = null;
		}
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		this.unsubscribeWorkArea?.();
		this.unsubscribeWorkArea = null;
		this.satellites?.destroy();
		this.satellites = null;

		this.clearGroupViews();
		this.groupLabelOverlay?.remove();
		this.groupLabelOverlay = null;

		try {
			this.app.destroy( { removeView: true }, { children: true } );
		} catch {

		}
	}
}

function normalizeDashiconName( raw: string ): string {
	if ( typeof raw !== 'string' || raw === '' ) {
		return 'admin-generic';
	}
	if ( raw.startsWith( 'http://' ) || raw.startsWith( 'https://' ) ) {
		return 'admin-generic';
	}
	return raw.replace( /^dashicons-/, '' );
}

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
