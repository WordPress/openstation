/**
 * Pixi-driven mindmap for the Categories tab — v3.
 *
 * Pure Pixi render: discs, edges, name + count chips, and post
 * chips all live inside the world container so they zoom/pan
 * sub-pixel-smoothly with the wheel. Chip text uses Pixi.Text at
 * resolution: 3 to stay crisp through the world's full zoom range
 * (capped at 2.5×). The sidebar editor remains HTML — that's the
 * one piece of UI where native form inputs are still the right
 * tool.
 *
 * Interactions:
 *   - **Click** a node → focuses it: the node grows, satellite post
 *     cards animate out from its center, and an inline editor opens
 *     above the node with editable name + description + Save/Delete.
 *     Posts beyond the first 12 paginate via ←/→ arrows.
 *   - **Drag** node onto another → reparent (REST update).
 *   - **Drag** empty canvas → pan; **wheel** → zoom.
 *   - **+ Add root** button → spawns a placeholder node at canvas
 *     center with an open inline editor.
 *   - **Click empty space** → close the focused node + post fan.
 *
 * @public
 * @since 0.8.0
 */

import { __, sprintf } from '../i18n';
import {
	createCategory,
	deleteTerm,
	fetchTerms,
	updateTerm,
	getConfig,
	type TermRow,
} from './rest';

interface PixiPoint {
	x: number;
	y: number;
}
interface PixiContainer {
	x: number;
	y: number;
	alpha: number;
	scale: { x: number; y: number; set( s: number ): void };
	addChild( ...children: unknown[] ): void;
	removeChild( child: unknown ): void;
	destroy( opts?: unknown ): void;
	visible: boolean;
	eventMode: string;
	cursor: string;
	on( event: string, cb: ( e: unknown ) => void ): void;
	hitArea: unknown;
	zIndex: number;
}
interface PixiGraphics extends PixiContainer {
	clear(): PixiGraphics;
	circle( x: number, y: number, r: number ): PixiGraphics;
	roundRect(
		x: number,
		y: number,
		w: number,
		h: number,
		r: number,
	): PixiGraphics;
	moveTo( x: number, y: number ): PixiGraphics;
	bezierCurveTo(
		cp1x: number,
		cp1y: number,
		cp2x: number,
		cp2y: number,
		x: number,
		y: number,
	): PixiGraphics;
	lineTo( x: number, y: number ): PixiGraphics;
	stroke( style: { color: number; width: number; alpha?: number; alignment?: number } ): PixiGraphics;
	fill( style: { color: number; alpha?: number } | number ): PixiGraphics;
}
interface PixiApp {
	canvas: HTMLCanvasElement;
	stage: PixiContainer;
	renderer: {
		resize( w: number, h: number ): void;
		width: number;
		height: number;
		render( container?: unknown ): void;
	};
	init( opts: unknown ): Promise< void >;
	render(): void;
	destroy( clearStage?: boolean, opts?: unknown ): void;
}
interface PixiText extends PixiContainer {
	text: string;
	width: number;
	height: number;
	anchor: { set( v: number ): void; x?: number; y?: number };
	style: { fill: number; fontSize?: number; fontFamily?: string; fontWeight?: string };
	resolution: number;
}
interface PixiTextOpts {
	text: string;
	style: {
		fill: number;
		fontSize?: number;
		fontFamily?: string;
		fontWeight?: string;
		align?: string;
	};
	resolution?: number;
	anchor?: { x: number; y: number };
}
interface PixiNamespace {
	Application: new () => PixiApp;
	Container: new () => PixiContainer;
	Graphics: new () => PixiGraphics;
	Text: new ( opts: PixiTextOpts ) => PixiText;
	Rectangle: new ( x: number, y: number, w: number, h: number ) => unknown;
	Circle: new ( x: number, y: number, r: number ) => unknown;
}

interface CategoryChip {
	container: PixiContainer;
	bg: PixiGraphics;
	nameText: PixiText;
	countBg: PixiGraphics;
	countText: PixiText;
	width: number;
	height: number;
	cachedName: string;
	cachedCount: number;
	cachedFocused: boolean;
	cachedHover: boolean;
	cachedColor: number;
}

interface PostChip {
	container: PixiContainer;
	bg: PixiGraphics;
	dot: PixiGraphics;
	titleText: PixiText;
	width: number;
	height: number;
	cachedTitle: string;
	cachedHover: boolean;
}

interface MindNode {
	id: number;
	parent: number;
	name: string;
	description: string;
	count: number;
	x: number;
	y: number;
	tx: number;
	ty: number;
	radius: number;
	depth: number;
	color: number;
	gfx: PixiGraphics;
	pinned: boolean;
}

interface PostMini {
	id: number;
	title: string;
	editUrl: string;
	angle: number;
	r: number; // distance from focus center
	x: number;
	y: number;
	tx: number;
	ty: number;
	gfx: PixiGraphics;
	tone: number;
}

const REPULSION_K = 5500;
const SPRING_K = 0.05;
const SPRING_LEN = 130;
const MIN_RADIUS = 22;
const MAX_RADIUS = 48;
const POST_PER_PAGE = 10;
const POST_RING_RADIUS = 170;

/**
 * Mount the mindmap inside `host`. Self-fetches the category tree on
 * first mount; subsequent reparents/renames/creates are pushed
 * through REST and reflected locally. Returns a teardown that
 * destroys the WebGL context + HTML overlays.
 */
export async function mountCategoriesMindmap(
	host: HTMLElement,
): Promise< () => void > {
	const api = window.wp?.desktop;
	if ( ! api || typeof api.loadModules !== 'function' ) {
		host.textContent = __( 'Mindmap unavailable: shell modules API missing.' );
		return () => {};
	}
	try {
		await api.loadModules( [ 'pixijs' ] );
	} catch {
		host.textContent = __( 'Mindmap unavailable.' );
		return () => {};
	}
	const pixiMaybe = ( window as unknown as { PIXI?: PixiNamespace } ).PIXI;
	if ( ! pixiMaybe ) {
		host.textContent = __( 'Mindmap unavailable.' );
		return () => {};
	}
	// Local non-null binding so the closure-captured `pixi` doesn't
	// re-narrow back to `PixiNamespace | undefined` inside helpers
	// declared further down (TS only narrows within the immediate
	// branch of the `if` check).
	const pixi: PixiNamespace = pixiMaybe;

	host.replaceChildren();
	host.classList.add( 'wpd-mindmap' );

	// --- Toolbar -------------------------------------------------------
	const toolbar = document.createElement( 'div' );
	toolbar.className = 'wpd-mindmap__toolbar';
	const addRootBtn = document.createElement( 'button' );
	addRootBtn.type = 'button';
	addRootBtn.className = 'wpd-mindmap__btn wpd-mindmap__btn--primary';
	addRootBtn.innerHTML =
		'<span class="dashicons dashicons-plus" aria-hidden="true"></span>' +
		__( 'Add root category' );
	const recenterBtn = document.createElement( 'button' );
	recenterBtn.type = 'button';
	recenterBtn.className = 'wpd-mindmap__btn';
	recenterBtn.innerHTML =
		'<span class="dashicons dashicons-image-rotate" aria-hidden="true"></span>' +
		__( 'Recenter' );
	const hint = document.createElement( 'span' );
	hint.className = 'wpd-mindmap__hint';
	hint.textContent = __(
		'Click a node to focus + edit · drag onto another to reparent · wheel to zoom',
	);
	toolbar.appendChild( addRootBtn );
	toolbar.appendChild( recenterBtn );
	toolbar.appendChild( hint );
	host.appendChild( toolbar );

	// --- Layout: canvas on the left, fixed sidebar on the right -----
	const layout = document.createElement( 'div' );
	layout.className = 'wpd-mindmap__layout';
	host.appendChild( layout );

	// Stage is the host for Pixi's canvas. Chips and post chips now
	// render inside the world container as Pixi nodes — no HTML
	// overlay needed. The sidebar owns the editor surface so the
	// user can always see + edit term metadata without it covering
	// the post nodes.
	const stage = document.createElement( 'div' );
	stage.className = 'wpd-mindmap__stage';
	// `is-loading` keeps the stage at opacity:0 until the very first
	// `fitToView()` runs (handled by the ResizeObserver). Without
	// this the canvas briefly paints its tree at the default
	// unzoomed, uncentered transform — visible as a "renders →
	// centers → renders again" flash.
	stage.classList.add( 'is-loading' );
	layout.appendChild( stage );

	// Sidebar — fixed-width right column. Empty state when no node is
	// focused, full editor form when one is.
	const sidebar = document.createElement( 'aside' );
	sidebar.className = 'wpd-mindmap__sidebar';
	layout.appendChild( sidebar );

	// --- Pixi --------------------------------------------------------
	const app = new pixi.Application();
	await app.init( {
		resizeTo: stage,
		backgroundAlpha: 0,
		antialias: true,
		autoDensity: true,
		resolution: Math.min( window.devicePixelRatio || 1, 2 ),
	} );
	stage.appendChild( app.canvas );
	app.canvas.classList.add( 'wpd-mindmap__canvas' );

	const world = new pixi.Container();
	world.x = stage.clientWidth / 2;
	world.y = stage.clientHeight / 2;
	app.stage.addChild( world );

	const edgeLayer = new pixi.Container();
	const nodeLayer = new pixi.Container();
	const postEdgeLayer = new pixi.Container();
	const postLayer = new pixi.Container();
	// Chip layers live ABOVE the discs so chip text stays readable
	// when discs are dense. Both layers are children of `world`, so
	// they inherit the world's pan/zoom transform — chips scale
	// sub-pixel-smoothly with the wheel zoom. (Earlier the chips were
	// HTML overlay nodes, which gave us the integer-pixel rounding
	// jumps the user kept reporting.)
	const chipLayer = new pixi.Container();
	const postChipLayer = new pixi.Container();
	world.addChild( edgeLayer );
	world.addChild( postEdgeLayer );
	world.addChild( postLayer );
	world.addChild( nodeLayer );
	world.addChild( chipLayer );
	world.addChild( postChipLayer );

	const edgeGfx = new pixi.Graphics();
	edgeLayer.addChild( edgeGfx );
	const postEdgeGfx = new pixi.Graphics();
	postEdgeLayer.addChild( postEdgeGfx );

	// Hoisted text rasterisation constant — also used by the chip
	// renderer further down. 4× rasterises every glyph texture at
	// 4× detail so text stays crisp through the world's full zoom
	// range (up to 2.5×) AND on Retina/HiDPI displays where the
	// canvas itself is already pixel-doubled. Higher values cost
	// GPU memory; 4 is the sweet spot for the largest text we render
	// (28pt-ish post titles at peak zoom).
	const CHIP_TEXT_RES = 4;

	// Pager: a single Pixi container holding two arrow buttons + a
	// page-count text node. Lives on the post layer so it scales with
	// the world (matches the satellite ring it controls). Showing/
	// hiding via `.visible` lets us paint once and toggle, instead of
	// destroying + recreating per render.
	const pager = new pixi.Container();
	// Container is just a holder — let pointer events pass straight
	// through to its children (which DO opt in via eventMode='static'
	// + explicit hitArea). With eventMode='static' on the container
	// AND no hitArea, Pixi falls back to the union of child bounds,
	// which silently captures clicks meant for the focused node and
	// nearby satellite posts.
	pager.eventMode = 'passive';
	pager.visible = false;
	postLayer.addChild( pager );
	const pagerPrev = new pixi.Graphics();
	const pagerNext = new pixi.Graphics();
	const pagerLabel = new pixi.Text( {
		text: '1 / 1',
		style: {
			fill: 0x50575e,
			fontSize: 14,
			fontFamily:
				'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
			fontWeight: '600',
		},
		resolution: CHIP_TEXT_RES,
	} );
	pagerLabel.anchor.set( 0.5 );
	pagerPrev.eventMode = 'static';
	pagerPrev.cursor = 'pointer';
	pagerNext.eventMode = 'static';
	pagerNext.cursor = 'pointer';
	// Explicit hit-areas so a clean disc shape catches clicks even
	// before drawPagerButton has rendered (and across world-zoom
	// changes Pixi might otherwise snapshot incorrectly).
	pagerPrev.hitArea = new pixi.Circle( 0, 0, 16 );
	pagerNext.hitArea = new pixi.Circle( 0, 0, 16 );
	pager.addChild( pagerPrev );
	pager.addChild( pagerLabel );
	pager.addChild( pagerNext );
	// Stop pointerdown from bubbling to the stage — otherwise the
	// stage's `panActive` latches on every click and the mouseup on
	// the same button gets interpreted as the end of a (zero-distance)
	// pan rather than a tap on the button. Also mark the pixi
	// interaction so the canvas-click closeFocus debounce kicks in.
	const stopBubble = ( e: unknown ): void => {
		( e as { stopPropagation?: () => void } ).stopPropagation?.();
		pixiInteractionAt = performance.now();
	};
	pagerPrev.on( 'pointerdown', stopBubble );
	pagerNext.on( 'pointerdown', stopBubble );
	pagerPrev.on( 'pointertap', ( e ) => {
		stopBubble( e );
		// Pixi paints into the canvas, so a click on the pager arrow
		// also fires a DOM `click` on the canvas underneath. The
		// canvas-click handler closes focus when no Pixi node was
		// involved — bumping lastFocusChange short-circuits it via
		// the same debounce path node-click uses.
		lastFocusChange = performance.now();
		if ( focusPage <= 1 ) {
			return;
		}
		focusPage--;
		void loadPostsForFocus();
	} );
	pagerNext.on( 'pointertap', ( e ) => {
		stopBubble( e );
		lastFocusChange = performance.now();
		if ( focusPage >= focusTotalPages ) {
			return;
		}
		focusPage++;
		void loadPostsForFocus();
	} );

	// --- State --------------------------------------------------------
	const nodes = new Map< number, MindNode >();
	const chips = new Map< number, CategoryChip >();
	const postChips = new Map< number, PostChip >();
	const postNodes = new Map< number, PostMini >();
	let focusId: number | null = null;
	let focusPage = 1;
	let focusTotalPages = 1;
	// Monotonic token for in-flight post loads. Each call to
	// `loadPostsForFocus()` captures the token at start and only
	// commits its result if the token still matches. Without this, a
	// fast click between nodes (or a paginate during a slow fetch)
	// races: an older response lands AFTER focus has already moved
	// elsewhere, and the satellite ring renders stale posts attached
	// to the wrong category. Symptom the user reported: posts
	// disappear and can't be reopened.
	let loadSeq = 0;
	// `pixiInteractionAt` — timestamp of the last pointerdown that
	// landed on a Pixi-painted, eventMode='static' child (node disc,
	// pager arrow, etc). The canvas-click closeFocus handler checks
	// this to avoid firing right after a Pixi interaction (Pixi
	// paints into the canvas, so every Pixi click is also a DOM
	// click on the canvas — without this guard, clicking the pager
	// or even the focused node would close the focus).
	let pixiInteractionAt = 0;
	let dragNode: MindNode | null = null;
	let dragHover: MindNode | null = null;
	let panActive = false;
	let panStart: PixiPoint | null = null;
	// Cumulative pan distance for the in-flight gesture. The canvas-
	// click closeFocus handler uses this to distinguish "tap on empty
	// canvas" (legit close-focus intent) from "drag-pan that happened
	// to start over a focused state" — without it, panning while a
	// node is deployed always closed the deploy on pointerup.
	let panMovedDist = 0;
	let raf: number | null = null;
	let lastTick = performance.now();
	// Smooth-zoom target state. The wheel handler writes here; the
	// `tick()` loop eases the live `world.scale.x/x/y` toward the
	// targets. Without this, every wheel tick was an instant snap —
	// jarring at speed and impossible to chase visually.
	let targetScale = world.scale.x;
	let targetWorldX = world.x;
	let targetWorldY = world.y;
	// "Spotlight" keep-out zone around the focused node. While set,
	// the physics tick repels parent + sibling nodes away from the
	// post-ring so they don't cover the satellite cards. Cleared on
	// closeFocus so the original radial layout naturally restores
	// via the existing target-pull (`(a.tx - a.x) * 0.02`).
	let nudgeAwayFrom: { x: number; y: number; radius: number } | null = null;
	// Backup of the original target positions for pinned root nodes
	// before a deploy nudges them. Pinned roots ignore the physics
	// term, so we have to override their `tx`/`ty` directly. Restore
	// from this map on closeFocus.
	const pinnedTargetBackup = new Map< number, { tx: number; ty: number } >();
	// View (zoom + pan) the user was looking at right before the
	// FIRST deploy of the current focus session. Restored verbatim
	// on closeFocus so the user lands back exactly where they
	// started instead of stuck zoomed-in. Switching between focused
	// nodes (B → C while focused) does not overwrite this.
	let prevView: { scale: number; x: number; y: number } | null = null;
	// Draft state for "create new category". When set, paintSidebar
	// renders a Create/Cancel form for a NOT-YET-PERSISTED term;
	// REST is only called when the user clicks Create. Without this
	// the +Add root and +Child buttons used to POST immediately
	// with a placeholder name ("New category"), and on a tree that
	// already had a "New category" the server returned
	// `term_exists` as a hard error. The draft flow lets the user
	// fill in a unique name before any network call.
	let draft: { parent: number } | null = null;

	// Theme color for clusters.
	const themeHue = readAdminThemeHue();
	const clusterColor = ( idx: number ): number =>
		hslToInt( ( themeHue + idx * 47 ) % 360, 55, 52 );

	// --- Data fetch + initial layout ---------------------------------
	let terms: TermRow[] = [];
	try {
		const all: TermRow[] = [];
		let page = 1;
		while ( page <= 5 ) {
			const res = await fetchTerms( 'categories', { page, perPage: 100 } );
			all.push( ...res.items );
			if ( page >= res.totalPages ) {
				break;
			}
			page++;
		}
		terms = all;
	} catch ( err ) {
		showToast( __( 'Couldn’t load categories:' ), err );
	}

	const showError = ( title: string, err: unknown ): void =>
		showToast( title, err );

	function isUncategorized( term: TermRow ): boolean {
		// Server-side `desktop_mode_is_default` is the canonical
		// signal — it reads `get_option('default_category')`, which
		// works on any locale (Spanish "Sin categoría", German
		// "Allgemein", etc) regardless of slug or id. Fall back to
		// id/slug/name match for older PHP builds where the field
		// isn't registered yet.
		if ( term.isDefault ) {
			return true;
		}
		return (
			term.id === 1 ||
			term.slug === 'uncategorized' ||
			term.name.toLowerCase() === 'uncategorized'
		);
	}

	function buildTree(): void {
		// Compute target positions via radial walk; the tick loop
		// eases nodes into them so re-layout reads as smooth motion.
		const childMap = new Map< number, TermRow[] >();
		for ( const t of terms ) {
			const list = childMap.get( t.parent ) ?? [];
			list.push( t );
			childMap.set( t.parent, list );
		}
		// Uncategorized is rendered separately so it doesn't crowd the
		// main radial layout. Filter it out of the root walk; place it
		// as a free-floating island below the tree.
		const allRoots = childMap.get( 0 ) ?? [];
		const roots = allRoots.filter( ( r ) => ! isUncategorized( r ) );
		const uncategorized = allRoots.find( isUncategorized );

		const place = (
			term: TermRow,
			depth: number,
			rootIdx: number,
			angle: number,
			angleSpan: number,
		): void => {
			// Root radius. With ONE root and no centred Uncategorized,
			// sit the root at canvas centre. With MORE than one root
			// (or a centred Uncategorized hogging 0,0) distribute the
			// roots on a ring sized to the count — more roots → bigger
			// ring so nodes don't crowd each other. Children radii
			// ladder out from there at 160 px per depth so the tree
			// reads inside-out AND chips below adjacent same-row discs
			// (parent + first child sharing an angle) don't overlap
			// horizontally.
			const rootRingByCount =
				roots.length > 1 ? 110 + roots.length * 28 : 0;
			// When Uncategorized lives at the centre (its default
			// state — see placeIsolated), force a minimum root ring
			// so a single root doesn't try to share 0,0 with it.
			// 140 leaves an Uncategorized disc (max radius 48) and
			// each root disc (max radius 48) with a comfortable ~44px
			// gap, while keeping the tree visually compact — anything
			// larger spreads the branches out more than feels right.
			const rootRing = uncategorized
				? Math.max( rootRingByCount, 140 )
				: rootRingByCount;
			const baseRadius =
				depth === 0 ? rootRing : rootRing + 160 + ( depth - 1 ) * 150;
			const tx = baseRadius * Math.cos( angle );
			const ty = baseRadius * Math.sin( angle );
			const radius = nodeRadius( term.count, terms );
			const color = depth === 0
				? clusterColor( rootIdx )
				: nodes.get( term.parent )?.color ?? clusterColor( rootIdx );

			let node = nodes.get( term.id );
			if ( ! node ) {
				const gfx = new pixi.Graphics();
				gfx.eventMode = 'static';
				gfx.cursor = 'pointer';
				node = {
					id: term.id,
					parent: term.parent,
					name: term.name,
					description: term.description,
					count: term.count,
					x: tx,
					y: ty,
					tx,
					ty,
					radius,
					depth,
					color,
					gfx,
					pinned: depth === 0,
				};
				nodeLayer.addChild( gfx );
				gfx.on( 'pointerdown', ( e ) => onNodePointerDown( e, node! ) );
				// Click is detected in the stage's pointerup handler
				// (movement < 6 px, no drop target). Binding both
				// `pointertap` here AND the pointerup fallback caused
				// double-fires that toggled focus on/off in a single
				// click — that's why expansion only worked
				// sporadically.
				nodes.set( term.id, node );
			} else {
				node.parent = term.parent;
				node.name = term.name;
				node.description = term.description;
				node.count = term.count;
				node.depth = depth;
				node.color = color;
				node.radius = radius;
				node.tx = tx;
				node.ty = ty;
				node.pinned = depth === 0;
			}
			drawNodeDisc( node, false );

			const kids = childMap.get( term.id ) ?? [];
			if ( kids.length > 0 ) {
				const sub = angleSpan / kids.length;
				kids.forEach( ( child, i ) => {
					place(
						child,
						depth + 1,
						rootIdx,
						angle - angleSpan / 2 + sub * ( i + 0.5 ),
						sub * 0.85,
					);
				} );
			}
		};

		// Drop nodes whose terms disappeared.
		const liveIds = new Set( terms.map( ( t ) => t.id ) );
		for ( const [ id, node ] of nodes ) {
			if ( ! liveIds.has( id ) ) {
				nodeLayer.removeChild( node.gfx );
				node.gfx.destroy();
				nodes.delete( id );
				destroyChip( id );
			}
		}

		const rootCount = Math.max( 1, roots.length );
		roots.forEach( ( root, idx ) => {
			const angle = ( ( 2 * Math.PI ) / rootCount ) * idx;
			place( root, 0, idx, angle, ( 2 * Math.PI ) / rootCount );
		} );

		// Uncategorized as the canvas centrepiece. WordPress treats
		// it as the taxonomy's default fallback — every untagged post
		// drains into it — so visually parking it at 0,0 reads as
		// "the home base of the tree". The tree's roots already form
		// a ring around the centre (rootRing minimum is bumped to 180
		// when Uncategorized is centred so a single root doesn't try
		// to share the spot). When the user explicitly reparents
		// Uncategorized to live under another node, it falls into the
		// regular `place()` recursion and this branch never runs.
		if ( uncategorized ) {
			placeIsolated( uncategorized );
		}
	}

	function placeIsolated( term: TermRow ): void {
		const tx = 0;
		const ty = 0;
		const radius = nodeRadius( term.count, terms );
		const color = 0x8c8f94; // neutral grey — visually quiet
		let node = nodes.get( term.id );
		if ( ! node ) {
			const gfx = new pixi.Graphics();
			gfx.eventMode = 'static';
			gfx.cursor = 'pointer';
			node = {
				id: term.id,
				parent: 0,
				name: term.name,
				description: term.description,
				count: term.count,
				x: tx,
				y: ty,
				tx,
				ty,
				radius,
				depth: 0,
				color,
				gfx,
				pinned: true,
			};
			nodeLayer.addChild( gfx );
			gfx.on( 'pointerdown', ( e ) => onNodePointerDown( e, node! ) );
			// NOTE: do NOT also bind `pointertap` here. The stage's
			// pointerup handler already detects taps (movement < 2px,
			// no drop target) and calls focusNode() — binding both
			// produces a double-fire that toggles focus on/off in a
			// single click, which is exactly why clicking the
			// "Uncategorized" node appeared to do nothing.
			nodes.set( term.id, node );
		} else {
			node.parent = 0;
			node.name = term.name;
			node.description = term.description;
			node.count = term.count;
			node.depth = 0;
			node.color = color;
			node.radius = radius;
			node.tx = tx;
			node.ty = ty;
			node.pinned = true;
		}
		drawNodeDisc( node, false );
	}

	// Draw a parent→child bezier curve onto the supplied Graphics.
	// Honours `dashed` by walking the curve in 8-px segments,
	// stroking every other one — Pixi 8's stroke API doesn't have a
	// dash option, so the segmented draw is the cleanest path.
	function drawCurvedEdge(
		g: PixiGraphics,
		x1: number,
		y1: number,
		x2: number,
		y2: number,
		color: number,
		opts: {
			dashed?: boolean;
			alpha?: number;
			width?: number;
			/**
			 * Integer offset that shifts the visible/invisible
			 * pattern. Increment per frame to make dashes appear to
			 * march from (x1, y1) toward (x2, y2). Default 0 = static.
			 */
			dashPhase?: number;
			/**
			 * Group size — how many bezier samples make up one dash
			 * (visible OR invisible). 1 = fine alternating dotted
			 * line (the legacy default), 2 = chunky marching ants.
			 */
			dashStride?: number;
		} = {},
	): void {
		const dx = x2 - x1;
		const cp1x = x1 + dx * 0.5;
		const cp1y = y1;
		const cp2x = x2 - dx * 0.5;
		const cp2y = y2;
		const alpha = opts.alpha ?? 0.5;
		const width = opts.width ?? 1.5;
		if ( ! opts.dashed ) {
			g.moveTo( x1, y1 );
			g.bezierCurveTo( cp1x, cp1y, cp2x, cp2y, x2, y2 );
			g.stroke( { color, width, alpha } );
			return;
		}
		// Sample the bezier at fine intervals and draw alternating
		// segments. Step pixel-aware so dashes stay visible at any
		// zoom — sampling is in world coords, the canvas applies the
		// world transform on render.
		const sampleAt = ( t: number ): { x: number; y: number } => {
			const omt = 1 - t;
			const px =
				omt * omt * omt * x1 +
				3 * omt * omt * t * cp1x +
				3 * omt * t * t * cp2x +
				t * t * t * x2;
			const py =
				omt * omt * omt * y1 +
				3 * omt * omt * t * cp1y +
				3 * omt * t * t * cp2y +
				t * t * t * y2;
			return { x: px, y: py };
		};
		const STEPS = 32;
		const phase = opts.dashPhase ?? 0;
		const stride = Math.max( 1, opts.dashStride ?? 1 );
		let lastX = x1;
		let lastY = y1;
		for ( let i = 1; i <= STEPS; i++ ) {
			const p = sampleAt( i / STEPS );
			// Group consecutive samples by `stride`; visibility flips
			// every group. With stride=1 phase=0 this matches the old
			// "every other segment" pattern verbatim. With stride=2 +
			// a frame-incrementing phase, the visible groups march
			// along the curve — the marching-ants effect that signals
			// directional flow.
			const groupIdx = Math.floor( ( i - 1 + phase ) / stride );
			const visible = groupIdx % 2 === 0;
			if ( visible ) {
				g.moveTo( lastX, lastY );
				g.lineTo( p.x, p.y );
				g.stroke( { color, width, alpha } );
			}
			lastX = p.x;
			lastY = p.y;
		}
	}

	function drawNodeDisc( node: MindNode, highlighted: boolean ): void {
		const g = node.gfx;
		g.clear();
		const r = node.radius;
		// 1. Soft drop shadow — sells the disc as a physical object
		//    floating above the canvas. Offset down + a touch larger;
		//    keep alpha low so the shadow reads as ambient occlusion,
		//    not a heavy outline. Skipped on focus because the halo
		//    below already takes the "lifted" role.
		if ( ! highlighted ) {
			g.circle( 0, 5, r );
			g.fill( { color: 0x000000, alpha: 0.18 } );
		}
		// 2. Halo (focused only) — same as before but a bit wider so
		//    it reads through the new spherical shading.
		if ( highlighted ) {
			g.circle( 0, 0, r + 10 );
			g.fill( { color: node.color, alpha: 0.22 } );
		}
		// 3. Bottom rim — full-radius disc in a darker shade of the
		//    cluster colour. Paints first so the lighter top cap
		//    (drawn below) leaves a sliver visible at the bottom,
		//    creating the "lit-from-above sphere" reading.
		g.circle( 0, 0, r );
		g.fill( shadeColor( node.color, -0.18 ) );
		// 4. Light cap — the actual cluster colour, drawn slightly
		//    smaller and offset upward so the rim from step 3 peeks
		//    out at the bottom edge.
		g.circle( 0, -r * 0.06, r * 0.94 );
		g.fill( node.color );
		// 5. Specular highlight — a small soft white blob in the
		//    upper-left quadrant. The tiny gloss is what flips the
		//    reading from "flat dot" to "polished sphere".
		g.circle( -r * 0.32, -r * 0.42, r * 0.3 );
		g.fill( { color: 0xffffff, alpha: 0.32 } );
		// 6. White stroke around the outer edge. Re-define the disc
		//    shape so the stroke commits cleanly against the full
		//    circle (Pixi 8 strokes the most-recently-defined path).
		g.circle( 0, 0, r );
		g.stroke( {
			color: 0xffffff,
			width: highlighted ? 3 : 2,
			alignment: 0,
		} );
		g.x = node.x;
		g.y = node.y;
		g.zIndex = 10;
		// Explicit circular hit area — without it, Pixi 8 falls back
		// to the bounding box of the drawn primitives, which on a
		// Graphics with multiple layered circles + a halo is bigger
		// than the disc and not circular. Setting an exact circle
		// makes the click feel precise (you don't accidentally click
		// a node when you wanted to click empty canvas).
		g.hitArea = new pixi.Circle( 0, 0, r + 4 );
	}

	/**
	 * Decorate `hover` (the current drop target while reparenting)
	 * with a pulsing outer ring + inner accent dot. Both painted in
	 * the dragged node's cluster colour so the user reads the link
	 * "this <source family> is moving here". The pulse re-runs every
	 * frame from `tick()`, so the ring breathes for as long as the
	 * cursor stays over a valid drop target.
	 */
	function drawDropTarget( hover: MindNode, sourceColor: number ): void {
		// Standard layered disc first (clears + paints the regular
		// look), then add the drop-indicator overlay on top.
		drawNodeDisc( hover, false );
		const g = hover.gfx;
		const t = performance.now();
		// Sin-driven 0..1 oscillation — period ≈ 1.76s. Amplitude is
		// applied to both ring radius (so it visibly breathes) and
		// stroke alpha (so it brightens at peak), reinforcing the
		// "alive" reading.
		const pulse = Math.sin( t / 280 ) * 0.5 + 0.5;
		const ringR = hover.radius + 6 + pulse * 5;
		g.circle( 0, 0, ringR );
		g.stroke( {
			color: sourceColor,
			width: 3,
			alpha: 0.6 + pulse * 0.35,
		} );
		// Inner accent dot — also in source colour. Stays a constant
		// size so it doesn't fight the ring for visual emphasis.
		g.circle( 0, 0, hover.radius * 0.42 );
		g.fill( { color: sourceColor, alpha: 0.85 } );
		// Expand hit-area to match the maximum ring radius so the
		// drop target keeps catching pointer events even at the peak
		// of the pulse cycle.
		g.hitArea = new pixi.Circle( 0, 0, hover.radius + 12 );
	}

	function drawEdges(): void {
		edgeGfx.clear();
		for ( const node of nodes.values() ) {
			if ( ! node.parent ) {
				continue;
			}
			const parent = nodes.get( node.parent );
			if ( ! parent ) {
				continue;
			}
			// While the user is dragging this node, the edge to its
			// CURRENT parent gets a "dashed + faded" treatment so the
			// user sees that the connection is about to be cut. We
			// emulate dashed by walking the bezier in fixed-length
			// segments and drawing alternating chunks. Pixi 8 doesn't
			// have a native `dash` option on stroke, so we sample the
			// curve and stroke each visible segment.
			const isOldLink =
				dragNode !== null && node === dragNode;
			// Spotlight: while a node is deployed, dim every edge
			// that isn't directly attached to it. The focused node's
			// own parent edge keeps full alpha so the branch context
			// stays readable.
			const isFocusEdge =
				focusId !== null &&
				( node.id === focusId || node.parent === focusId );
			const dimMul = focusId !== null && ! isFocusEdge ? 0.35 : 1;
			drawCurvedEdge(
				edgeGfx,
				parent.x,
				parent.y,
				node.x,
				node.y,
				parent.color,
				isOldLink
					? { dashed: true, alpha: 0.28 * dimMul }
					: { alpha: 0.5 * dimMul },
			);
		}
		// Preview edge to the drop target while reparenting. Three
		// stacked layers give the line real presence:
		//   1. A wide soft glow underneath.
		//   2. A flowing dashed line on top — marching from the
		//      dragged node toward the target, so the user reads the
		//      direction of attachment.
		//   3. A small bright pulse traveling along the bezier — the
		//      "energy" cue that says "connection forming".
		if ( dragNode && dragHover ) {
			const x1 = dragNode.x;
			const y1 = dragNode.y;
			const x2 = dragHover.x;
			const y2 = dragHover.y;
			const targetColor = dragHover.color;
			// 1. Glow underlay — wide, low-alpha, solid.
			drawCurvedEdge( edgeGfx, x1, y1, x2, y2, targetColor, {
				alpha: 0.22,
				width: 9,
			} );
			// 2. Flowing dashed line. dashPhase advances ~14×/sec
			//    (every 70ms); with stride=2 that's a lively but not
			//    frantic march speed.
			const dashPhase = Math.floor( performance.now() / 70 );
			drawCurvedEdge( edgeGfx, x1, y1, x2, y2, targetColor, {
				alpha: 0.95,
				width: 2.5,
				dashed: true,
				dashStride: 2,
				dashPhase,
			} );
			// 3. Traveling pulse — 1.3-second loop along the bezier.
			//    Rendered as a small white-filled disc with the
			//    target colour as a stroke ring, so it pops on any
			//    background.
			const pt = ( performance.now() % 1300 ) / 1300;
			const omt = 1 - pt;
			const dx = x2 - x1;
			const cp1x = x1 + dx * 0.5;
			const cp1y = y1;
			const cp2x = x2 - dx * 0.5;
			const cp2y = y2;
			const px =
				omt * omt * omt * x1 +
				3 * omt * omt * pt * cp1x +
				3 * omt * pt * pt * cp2x +
				pt * pt * pt * x2;
			const py =
				omt * omt * omt * y1 +
				3 * omt * omt * pt * cp1y +
				3 * omt * pt * pt * cp2y +
				pt * pt * pt * y2;
			edgeGfx.circle( px, py, 5 );
			edgeGfx.fill( { color: 0xffffff, alpha: 0.95 } );
			edgeGfx.stroke( { color: targetColor, width: 2, alpha: 1 } );
		}
		// (drawCurvedEdge defined below)

		// Post edges — radial lines from focused node to each post.
		postEdgeGfx.clear();
		if ( focusId !== null ) {
			const center = nodes.get( focusId );
			if ( center ) {
				for ( const post of postNodes.values() ) {
					postEdgeGfx.moveTo( center.x, center.y );
					postEdgeGfx.lineTo( post.x, post.y );
					postEdgeGfx.stroke( {
						color: center.color,
						width: 1,
						alpha: 0.35,
					} );
				}
			}
		}
	}

	// --- Pixi chip renderer (in-world, scales smoothly with zoom) ----
	const FONT_FAMILY =
		'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
	// CHIP_TEXT_RES hoisted earlier so the pager (created above this
	// section) can also opt into the same rasterisation resolution.
	const CHIP_NAME_MAX_CHARS = 18;
	const POST_TITLE_MAX_CHARS = 22;

	function truncateChipName( name: string ): string {
		return name.length > CHIP_NAME_MAX_CHARS
			? name.slice( 0, CHIP_NAME_MAX_CHARS - 1 ) + '…'
			: name;
	}

	function ensureChip( node: MindNode ): CategoryChip {
		const existing = chips.get( node.id );
		if ( existing ) {
			return existing;
		}
		const container = new pixi.Container();
		container.eventMode = 'static';
		container.cursor = 'pointer';

		const bg = new pixi.Graphics();
		container.addChild( bg );

		const nameText = new pixi.Text( {
			text: truncateChipName( node.name ),
			style: {
				fill: 0x1d2327,
				fontSize: 14,
				fontFamily: FONT_FAMILY,
				fontWeight: '600',
			},
			resolution: CHIP_TEXT_RES,
		} );
		container.addChild( nameText );

		const countBg = new pixi.Graphics();
		container.addChild( countBg );

		const countText = new pixi.Text( {
			text: String( node.count ),
			style: {
				fill: 0xffffff,
				fontSize: 12,
				fontFamily: FONT_FAMILY,
				fontWeight: '700',
			},
			resolution: CHIP_TEXT_RES,
		} );
		container.addChild( countText );

		const chip: CategoryChip = {
			container,
			bg,
			nameText,
			countBg,
			countText,
			width: 0,
			height: 0,
			cachedName: '',
			cachedCount: -1,
			cachedFocused: false,
			cachedHover: false,
			cachedColor: -1,
		};
		chips.set( node.id, chip );
		chipLayer.addChild( container );

		container.on( 'pointerdown', ( e: unknown ) => {
			( e as { stopPropagation?: () => void } ).stopPropagation?.();
			pixiInteractionAt = performance.now();
		} );
		container.on( 'pointertap', () => {
			void focusNode( node.id );
		} );
		container.on( 'pointerover', () => {
			chip.cachedHover = true;
			layoutChip( chip, node );
		} );
		container.on( 'pointerout', () => {
			chip.cachedHover = false;
			layoutChip( chip, node );
		} );
		return chip;
	}

	function layoutChip( chip: CategoryChip, node: MindNode ): void {
		const focused = focusId === node.id;
		const displayName = truncateChipName( node.name );
		const countStr = String( node.count );

		// Pixi.Text re-rasterises the texture on .text assignment, so
		// only update when the string actually changed.
		if ( chip.nameText.text !== displayName ) {
			chip.nameText.text = displayName;
		}
		if ( chip.countText.text !== countStr ) {
			chip.countText.text = countStr;
		}

		chip.cachedName = displayName;
		chip.cachedCount = node.count;
		chip.cachedFocused = focused;
		chip.cachedColor = node.color;

		const padX = 9;
		const padY = 3;
		const gap = 5;
		const countPadX = 5;
		const countPadY = 2;
		const minBadgeW = 18;

		const nameW = chip.nameText.width;
		const nameH = chip.nameText.height;
		const countW = chip.countText.width;
		const countH = chip.countText.height;
		const badgeW = Math.max( minBadgeW, countW + countPadX * 2 );
		const badgeH = countH + countPadY * 2;
		const totalW = padX + nameW + gap + badgeW + padX;
		const totalH = Math.max( nameH, badgeH ) + padY * 2;
		chip.width = totalW;
		chip.height = totalH;

		// Anchor: top-center at container origin. Container.x/y is
		// then placed at the disc's bottom-center.
		const left = -totalW / 2;
		chip.bg.clear();
		chip.bg.roundRect( left, 0, totalW, totalH, totalH / 2 );
		if ( focused ) {
			chip.bg.fill( node.color );
		} else if ( chip.cachedHover ) {
			chip.bg.fill( { color: 0xffffff, alpha: 0.96 } );
			chip.bg.stroke( {
				color: node.color,
				width: 1.5,
				alpha: 1,
			} );
		} else {
			chip.bg.fill( { color: 0xffffff, alpha: 0.88 } );
			chip.bg.stroke( {
				color: 0x000000,
				width: 1,
				alpha: 0.06,
			} );
		}

		chip.nameText.x = left + padX;
		chip.nameText.y = ( totalH - nameH ) / 2;
		chip.nameText.style.fill = focused ? 0xffffff : 0x1d2327;

		const badgeX = left + padX + nameW + gap;
		const badgeY = ( totalH - badgeH ) / 2;
		chip.countBg.clear();
		chip.countBg.roundRect(
			badgeX,
			badgeY,
			badgeW,
			badgeH,
			badgeH / 2,
		);
		chip.countBg.fill(
			focused ? { color: 0xffffff, alpha: 0.25 } : node.color,
		);

		chip.countText.x = badgeX + ( badgeW - countW ) / 2;
		chip.countText.y = badgeY + ( badgeH - countH ) / 2;
	}

	function destroyChip( id: number ): void {
		const chip = chips.get( id );
		if ( ! chip ) {
			return;
		}
		chipLayer.removeChild( chip.container );
		chip.container.destroy( { children: true } );
		chips.delete( id );
	}

	// Per-frame pass: prune dead chips, position live ones, dim the
	// unfocused branches when a node is deployed (the "spotlight"
	// effect), and trigger a relayout if any cached state diverged
	// from the node (count update, focus toggle, color cluster shift).
	function syncChipPositions(): void {
		const activeIds = new Set( nodes.keys() );
		for ( const id of [ ...chips.keys() ] ) {
			if ( ! activeIds.has( id ) ) {
				destroyChip( id );
			}
		}
		// Chips counter-scale exactly 1/world.scale so their on-screen
		// size stays constant at any zoom level — the text is always
		// readable whether the user has zoomed all the way out to see
		// the whole tree or all the way in on a single branch. Same
		// pattern as Miro/Figma/JamBoard for node labels: spatial info
		// (positions, sizes of discs/edges) scales with the world,
		// textual info (names, counts, post titles) does not.
		const chipCounterScale = 1 / Math.max( 0.01, world.scale.x );
		const anyFocus = focusId !== null;
		for ( const node of nodes.values() ) {
			const chip = ensureChip( node );
			chip.container.x = node.x;
			chip.container.y = node.y + node.radius + 6;
			chip.container.scale.set( chipCounterScale );
			const focused = focusId === node.id;
			// Spotlight dim — non-focused category chips AND their
			// discs ease toward alpha 0.4 while a node is deployed,
			// restoring to 1 when focus is cleared. The focused
			// branch stays vivid (chip + disc + post chips + post
			// edges = the actual "spotlit" subject).
			const targetAlpha = ! anyFocus || focused ? 1 : 0.4;
			if ( Math.abs( chip.container.alpha - targetAlpha ) > 0.005 ) {
				chip.container.alpha +=
					( targetAlpha - chip.container.alpha ) * 0.18;
			} else {
				chip.container.alpha = targetAlpha;
			}
			if ( Math.abs( node.gfx.alpha - targetAlpha ) > 0.005 ) {
				node.gfx.alpha +=
					( targetAlpha - node.gfx.alpha ) * 0.18;
			} else {
				node.gfx.alpha = targetAlpha;
			}
			const displayName = truncateChipName( node.name );
			if (
				chip.cachedName !== displayName ||
				chip.cachedCount !== node.count ||
				chip.cachedFocused !== focused ||
				chip.cachedColor !== node.color
			) {
				layoutChip( chip, node );
			}
		}
		for ( const post of postNodes.values() ) {
			const chip = postChips.get( post.id );
			if ( ! chip ) {
				continue;
			}
			chip.container.x = post.x;
			chip.container.y = post.y;
			chip.container.scale.set( chipCounterScale );
			// Entrance fade: chip is created at alpha=0, eased toward 1.
			if ( chip.container.alpha < 1 ) {
				chip.container.alpha = Math.min(
					1,
					chip.container.alpha + 0.18,
				);
			}
		}
	}

	// --- Force simulation --------------------------------------------
	// Pure physics step — no painting, no smooth-zoom, no rAF. Used
	// both by the main `tick()` loop AND by the pre-settle warmup
	// during bootstrap (`preSettlePhysics()`), so nodes converge to
	// their steady-state before the canvas becomes visible. Without
	// the pre-settle, the user briefly sees nodes drift a few pixels
	// during the opacity fade-in as physics catches up to the
	// initial radial layout.
	function physicsStep( dt: number ): void {
		const list = Array.from( nodes.values() );
		for ( const a of list ) {
			if ( a.pinned ) {
				a.x += ( a.tx - a.x ) * 0.12;
				a.y += ( a.ty - a.y ) * 0.12;
				a.gfx.x = a.x;
				a.gfx.y = a.y;
				continue;
			}
			let fx = 0;
			let fy = 0;
			for ( const b of list ) {
				if ( a === b ) {
					continue;
				}
				const dx = a.x - b.x;
				const dy = a.y - b.y;
				const d2 = dx * dx + dy * dy + 1;
				const f = REPULSION_K / d2;
				const d = Math.sqrt( d2 );
				fx += ( dx / d ) * f;
				fy += ( dy / d ) * f;
			}
			const parent = nodes.get( a.parent );
			if ( parent ) {
				const dx = parent.x - a.x;
				const dy = parent.y - a.y;
				const d = Math.sqrt( dx * dx + dy * dy ) || 1;
				const stretch = d - SPRING_LEN;
				fx += ( ( dx / d ) * stretch ) * SPRING_K;
				fy += ( ( dy / d ) * stretch ) * SPRING_K;
			} else {
				fx += -a.x * 0.0008;
				fy += -a.y * 0.0008;
			}
			// Spotlight nudge: when a node is deployed, push every
			// non-focused free node out of the post-ring keep-out
			// zone so satellite cards aren't covered by sibling
			// discs. Applied as a strong outward impulse the moment
			// the node is inside the zone; outside, no contribution
			// (so nodes don't drift further than necessary).
			if ( nudgeAwayFrom && a.id !== focusId ) {
				const ndx = a.x - nudgeAwayFrom.x;
				const ndy = a.y - nudgeAwayFrom.y;
				const nd = Math.sqrt( ndx * ndx + ndy * ndy ) || 1;
				const limit = nudgeAwayFrom.radius + a.radius;
				if ( nd < limit ) {
					const pushK = 18; // strong enough to clear the zone in a few frames
					fx += ( ndx / nd ) * pushK * ( limit - nd );
					fy += ( ndy / nd ) * pushK * ( limit - nd );
				}
			}
			if ( a !== dragNode ) {
				// Two-component motion: physics force (repulsion +
				// spring) eased over `dt`, blended with a gentle pull
				// toward the radial-layout target (`a.tx, a.ty`). The
				// target pull keeps nodes near their assigned slot
				// when no force is acting; the physics term lets
				// siblings settle without overlapping when a fresh
				// node is added or a reparent changes the tree.
				a.x += fx * dt * 0.001 + ( a.tx - a.x ) * 0.02;
				a.y += fy * dt * 0.001 + ( a.ty - a.y ) * 0.02;
			}
			a.gfx.x = a.x;
			a.gfx.y = a.y;
		}
	}

	function preSettlePhysics( iterations: number ): void {
		// Synchronous warmup loop. Stage is still hidden (opacity:0
		// via .is-loading) when this runs, so the visual cost of
		// repeated stepping is zero. Constant `dt` makes the result
		// deterministic across machines.
		for ( let i = 0; i < iterations; i++ ) {
			physicsStep( 16 );
		}
		// Snap radial-layout targets to wherever physics ended up.
		// The live tick has a (tx - x) * 0.02 pull that would
		// otherwise drag every node back toward the un-settled
		// radial slot the moment the canvas becomes visible — exactly
		// the "fraction of a pixel shift" the user kept seeing.
		// Subsequent buildTree() calls (after reparent / add / delete)
		// reset tx/ty back to a fresh radial layout, so this only
		// locks in the first-mount equilibrium.
		for ( const n of nodes.values() ) {
			n.tx = n.x;
			n.ty = n.y;
		}
	}

	function tick(): void {
		const now = performance.now();
		const dt = Math.min( 50, now - lastTick );
		lastTick = now;
		// Smooth-zoom easing. k≈0.22 settles in ~3-4 frames at 60fps,
		// reading as a quick (~150ms) ease without feeling sluggish on
		// rapid scroll. Skipping the assignments when already at the
		// target avoids floating-point drift over long idle periods.
		const ZOOM_EASE = 0.22;
		const ds = targetScale - world.scale.x;
		const dwx = targetWorldX - world.x;
		const dwy = targetWorldY - world.y;
		if (
			Math.abs( ds ) > 0.0005 ||
			Math.abs( dwx ) > 0.5 ||
			Math.abs( dwy ) > 0.5
		) {
			world.scale.set( world.scale.x + ds * ZOOM_EASE );
			world.x += dwx * ZOOM_EASE;
			world.y += dwy * ZOOM_EASE;
		}
		physicsStep( dt );
		// Ease post mini-nodes toward their target ring positions.
		for ( const p of postNodes.values() ) {
			p.x += ( p.tx - p.x ) * 0.18;
			p.y += ( p.ty - p.y ) * 0.18;
			p.gfx.x = p.x;
			p.gfx.y = p.y;
		}
		drawEdges();
		// Pulse the drop-target ring every frame while a drag is
		// over a valid target. drawDropTarget redraws the disc + the
		// breathing ring; without this re-call the ring would stay
		// frozen at whatever phase it was in when pointermove last
		// fired.
		if ( dragNode && dragHover ) {
			drawDropTarget( dragHover, dragNode.color );
		}
		syncChipPositions();
		raf = requestAnimationFrame( tick );
	}

	// --- Drag --------------------------------------------------------
	let dragStartPos: PixiPoint | null = null;
	let dragOffset: PixiPoint = { x: 0, y: 0 };
	function onNodePointerDown( e: unknown, node: MindNode ): void {
		const ev = e as { global: PixiPoint; stopPropagation?: () => void };
		ev.stopPropagation?.();
		// Mark a Pixi-handled interaction so the canvas-click handler
		// that fires after pointerup won't close the focus.
		pixiInteractionAt = performance.now();
		dragNode = node;
		node.pinned = true;
		node.tx = node.x;
		node.ty = node.y;
		dragStartPos = { x: ev.global.x, y: ev.global.y };
		// Preserve the offset between the cursor and the node's
		// centre at pointerdown — so a click on the disc's edge
		// drags the disc with the cursor staying on that same
		// edge, instead of the disc snapping its centre to the
		// cursor.
		const local = stageToWorld( { x: ev.global.x, y: ev.global.y } );
		dragOffset = { x: node.x - local.x, y: node.y - local.y };
	}

	function stageToWorld( global: PixiPoint ): PixiPoint {
		return {
			x: ( global.x - world.x ) / world.scale.x,
			y: ( global.y - world.y ) / world.scale.y,
		};
	}

	function onStagePointerDown( e: unknown ): void {
		const ev = e as { global: PixiPoint };
		panActive = true;
		panStart = { x: ev.global.x, y: ev.global.y };
		panMovedDist = 0;
	}

	function onStagePointerMove( e: unknown ): void {
		const ev = e as { global: PixiPoint };
		if ( dragNode ) {
			const cursorWorld = stageToWorld( ev.global );
			const nx = cursorWorld.x + dragOffset.x;
			const ny = cursorWorld.y + dragOffset.y;
			dragNode.x = nx;
			dragNode.y = ny;
			dragNode.tx = nx;
			dragNode.ty = ny;
			dragNode.gfx.x = nx;
			dragNode.gfx.y = ny;
			// Hover detection — the CURSOR's position (not the node's
			// recomputed-with-offset centre) is what matters: drop
			// where the user pointed, not where the disc visually sits.
			let hover: MindNode | null = null;
			for ( const c of nodes.values() ) {
				if ( c === dragNode ) {
					continue;
				}
				const dx = c.x - cursorWorld.x;
				const dy = c.y - cursorWorld.y;
				if ( dx * dx + dy * dy < c.radius * c.radius ) {
					hover = c;
					break;
				}
			}
			if ( hover !== dragHover ) {
				if ( dragHover ) {
					drawNodeDisc( dragHover, focusId === dragHover.id );
				}
				dragHover = hover;
				if ( hover && dragNode ) {
					drawDropTarget( hover, dragNode.color );
				}
			}
			return;
		}
		if ( panActive && panStart ) {
			const dx = ev.global.x - panStart.x;
			const dy = ev.global.y - panStart.y;
			world.x += dx;
			world.y += dy;
			// Pan also moves the desired target world position so the
			// smooth-zoom easing in `tick()` doesn't yank the world
			// back to a stale target after the pan.
			targetWorldX += dx;
			targetWorldY += dy;
			panMovedDist += Math.sqrt( dx * dx + dy * dy );
			panStart = { x: ev.global.x, y: ev.global.y };
		}
	}

	async function onStagePointerUp( e?: unknown ): Promise< void > {
		if ( dragNode ) {
			const node = dragNode;
			const target = dragHover;
			const startPos = dragStartPos;
			dragNode = null;
			dragHover = null;
			dragStartPos = null;
			node.pinned = node.depth === 0;
			// "Click" (essentially no movement, no drop target) →
			// open the editor for this node. The threshold is
			// deliberately tight (≤2 px) so a real drag — even a
			// short one — never gets misread as a tap and trigger
			// a posts fetch via focusNode(). The HTML chip below
			// each disc handles deliberate clicks separately.
			let movement = Infinity;
			const ev = e as { global?: PixiPoint } | undefined;
			if ( startPos && ev && ev.global ) {
				const dx = ev.global.x - startPos.x;
				const dy = ev.global.y - startPos.y;
				movement = Math.sqrt( dx * dx + dy * dy );
			}
			if ( ! target && movement < 2 ) {
				focusNode( node.id );
				panActive = false;
				panStart = null;
				return;
			}
			// Cycle prevention: a reparent makes `node.parent = target`,
			// so the only configuration that creates a cycle is when
			// `target` is currently a descendant of `node` —
			// equivalently, when `node` is an ancestor of `target`.
			// Blocking on the inverse (target being an ancestor of
			// node) is wrong: that's a legitimate skip-level move
			// the user can't otherwise express. Example: in
			// A > B > C, dragging C onto A correctly removes the
			// intermediate B and re-parents C directly under A.
			if (
				target &&
				target.id !== node.parent &&
				! isAncestor( node.id, target.id )
			) {
				try {
					await updateTerm( 'categories', node.id, {
						parent: target.id,
					} );
					node.parent = target.id;
					terms = terms.map( ( t ) =>
						t.id === node.id ? { ...t, parent: target.id } : t,
					);
					buildTree();
				} catch ( err ) {
					showError( __( 'Reparent failed:' ), err );
				}
			} else {
				drawNodeDisc( node, focusId === node.id );
				if ( target ) {
					drawNodeDisc( target, focusId === target.id );
				}
			}
		}
		panActive = false;
		panStart = null;
		// Note: deliberately NOT resetting panMovedDist here. The DOM
		// `click` event fires AFTER pointerup, so the click handler
		// needs to read the final pan distance to decide whether to
		// close focus. We reset it on the next pointerdown instead.
	}

	app.stage.eventMode = 'static';
	app.stage.hitArea = new pixi.Rectangle(
		0,
		0,
		stage.clientWidth,
		stage.clientHeight,
	);
	app.stage.on( 'pointerdown', onStagePointerDown );
	app.stage.on( 'pointermove', onStagePointerMove );
	app.stage.on( 'pointerup', ( e ) => void onStagePointerUp( e ) );
	app.stage.on( 'pointerupoutside', ( e ) => void onStagePointerUp( e ) );

	// --- Wheel zoom --------------------------------------------------
	// Zoom anchored at the cursor: keep the world point currently
	// under the mouse stationary while changing scale. Without this
	// the user sees the focused area drift toward (0,0) on every
	// scroll wheel tick.
	function onWheel( e: WheelEvent ): void {
		e.preventDefault();
		// Exponential zoom — multiplier scales smoothly with the
		// wheel delta. Two reasons for the curve over a flat 1.1× /
		// 0.9×:
		//   1. Trackpads emit MANY small-deltaY events per gesture
		//      (often ~3-15 units), so a flat 10% per event made
		//      every flick of the trackpad feel like a 50%+ jump.
		//   2. Mouse wheels emit fewer larger-deltaY events (~100
		//      units per detent), so the same multiplier worked
		//      fine — but tuning for either device alone hurt the
		//      other.
		// `Math.exp( -delta * k )` self-adapts: 100-unit detent
		// → ~1.083× (8.3%, softer than the old 1.1×); 10-unit
		// trackpad nudge → ~1.008× (barely a frame). Cumulative
		// gestures still reach the full zoom range (0.3–2.5×) — they
		// just take more events to get there, which IS the
		// "smoother" the user asked for.
		const SENSITIVITY = 0.0008;
		const factor = Math.exp( -e.deltaY * SENSITIVITY );
		const prev = targetScale;
		const next = Math.max( 0.3, Math.min( 2.5, prev * factor ) );
		if ( Math.abs( next - prev ) < 0.0005 ) {
			return;
		}
		const r = stage.getBoundingClientRect();
		const sx = e.clientX - r.left;
		const sy = e.clientY - r.top;
		// Cursor-anchored zoom: the world point currently under the
		// cursor at the TARGET scale should land back under the
		// cursor at the new target scale. Using `targetWorldX/Y`
		// here keeps the anchor stable across rapid wheel ticks.
		const wx = ( sx - targetWorldX ) / prev;
		const wy = ( sy - targetWorldY ) / prev;
		targetScale = next;
		targetWorldX = sx - wx * next;
		targetWorldY = sy - wy * next;
	}
	// Bind wheel on the STAGE div, not the canvas — the HTML overlay
	// (labels, post chips) sits on top of the canvas, so a wheel
	// event over a label never reaches the canvas's listener. The
	// stage is a common ancestor of both, so the wheel bubbles up to
	// it whether the cursor is over the canvas or any overlay child.
	stage.addEventListener( 'wheel', onWheel, { passive: false } );

	// --- Resize ------------------------------------------------------
	// Preserve the user's pan/zoom across resizes — only the renderer
	// pixel buffer needs to grow/shrink. Resetting `world.x/y` to the
	// new center on every resize was a real bug: focusNode() repaints
	// the sidebar, which sub-pixel-reflows the parent flexbox, which
	// fires ResizeObserver, which would rip the world back to center
	// on every node click.
	//
	// The FIRST resize callback also doubles as our "stage is laid
	// out" signal: we defer the first fitToView + reveal until then,
	// so we frame the graph against the final stable canvas size,
	// not the pre-flexbox-resolution size that an rAF would catch.
	let firstFitDone = false;
	// Single mechanism for "refit when the canvas actually changes
	// size". We watch the stage; on every observed change we reset
	// an 80ms debounce; when dimensions go quiet we refit IF the
	// cumulative delta since the last settled state exceeds
	// SETTLE_THRESHOLD_PX. That filter is the whole trick:
	//   - Maximize / restore / fullscreen / browser resize / snap
	//     zones all move the stage by hundreds of pixels → fit.
	//   - Drag-resize handle (continuous storm of fires while the
	//     pointer is held) → debounce extends until release → fit.
	//   - Sidebar repaints from focusing a node cause sub-pixel
	//     reflows of 0–2px → below threshold → ignored.
	// No hook subscriptions, no payload filtering, no per-cause
	// branching. The DOM is the source of truth — whatever caused
	// the size change, the observer sees it.
	let settledW = 0;
	let settledH = 0;
	const SETTLE_THRESHOLD_PX = 24;
	const SETTLE_DEBOUNCE_MS = 80;
	let settleTimer: number | null = null;
	function onResize(): void {
		const r = stage.getBoundingClientRect();
		app.renderer.resize( r.width, r.height );
		app.stage.hitArea = new pixi.Rectangle( 0, 0, r.width, r.height );
		if ( ! firstFitDone && r.width > 0 && r.height > 0 ) {
			firstFitDone = true;
			settledW = r.width;
			settledH = r.height;
			fitToView();
			stage.classList.remove( 'is-loading' );
		}
		if ( settleTimer !== null ) {
			window.clearTimeout( settleTimer );
		}
		settleTimer = window.setTimeout( () => {
			settleTimer = null;
			const cur = stage.getBoundingClientRect();
			const dw = Math.abs( cur.width - settledW );
			const dh = Math.abs( cur.height - settledH );
			if (
				dw >= SETTLE_THRESHOLD_PX ||
				dh >= SETTLE_THRESHOLD_PX
			) {
				settledW = cur.width;
				settledH = cur.height;
				recenterCamera();
			}
		}, SETTLE_DEBOUNCE_MS );
		// Force an immediate render so the freshly-resized canvas
		// has pixels in it RIGHT NOW. Without this Pixi waits for
		// the next ticker frame, and a continuous window-resize
		// gesture (where the resize event fires far more often than
		// 60Hz) leaves the canvas momentarily blank between frames.
		app.render();
	}
	const ro = new ResizeObserver( onResize );
	ro.observe( stage );

	// --- Helpers -----------------------------------------------------
	function isAncestor( ancestor: number, descendant: number ): boolean {
		let cur = nodes.get( descendant );
		let safety = 32;
		while ( cur && safety-- > 0 ) {
			if ( cur.id === ancestor ) {
				return true;
			}
			if ( ! cur.parent ) {
				return false;
			}
			cur = nodes.get( cur.parent );
		}
		return false;
	}

	// --- Focus + posts -----------------------------------------------
	let lastFocusChange = 0;
	// Total radius of the spotlight keep-out zone around the focused
	// node — the post ring lives at POST_RING_RADIUS, plus a generous
	// buffer so neighboring discs sit clearly outside the satellite
	// cards instead of kissing them.
	// Keep-out radius is the post ring + room for the pager (which
	// sits ~60 below the ring) + a bit of breathing room so the
	// pager arrows don't kiss the next-door disc. Bumped from +60
	// to +130 because user reported the pager overlapping siblings
	// at the bottom of the spotlight.
	const SPOTLIGHT_RADIUS = POST_RING_RADIUS + 130;

	async function focusNode( id: number ): Promise< void > {
		// Toggle off if clicking the already-focused node.
		if ( focusId === id ) {
			closeFocus();
			return;
		}
		const wasFocused = focusId !== null;
		focusId = id;
		focusPage = 1;
		lastFocusChange = performance.now();
		// Spotlight: arm the physics nudge so neighboring discs slide
		// outward to clear the post ring. Chip/edge dimming for
		// unfocused branches happens in syncChipPositions / drawEdges
		// via Pixi alpha — the host class hooks are gone since we
		// dropped the HTML overlay.
		const focused = nodes.get( id );
		if ( focused ) {
			// Save the user's pre-deploy view so closeFocus can
			// restore it. Only on the FIRST focus of the session —
			// switching between nodes (B → C while focused) keeps
			// the original "before any deploy" view as the restore
			// target.
			if ( ! wasFocused ) {
				prevView = {
					scale: targetScale,
					x: targetWorldX,
					y: targetWorldY,
				};
			}
			// Camera framing: ease the world so the focused node +
			// its post ring are centered AND fully visible. The
			// existing tick easing animates the transition; we just
			// write the new target. Half-size accounts for the post
			// ring radius plus the post chip text that hangs below.
			const r = stage.getBoundingClientRect();
			if ( r.width > 0 && r.height > 0 ) {
				const half = POST_RING_RADIUS + 70;
				const sx = ( r.width * 0.85 ) / ( 2 * half );
				const sy = ( r.height * 0.85 ) / ( 2 * half );
				const newScale = Math.max(
					0.5,
					Math.min( 1.6, Math.min( sx, sy ) ),
				);
				targetScale = newScale;
				targetWorldX = r.width / 2 - focused.x * newScale;
				targetWorldY = r.height / 2 - focused.y * newScale;
			}
			nudgeAwayFrom = {
				x: focused.x,
				y: focused.y,
				radius: SPOTLIGHT_RADIUS,
			};
			// Pinned roots normally ignore the physics impulse — back
			// up their target so we can shove them outward and
			// restore on closeFocus.
			pinnedTargetBackup.clear();
			for ( const n of nodes.values() ) {
				if ( n.id === id || ! n.pinned ) {
					continue;
				}
				const dx = n.x - focused.x;
				const dy = n.y - focused.y;
				const d = Math.sqrt( dx * dx + dy * dy ) || 1;
				if ( d >= SPOTLIGHT_RADIUS + n.radius ) {
					continue;
				}
				pinnedTargetBackup.set( n.id, { tx: n.tx, ty: n.ty } );
				const push = SPOTLIGHT_RADIUS + n.radius + 20;
				n.tx = focused.x + ( dx / d ) * push;
				n.ty = focused.y + ( dy / d ) * push;
			}
		}
		// Repaint discs to update the highlighted ring.
		for ( const n of nodes.values() ) {
			drawNodeDisc( n, focusId === n.id );
		}
		paintSidebar();
		await loadPostsForFocus();
	}

	function closeFocus(): void {
		focusId = null;
		lastFocusChange = performance.now();
		// Invalidate any in-flight post-load — without bumping here,
		// a slow response from the just-closed focus could land and
		// re-render satellites for the now-cleared focusId.
		loadSeq++;
		// Lift the spotlight + restore pinned-root targets. The
		// physics tick's existing target-pull eases the nudged free
		// nodes back to their radial slots automatically. Chip alpha
		// restoration happens automatically in syncChipPositions
		// once focusId flips back to null.
		nudgeAwayFrom = null;
		for ( const [ id, t ] of pinnedTargetBackup ) {
			const n = nodes.get( id );
			if ( n ) {
				n.tx = t.tx;
				n.ty = t.ty;
			}
		}
		pinnedTargetBackup.clear();
		// Restore the pre-deploy camera view so the user lands back
		// where they were instead of stuck zoomed-in on the closed
		// node. The existing tick easing animates the unzoom.
		if ( prevView ) {
			targetScale = prevView.scale;
			targetWorldX = prevView.x;
			targetWorldY = prevView.y;
			prevView = null;
		}
		paintSidebar();
		clearPosts();
		for ( const n of nodes.values() ) {
			drawNodeDisc( n, false );
		}
	}

	function clearPosts(): void {
		for ( const post of postNodes.values() ) {
			postLayer.removeChild( post.gfx );
			post.gfx.destroy();
		}
		postNodes.clear();
		for ( const chip of postChips.values() ) {
			postChipLayer.removeChild( chip.container );
			chip.container.destroy( { children: true } );
		}
		postChips.clear();
		postEdgeGfx.clear();
		// Pager belongs to the post fan — hide it whenever the fan is
		// cleared so it doesn't linger over a now-empty viewport.
		pager.visible = false;
	}

	function ensurePostChip( post: PostMini ): PostChip {
		const existing = postChips.get( post.id );
		if ( existing ) {
			return existing;
		}
		const container = new pixi.Container();
		container.eventMode = 'static';
		container.cursor = 'pointer';
		// Start invisible — `syncChipPositions` eases alpha toward 1
		// each frame so the post fan reads as fading in along with
		// the radial position animation.
		container.alpha = 0;

		const bg = new pixi.Graphics();
		container.addChild( bg );

		const dot = new pixi.Graphics();
		container.addChild( dot );

		const titleText = new pixi.Text( {
			text: post.title,
			style: {
				fill: 0x1d2327,
				// Matches category chip fontSize so the two read at
				// the same weight when both are deployed. Base size
				// is the on-screen size since the post chip's
				// container counter-scales with `1/world.scale.x`
				// in `syncChipPositions`.
				fontSize: 14,
				fontFamily: FONT_FAMILY,
				fontWeight: '500',
			},
			resolution: CHIP_TEXT_RES,
		} );
		container.addChild( titleText );

		const chip: PostChip = {
			container,
			bg,
			dot,
			titleText,
			width: 0,
			height: 0,
			cachedTitle: '',
			cachedHover: false,
		};
		postChips.set( post.id, chip );
		postChipLayer.addChild( container );

		container.on( 'pointerdown', ( e: unknown ) => {
			( e as { stopPropagation?: () => void } ).stopPropagation?.();
			pixiInteractionAt = performance.now();
		} );
		container.on( 'pointertap', () => {
			// Open the post in a new shell window AND exit focus
			// mode in the same gesture. Without the closeFocus the
			// canvas stays zoomed in on the focused node — when the
			// user finishes editing and returns to the Posts window
			// they can't see the rest of the tree until they manually
			// click empty canvas. Closing focus here turns "click a
			// satellite post" into a clean transition: open the post,
			// release the camera back to the full tree view.
			openInPostsTab( post.id, post.editUrl, post.title );
			closeFocus();
		} );
		container.on( 'pointerover', () => {
			chip.cachedHover = true;
			layoutPostChip( chip, post );
		} );
		container.on( 'pointerout', () => {
			chip.cachedHover = false;
			layoutPostChip( chip, post );
		} );
		layoutPostChip( chip, post );
		return chip;
	}

	function layoutPostChip( chip: PostChip, post: PostMini ): void {
		const displayTitle =
			post.title.length > POST_TITLE_MAX_CHARS
				? post.title.slice( 0, POST_TITLE_MAX_CHARS - 1 ) + '…'
				: post.title;
		if ( chip.titleText.text !== displayTitle ) {
			chip.titleText.text = displayTitle;
		}
		chip.cachedTitle = displayTitle;

		const padX = 9;
		const padY = 3;
		const dotR = 4;
		const gap = 6;
		const titleW = chip.titleText.width;
		const titleH = chip.titleText.height;
		const totalW = padX + dotR * 2 + gap + titleW + padX;
		const totalH = Math.max( titleH, dotR * 2 ) + padY * 2;
		chip.width = totalW;
		chip.height = totalH;

		// Center anchor — container.x/y is the chip's geometric
		// center, so the rounded rect spans (-W/2, -H/2) to (W/2, H/2).
		const left = -totalW / 2;
		const top = -totalH / 2;
		chip.bg.clear();
		chip.bg.roundRect( left, top, totalW, totalH, totalH / 2 );
		if ( chip.cachedHover ) {
			chip.bg.fill( { color: 0xffffff, alpha: 1 } );
			chip.bg.stroke( {
				color: post.tone,
				width: 1.5,
				alpha: 1,
			} );
		} else {
			chip.bg.fill( { color: 0xffffff, alpha: 0.95 } );
			chip.bg.stroke( {
				color: 0x000000,
				width: 1,
				alpha: 0.12,
			} );
		}

		chip.dot.clear();
		chip.dot.circle( left + padX + dotR, 0, dotR );
		chip.dot.fill( { color: post.tone, alpha: 0.85 } );
		chip.dot.stroke( { color: 0xffffff, width: 1 } );

		chip.titleText.x = left + padX + dotR * 2 + gap;
		chip.titleText.y = -titleH / 2;
	}

	// Per-(termId, page) cache for the satellite post fan. First click
	// on a node fetches; subsequent clicks within POSTS_CACHE_TTL_MS
	// re-render from cache with no network round-trip — paging back
	// and forth between two nodes feels instant. TTL guards against
	// staleness if the user leaves the window open for a while; on
	// expiry the next click re-fetches.
	interface PostsCacheEntry {
		items: Array< { id: number; title: string; editUrl: string } >;
		totalPages: number;
		realTotal: number;
		fetchedAt: number;
	}
	const POSTS_CACHE_TTL_MS = 60_000;
	const postsCache = new Map< string, PostsCacheEntry >();

	function applyPostsResult(
		entry: PostsCacheEntry,
		focusedNodeId: number,
	): void {
		focusTotalPages = entry.totalPages;
		// Reconcile the node's count against the authoritative
		// X-WP-Total even on cache hits — the cached value reflects
		// what the server said at fetch time, which is the most
		// reliable signal we have for the badge.
		if ( Number.isFinite( entry.realTotal ) ) {
			const node = nodes.get( focusedNodeId );
			if ( node && node.count !== entry.realTotal ) {
				node.count = entry.realTotal;
				terms = terms.map( ( t ) =>
					t.id === node.id
						? { ...t, count: entry.realTotal }
						: t,
				);
				layoutChip( ensureChip( node ), node );
			}
		}
		renderPosts( entry.items );
	}

	async function loadPostsForFocus(): Promise< void > {
		if ( focusId === null ) {
			return;
		}
		// Capture the seq for this fetch. Any focus change or new
		// pagination call bumps the seq; we drop the response if ours
		// is no longer current.
		const mySeq = ++loadSeq;
		const myFocusId = focusId;
		const cacheKey = `${ focusId }:${ focusPage }`;
		const cached = postsCache.get( cacheKey );
		if ( cached && performance.now() - cached.fetchedAt < POSTS_CACHE_TTL_MS ) {
			applyPostsResult( cached, myFocusId );
			return;
		}
		const cfg = getConfig();
		const url = new URL( cfg.postsUrl );
		url.searchParams.set( 'categories', String( focusId ) );
		url.searchParams.set( 'per_page', String( POST_PER_PAGE ) );
		url.searchParams.set( 'page', String( focusPage ) );
		url.searchParams.set( 'status', 'any' );
		url.searchParams.set( '_fields', 'id,title,status' );
		try {
			const response = await fetchShellJson( url.toString() );
			if ( mySeq !== loadSeq || focusId !== myFocusId ) {
				return;
			}
			const raw = ( response.json as Array< {
				id: number;
				title?: { rendered?: string };
			} > ) ?? [];
			const totalPages = Math.max(
				1,
				parseInt( response.headers.get( 'X-WP-TotalPages' ) ?? '1', 10 ) || 1,
			);
			// X-WP-Total is the AUTHORITATIVE count from core's posts
			// query (the same query the table view runs). When the
			// term's pre-aggregated `count` is stale or wrong (the
			// REST term endpoint sometimes lags drafts/pending under
			// custom-status setups), this is the number the user
			// expects to see on the node label.
			const realTotalParsed =
				parseInt( response.headers.get( 'X-WP-Total' ) ?? '', 10 );
			const realTotal = Number.isFinite( realTotalParsed )
				? realTotalParsed
				: -1;
			const items = raw.map( ( p ) => ( {
				id: p.id,
				title: stripTags( p.title?.rendered || `#${ p.id }` ),
				editUrl: `${ cfg.editPostUrlBase }?post=${ p.id }&action=edit`,
			} ) );
			const entry: PostsCacheEntry = {
				items,
				totalPages,
				realTotal,
				fetchedAt: performance.now(),
			};
			postsCache.set( cacheKey, entry );
			applyPostsResult( entry, myFocusId );
		} catch ( err ) {
			showError( __( 'Couldn’t load posts:' ), err );
		}
	}

	function renderPosts(
		items: Array< { id: number; title: string; editUrl: string } >,
	): void {
		clearPosts();
		if ( focusId === null ) {
			return;
		}
		const center = nodes.get( focusId );
		if ( ! center ) {
			return;
		}
		const count = items.length;
		const ringR = POST_RING_RADIUS + Math.max( 0, count - 8 ) * 6;
		items.forEach( ( item, idx ) => {
			const angle = ( ( 2 * Math.PI ) / Math.max( 1, count ) ) * idx - Math.PI / 2;
			const tx = center.x + Math.cos( angle ) * ringR;
			const ty = center.y + Math.sin( angle ) * ringR;
			const tone = center.color;
			// `gfx` is kept on PostMini for compatibility with the
			// post-edge drawing code (which only reads x/y), but it's
			// now an empty Graphics — the chip itself is the visual.
			// Without it the type would diverge; refactoring PostMini
			// to drop gfx is a wider change than this commit warrants.
			const gfx = new pixi.Graphics();
			postLayer.addChild( gfx );
			const post: PostMini = {
				id: item.id,
				title: item.title,
				editUrl: item.editUrl,
				angle,
				r: ringR,
				x: center.x,
				y: center.y,
				tx,
				ty,
				gfx,
				tone,
			};
			postNodes.set( item.id, post );
			ensurePostChip( post );
		} );
		repaintPager();
	}

	function repaintPager(): void {
		if ( focusId === null || focusTotalPages <= 1 ) {
			pager.visible = false;
			return;
		}
		pager.visible = true;
		const center = nodes.get( focusId );
		if ( ! center ) {
			pager.visible = false;
			return;
		}
		const prevDisabled = focusPage <= 1;
		const nextDisabled = focusPage >= focusTotalPages;
		drawPagerButton( pagerPrev, '◀', prevDisabled );
		drawPagerButton( pagerNext, '▶', nextDisabled );
		pagerPrev.cursor = prevDisabled ? 'default' : 'pointer';
		pagerNext.cursor = nextDisabled ? 'default' : 'pointer';
		pagerLabel.text = `${ focusPage } / ${ focusTotalPages }`;
		// Layout: prev (-36, 0) — label (0, 0) — next (+36, 0).
		pagerPrev.x = -38;
		pagerPrev.y = 0;
		pagerNext.x = 38;
		pagerNext.y = 0;
		pagerLabel.x = 0;
		pagerLabel.y = 0;
		// Anchor below the satellite ring of the focused node.
		pager.x = center.x;
		pager.y = center.y + POST_RING_RADIUS + 60;
	}

	function drawPagerButton(
		gfx: PixiGraphics,
		glyph: string,
		disabled: boolean,
	): void {
		gfx.clear();
		gfx.circle( 0, 0, 14 );
		gfx.fill( {
			color: disabled ? 0xf2f2f2 : 0xffffff,
			alpha: disabled ? 0.7 : 1,
		} );
		gfx.stroke( {
			color: 0x000000,
			width: 1,
			alpha: 0.12,
		} );
		// Reuse a single Text child per button — recreate text only if
		// missing or glyph changed (keeps the GPU-cached glyph stable).
		const children = ( gfx as unknown as { children?: PixiContainer[] } )
			.children;
		const label = ( children?.[ 0 ] as PixiText | undefined ) ?? null;
		if ( ! label ) {
			const t = new pixi.Text( {
				text: glyph,
				style: {
					fill: disabled ? 0xb0b3b8 : 0x50575e,
					fontSize: 16,
					fontFamily:
						'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
					fontWeight: '600',
				},
				resolution: CHIP_TEXT_RES,
			} );
			t.anchor.set( 0.5 );
			gfx.addChild( t );
		} else {
			label.text = glyph;
			label.style.fill = disabled ? 0xb0b3b8 : 0x50575e;
		}
	}

	function openInPostsTab( _id: number, editUrl: string, title?: string ): void {
		// Open the post in a chromeless iframe window via the shell's
		// window manager — same path the posts-table title links use
		// (see `openAdminUrl` in posts-window/index.ts). Falls back to
		// `window.open` only if the shell APIs aren't reachable, which
		// is virtually never since the mindmap is mounted by the same
		// shell that exposes them.
		const wm = api?.windowManager;
		const derive = api?.deriveWindowId;
		// If the Posts window is currently in fullscreen ("focus")
		// mode, the new post window opens with a normal z-index and
		// is hidden behind the fullscreen z-stack — the user clicks
		// a post and nothing visibly happens. Exit fullscreen first
		// so the freshly-opened window lands somewhere visible.
		const postsWin =
			wm && typeof ( wm as { getById?: ( id: string ) => unknown } ).getById === 'function'
				? ( wm as { getById: ( id: string ) => { isFullscreen?: () => boolean; toggleFullscreen?: () => void } | undefined } )
					.getById( 'desktop-mode-posts' )
				: undefined;
		if (
			postsWin &&
			typeof postsWin.isFullscreen === 'function' &&
			typeof postsWin.toggleFullscreen === 'function' &&
			postsWin.isFullscreen()
		) {
			postsWin.toggleFullscreen();
		}
		if ( wm && typeof derive === 'function' ) {
			const id = derive( editUrl );
			wm.open( {
				id,
				baseId: id,
				url: editUrl,
				title: title ?? editUrl,
				icon: 'dashicons-admin-post',
			} );
			return;
		}
		try {
			window.open( editUrl, '_blank' );
		} catch {
			window.location.assign( editUrl );
		}
	}

	// --- Sidebar editor -----------------------------------------------
	function paintDraftSidebar( d: { parent: number } ): void {
		const parentNode = d.parent !== 0 ? nodes.get( d.parent ) : null;

		const header = document.createElement( 'div' );
		header.className = 'wpd-mindmap__sidebar-header';
		const dot = document.createElement( 'span' );
		dot.className = 'wpd-mindmap__sidebar-dot';
		// Draft uses the parent's cluster color when nesting, so the
		// header dot matches the branch the new term will join.
		const color = parentNode
			? parentNode.color
			: clusterColor( terms.length );
		dot.style.background = `#${ color
			.toString( 16 )
			.padStart( 6, '0' ) }`;
		const label = document.createElement( 'code' );
		label.className = 'wpd-mindmap__sidebar-slug';
		label.textContent = parentNode
			? sprintf(
				/* translators: %s: parent category name. */
				__( 'New child of %s' ),
				parentNode.name,
			)
			: __( 'New root category' );
		header.appendChild( dot );
		header.appendChild( label );
		sidebar.appendChild( header );

		const nameLabel = document.createElement( 'label' );
		nameLabel.className = 'wpd-mindmap__sidebar-label';
		nameLabel.textContent = __( 'Name' );
		sidebar.appendChild( nameLabel );
		const nameInput = document.createElement( 'input' );
		nameInput.type = 'text';
		nameInput.className = 'wpd-mindmap__editor-name';
		nameInput.placeholder = __( 'e.g. Recipes' );
		sidebar.appendChild( nameInput );
		// Auto-focus the name field — Create is gated on a non-empty
		// name, so dropping the cursor straight in saves a click.
		requestAnimationFrame( () => nameInput.focus() );

		const slugLabel = document.createElement( 'label' );
		slugLabel.className = 'wpd-mindmap__sidebar-label';
		slugLabel.textContent = __( 'Slug' );
		sidebar.appendChild( slugLabel );
		const slugInput = document.createElement( 'input' );
		slugInput.type = 'text';
		slugInput.className = 'wpd-mindmap__editor-name';
		slugInput.placeholder = __( 'auto-from-name' );
		slugInput.spellcheck = false;
		slugInput.autocapitalize = 'off';
		slugInput.addEventListener( 'input', () => {
			const v = slugInput.value;
			const norm = v.toLowerCase().replace( /[^a-z0-9-]+/g, '-' );
			if ( v !== norm ) {
				const sel = slugInput.selectionStart ?? norm.length;
				slugInput.value = norm;
				slugInput.setSelectionRange( sel, sel );
			}
		} );
		sidebar.appendChild( slugInput );

		const descLabel = document.createElement( 'label' );
		descLabel.className = 'wpd-mindmap__sidebar-label';
		descLabel.textContent = __( 'Description' );
		sidebar.appendChild( descLabel );
		const descInput = document.createElement( 'textarea' );
		descInput.className = 'wpd-mindmap__editor-desc';
		descInput.placeholder = __( 'Description (optional)' );
		descInput.rows = 4;
		sidebar.appendChild( descInput );

		const actions = document.createElement( 'div' );
		actions.className = 'wpd-mindmap__editor-actions';

		const createBtn = document.createElement( 'button' );
		createBtn.type = 'button';
		createBtn.className = 'wpd-mindmap__btn wpd-mindmap__btn--primary';
		createBtn.textContent = __( 'Create' );

		const cancelBtn = document.createElement( 'button' );
		cancelBtn.type = 'button';
		// Reuse the danger style so the dual-action row reads
		// symmetrically with the regular editor's Save / Delete pair —
		// "secondary" looked muted next to the prominent Create.
		cancelBtn.className = 'wpd-mindmap__btn wpd-mindmap__btn--danger';
		cancelBtn.textContent = __( 'Cancel' );

		const handleCreate = async (): Promise< void > => {
			const name = nameInput.value.trim();
			if ( ! name ) {
				nameInput.focus();
				return;
			}
			createBtn.disabled = true;
			try {
				const created = await createCategory( name, d.parent, {
					slug: slugInput.value.trim() || undefined,
					description: descInput.value || undefined,
				} );
				const next: TermRow = {
					id: created.id,
					name: created.name,
					slug:
						( created as unknown as { slug?: string } ).slug ||
						'',
					parent: created.parent,
					count: 0,
					description:
						( created as unknown as { description?: string } )
							.description || '',
					isDefault: false,
				};
				// De-dupe in case the server returned an existing term
				// (createCategory falls back to the existing match on
				// term_exists). Without this the local terms list ends
				// up with a duplicate of an existing entry.
				if ( ! terms.some( ( t ) => t.id === next.id ) ) {
					terms = terms.concat( next );
				}
				draft = null;
				buildTree();
				focusId = created.id;
				paintSidebar();
				await loadPostsForFocus();
			} catch ( err ) {
				createBtn.disabled = false;
				showError( __( 'Couldn’t create:' ), err );
			}
		};

		createBtn.addEventListener( 'click', () => {
			void handleCreate();
		} );
		cancelBtn.addEventListener( 'click', () => {
			draft = null;
			paintSidebar();
		} );
		// Enter from the name field commits; Escape cancels. Both
		// match the muscle memory of every other "new item" form in
		// wp-admin.
		nameInput.addEventListener( 'keydown', ( e ) => {
			if ( e.key === 'Enter' ) {
				e.preventDefault();
				void handleCreate();
			} else if ( e.key === 'Escape' ) {
				draft = null;
				paintSidebar();
			}
		} );

		actions.appendChild( createBtn );
		actions.appendChild( cancelBtn );
		sidebar.appendChild( actions );
	}

	// The sidebar is a fixed right-side column that always shows
	// one of three states: the draft form for a not-yet-saved new
	// category, the editor form for the currently focused node, or
	// an empty-state hint when nothing is focused. Replaces the
	// floating editor popover that hid the post fan when both were
	// open.
	function paintSidebar(): void {
		sidebar.replaceChildren();
		if ( draft !== null ) {
			paintDraftSidebar( draft );
			return;
		}
		if ( focusId === null ) {
			const empty = document.createElement( 'div' );
			empty.className = 'wpd-mindmap__sidebar-empty';
			const icon = document.createElement( 'span' );
			icon.className = 'dashicons dashicons-admin-tools';
			icon.setAttribute( 'aria-hidden', 'true' );
			empty.appendChild( icon );
			const title = document.createElement( 'h3' );
			title.textContent = __( 'No category selected' );
			empty.appendChild( title );
			const help = document.createElement( 'p' );
			help.textContent = __(
				'Click a node on the mindmap to edit its name, description, and posts.',
			);
			empty.appendChild( help );
			sidebar.appendChild( empty );
			return;
		}
		const node = nodes.get( focusId );
		if ( ! node ) {
			focusId = null;
			paintSidebar();
			return;
		}
		const id = node.id;

		const header = document.createElement( 'div' );
		header.className = 'wpd-mindmap__sidebar-header';
		const dot = document.createElement( 'span' );
		dot.className = 'wpd-mindmap__sidebar-dot';
		dot.style.background = `#${ node.color
			.toString( 16 )
			.padStart( 6, '0' ) }`;
		const term = terms.find( ( t ) => t.id === id );
		const idLabel = document.createElement( 'code' );
		idLabel.className = 'wpd-mindmap__sidebar-slug';
		idLabel.textContent = `#${ id }`;
		header.appendChild( dot );
		header.appendChild( idLabel );
		sidebar.appendChild( header );

		const nameLabel = document.createElement( 'label' );
		nameLabel.className = 'wpd-mindmap__sidebar-label';
		nameLabel.textContent = __( 'Name' );
		sidebar.appendChild( nameLabel );
		const nameInput = document.createElement( 'input' );
		nameInput.type = 'text';
		nameInput.className = 'wpd-mindmap__editor-name';
		nameInput.value = node.name;
		nameInput.placeholder = __( 'Name' );
		sidebar.appendChild( nameInput );

		const slugLabel = document.createElement( 'label' );
		slugLabel.className = 'wpd-mindmap__sidebar-label';
		slugLabel.textContent = __( 'Slug' );
		sidebar.appendChild( slugLabel );
		const slugInput = document.createElement( 'input' );
		slugInput.type = 'text';
		slugInput.className = 'wpd-mindmap__editor-name';
		slugInput.value = term?.slug || '';
		slugInput.placeholder = __( 'auto-from-name' );
		slugInput.spellcheck = false;
		// `autocapitalize="off"` + lowercase enforcement on input keeps
		// the slug shape sane on iOS / Android keyboards which would
		// otherwise capitalize the first character.
		slugInput.autocapitalize = 'off';
		slugInput.addEventListener( 'input', () => {
			// WP normalises slugs server-side, but eager normalisation
			// gives the user immediate feedback that the slug is what
			// will actually be saved.
			const v = slugInput.value;
			const norm = v.toLowerCase().replace( /[^a-z0-9-]+/g, '-' );
			if ( v !== norm ) {
				const sel = slugInput.selectionStart ?? norm.length;
				slugInput.value = norm;
				slugInput.setSelectionRange( sel, sel );
			}
		} );
		sidebar.appendChild( slugInput );

		const descLabel = document.createElement( 'label' );
		descLabel.className = 'wpd-mindmap__sidebar-label';
		descLabel.textContent = __( 'Description' );
		sidebar.appendChild( descLabel );
		const descInput = document.createElement( 'textarea' );
		descInput.className = 'wpd-mindmap__editor-desc';
		descInput.value = node.description || '';
		descInput.placeholder = __( 'Description (optional)' );
		descInput.rows = 4;
		sidebar.appendChild( descInput );

		const meta = document.createElement( 'p' );
		meta.className = 'wpd-mindmap__sidebar-meta';
		meta.textContent = sprintf(
			/* translators: %d: post count. */
			__( '%d posts in this category.' ),
			node.count,
		);
		sidebar.appendChild( meta );

		const actions = document.createElement( 'div' );
		actions.className = 'wpd-mindmap__editor-actions';

		const addChildBtn = document.createElement( 'button' );
		addChildBtn.type = 'button';
		addChildBtn.className = 'wpd-mindmap__btn wpd-mindmap__btn--secondary';
		addChildBtn.textContent = __( '+ Child' );
		addChildBtn.addEventListener( 'click', () => {
			startDraft( id );
		} );

		// Make-root: only meaningful when this node has a parent. Drag-
		// and-drop reparents within the tree, but there's no drop
		// target for "no parent" — this button is the only path to
		// promote a deep child into a top-level cluster.
		const makeRootBtn = node.parent && node.parent !== 0
			? document.createElement( 'button' )
			: null;
		if ( makeRootBtn ) {
			makeRootBtn.type = 'button';
			makeRootBtn.className = 'wpd-mindmap__btn wpd-mindmap__btn--secondary';
			makeRootBtn.textContent = __( 'Make root' );
			makeRootBtn.title = __(
				'Promote this category to a top-level root (no parent).',
			);
			makeRootBtn.addEventListener( 'click', async () => {
				try {
					await updateTerm( 'categories', node.id, { parent: 0 } );
					node.parent = 0;
					terms = terms.map( ( t ) =>
						t.id === node.id ? { ...t, parent: 0 } : t,
					);
					buildTree();
					paintSidebar();
				} catch ( err ) {
					showError( __( 'Couldn’t reparent:' ), err );
				}
			} );
		}

		const saveBtn = document.createElement( 'button' );
		saveBtn.type = 'button';
		saveBtn.className = 'wpd-mindmap__btn wpd-mindmap__btn--primary';
		saveBtn.textContent = __( 'Save' );
		saveBtn.addEventListener( 'click', async () => {
			const name = nameInput.value.trim();
			if ( ! name ) {
				return;
			}
			const description = descInput.value;
			const slugRaw = slugInput.value.trim();
			const currentSlug = term?.slug ?? '';
			if (
				name === node.name &&
				description === ( node.description || '' ) &&
				slugRaw === currentSlug
			) {
				return;
			}
			// Empty slug → let WP regenerate from name. Send an empty
			// string explicitly so the server's slug-derivation kicks
			// in instead of holding the old slug.
			const patch: {
				name: string;
				description: string;
				slug?: string;
			} = { name, description };
			if ( slugRaw !== currentSlug ) {
				patch.slug = slugRaw;
			}
			try {
				const updated = await updateTerm(
					'categories',
					node.id,
					patch,
				);
				node.name = updated.name;
				node.description = updated.description;
				terms = terms.map( ( t ) =>
					t.id === node.id
						? {
							...t,
							name: updated.name,
							description: updated.description,
							slug: updated.slug ?? t.slug,
						}
						: t,
				);
				layoutChip( ensureChip( node ), node );
				paintSidebar();
			} catch ( err ) {
				showError( __( 'Couldn’t save:' ), err );
			}
		} );

		const delBtn = document.createElement( 'button' );
		delBtn.type = 'button';
		delBtn.className = 'wpd-mindmap__btn wpd-mindmap__btn--danger';
		delBtn.textContent = __( 'Delete' );
		let armResetTimer: number | null = null;
		const armDelete = (): void => {
			delBtn.textContent = __( 'Click again to delete' );
			delBtn.classList.add( 'is-armed' );
			if ( armResetTimer !== null ) {
				window.clearTimeout( armResetTimer );
			}
			armResetTimer = window.setTimeout( () => {
				delBtn.textContent = __( 'Delete' );
				delBtn.classList.remove( 'is-armed' );
				armResetTimer = null;
			}, 2500 );
		};
		delBtn.addEventListener( 'click', async () => {
			if ( ! delBtn.classList.contains( 'is-armed' ) ) {
				armDelete();
				return;
			}
			if ( armResetTimer !== null ) {
				window.clearTimeout( armResetTimer );
				armResetTimer = null;
			}
			try {
				await deleteTerm( 'categories', node.id );
				terms = terms.filter( ( t ) => t.id !== node.id );
				focusId = null;
				clearPosts();
				buildTree();
				paintSidebar();
			} catch ( err ) {
				showError( __( 'Couldn’t delete:' ), err );
			}
		} );

		actions.appendChild( addChildBtn );
		if ( makeRootBtn ) {
			actions.appendChild( makeRootBtn );
		}
		actions.appendChild( saveBtn );
		actions.appendChild( delBtn );
		sidebar.appendChild( actions );
	}

	function startDraft( parent: number ): void {
		// "Create new term" is now a sidebar-driven flow — we set a
		// draft and paint the form. No REST call until the user fills
		// in a name and clicks Create. This replaced the old
		// "POST 'New category' immediately" path that failed hard
		// when a term named "New category" already existed in the
		// tree (term_exists from core).
		if ( parent !== 0 && ! nodes.get( parent ) ) {
			return;
		}
		draft = { parent };
		paintSidebar();
	}

	addRootBtn.addEventListener( 'click', () => {
		startDraft( 0 );
	} );

	function fitToView( opts: { padding?: number; animate?: boolean } = {} ): void {
		// Bounding box of every node's TARGET position (not current —
		// the user might trigger fit while nodes are mid-ease).
		// We extend the bbox vertically to include the label row that
		// sits below each disc, so labels don't get clipped at the
		// canvas edge after fit.
		const padding = opts.padding ?? 90;
		const animate = opts.animate ?? false;
		const r = stage.getBoundingClientRect();
		if ( nodes.size === 0 || r.width === 0 || r.height === 0 ) {
			const cx = r.width / 2;
			const cy = r.height / 2;
			targetScale = 1;
			targetWorldX = cx;
			targetWorldY = cy;
			if ( ! animate ) {
				world.x = cx;
				world.y = cy;
				world.scale.set( 1 );
			}
			return;
		}
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		// Label row visually extends ~30 world-units below the disc
		// (label height + gap, in world coords at scale 1). Used to
		// pad the bottom of the bbox so labels stay on-screen.
		const LABEL_OVERHANG = 30;
		for ( const n of nodes.values() ) {
			const rad = n.radius;
			minX = Math.min( minX, n.tx - rad );
			minY = Math.min( minY, n.ty - rad );
			maxX = Math.max( maxX, n.tx + rad );
			maxY = Math.max( maxY, n.ty + rad + LABEL_OVERHANG );
		}
		const w = Math.max( 1, maxX - minX );
		const h = Math.max( 1, maxY - minY );
		const sx = ( r.width - padding * 2 ) / w;
		const sy = ( r.height - padding * 2 ) / h;
		// Pick the smaller of the two so the bbox fully fits both
		// axes. Cap zoom-IN at 1.5x (tiny graphs shouldn't balloon),
		// but allow zoom-OUT all the way to 0.2x so a 200-node tree
		// stays inside the canvas instead of overflowing.
		const scale = Math.max( 0.2, Math.min( 1.5, Math.min( sx, sy ) ) );
		const cx = ( minX + maxX ) / 2;
		const cy = ( minY + maxY ) / 2;
		// Always update the targets — the tick() loop's smooth-zoom
		// easing reads from these every frame. When `animate` is
		// false (first-mount snap, internal callers that need an
		// instant fit), we ALSO write the live world transform so
		// nothing visibly moves; when `animate` is true, only the
		// targets change and the per-frame ease in tick() interpolates
		// the world toward them over ~5-6 frames (~80-100ms).
		const newWorldX = r.width / 2 - cx * scale;
		const newWorldY = r.height / 2 - cy * scale;
		targetScale = scale;
		targetWorldX = newWorldX;
		targetWorldY = newWorldY;
		if ( ! animate ) {
			world.scale.set( scale );
			world.x = newWorldX;
			world.y = newWorldY;
		}
	}

	/**
	 * Recompute the camera framing for the current state. Focus-aware:
	 * if a node is focused, frames the focused node + its post fan
	 * (the same calc focusNode uses); otherwise frames the whole
	 * tree. Always animates — meant for after-the-fact recenter
	 * triggers (resize-end, recenter button) where snapping would
	 * feel jarring.
	 */
	function recenterCamera(): void {
		if ( focusId !== null ) {
			const focused = nodes.get( focusId );
			const r = stage.getBoundingClientRect();
			if ( focused && r.width > 0 && r.height > 0 ) {
				const half = POST_RING_RADIUS + 70;
				const sx = ( r.width * 0.85 ) / ( 2 * half );
				const sy = ( r.height * 0.85 ) / ( 2 * half );
				const newScale = Math.max(
					0.5,
					Math.min( 1.6, Math.min( sx, sy ) ),
				);
				targetScale = newScale;
				targetWorldX = r.width / 2 - focused.x * newScale;
				targetWorldY = r.height / 2 - focused.y * newScale;
				return;
			}
		}
		fitToView( { animate: true } );
	}

	recenterBtn.addEventListener( 'click', () => recenterCamera() );

	// Click empty canvas → close focus. Pixi paints into the canvas,
	// so a click on the focused node, a satellite, the pager arrows,
	// or any other Pixi-rendered control ALSO fires a DOM `click` on
	// the canvas. Without a guard, every such click closes the focus.
	//
	// `pixiInteractionAt` is bumped every time a Pixi child handles a
	// `pointerdown` (focused node, drag, pager). The DOM click that
	// follows checks this timestamp and bails if a Pixi interaction
	// just happened. lastFocusChange catches the focus-toggle case.
	app.canvas.addEventListener( 'click', ( e ) => {
		const now = performance.now();
		if ( now - lastFocusChange < 250 || now - pixiInteractionAt < 250 ) {
			return;
		}
		// A pan with any meaningful movement should NEVER count as
		// "click empty canvas → close focus". Without this guard,
		// dragging the canvas to scroll around while a node is
		// deployed would close the deploy on pointerup.
		if ( panMovedDist > 4 ) {
			return;
		}
		const target = e.target;
		if ( target === app.canvas && ! dragNode && focusId !== null ) {
			closeFocus();
		}
	} );

	async function refreshCountsViaBulk(): Promise< void > {
		// Defensive fallback — hit the plugin's bulk-count endpoint
		// to get an authoritative count per term. The
		// `desktop_mode_count` REST field is the primary source but
		// some hosts strip it (caching, custom REST handlers); the
		// bulk endpoint runs a single GROUP BY query and never
		// returns stale data.
		if ( terms.length === 0 ) {
			return;
		}
		const cfg = getConfig();
		const url = new URL(
			`${ cfg.restRoot.replace( /\/$/, '' ) }/desktop-mode/v1/term-counts`,
		);
		url.searchParams.set( 'taxonomy', 'category' );
		url.searchParams.set(
			'ids',
			terms.map( ( t ) => t.id ).join( ',' ),
		);
		try {
			const response = await fetchShellJson( url.toString() );
			const map = response.json as Record< string, number >;
			let dirty = false;
			terms = terms.map( ( t ) => {
				const fresh = map[ String( t.id ) ];
				if ( typeof fresh === 'number' && fresh !== t.count ) {
					dirty = true;
					const node = nodes.get( t.id );
					if ( node ) {
						node.count = fresh;
						layoutChip( ensureChip( node ), node );
					}
					return { ...t, count: fresh };
				}
				return t;
			} );
			// Bigger / smaller bubbles after a count update — radii
			// are derived from `Math.sqrt( count / max )`, so any
			// change ripples through every node's radius. Rebuild the
			// tree to refresh radii + label-row positions, then
			// animate the camera to the new framing.
			if ( dirty ) {
				buildTree();
				fitToView( { animate: true } );
			}
		} catch {
			// Silent — we already have whatever count the term-list
			// REST returned. The bulk endpoint is just a backup.
		}
	}

	// --- Bootstrap ---------------------------------------------------
	buildTree();
	// Render the empty-state sidebar immediately so the right pane
	// reads as intentional from the very first frame instead of
	// flashing in once the user clicks something.
	paintSidebar();
	// Pre-settle the force simulation while the stage is still
	// hidden (opacity:0). Free nodes start at their radial-target
	// positions but the spring + repulsion forces want to nudge them
	// a few pixels — without this, the user saw that nudge as a
	// visible shift during the fade-in. 80 iterations is more than
	// enough to converge for the tree sizes we see in the wild.
	preSettlePhysics( 80 );
	// First fitToView + stage reveal happen inside `onResize` once
	// the stage reports a non-zero size. This guarantees we frame
	// against the final laid-out canvas dimensions, not whatever
	// half-resolved size an early rAF would see.
	raf = requestAnimationFrame( tick );
	// Authoritative counts via the bulk endpoint. Runs in the
	// background; the tree is interactive immediately.
	void refreshCountsViaBulk();

	// Empty-state hint when no categories exist (besides the default).
	if ( terms.length <= 1 ) {
		const empty = document.createElement( 'div' );
		empty.className = 'wpd-mindmap__empty';
		empty.textContent = __(
			'No custom categories yet. Click "Add root category" to start branching.',
		);
		stage.appendChild( empty );
	}

	// --- Teardown -----------------------------------------------------
	return () => {
		if ( raf !== null ) {
			cancelAnimationFrame( raf );
			raf = null;
		}
		if ( settleTimer !== null ) {
			window.clearTimeout( settleTimer );
			settleTimer = null;
		}
		ro.disconnect();
		stage.removeEventListener( 'wheel', onWheel );
		try {
			app.destroy( true, { children: true, texture: true } );
		} catch {
			// pixi 8 destroy quirks; ignore.
		}
		host.replaceChildren();
		host.classList.remove( 'wpd-mindmap' );
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nodeRadius( count: number, all: TermRow[] ): number {
	const max = Math.max( 1, ...all.map( ( t ) => t.count ) );
	const ratio = Math.sqrt( count / max );
	return MIN_RADIUS + ( MAX_RADIUS - MIN_RADIUS ) * ratio;
}

function readAdminThemeHue(): number {
	try {
		const value = getComputedStyle( document.documentElement )
			.getPropertyValue( '--wp-admin-theme-color' )
			.trim();
		if ( ! value ) {
			return 210;
		}
		const c = document.createElement( 'span' );
		c.style.color = value;
		document.body.appendChild( c );
		const rgb = getComputedStyle( c ).color;
		c.remove();
		const m = rgb.match( /\d+/g );
		if ( ! m || m.length < 3 ) {
			return 210;
		}
		return rgbToHue(
			parseInt( m[ 0 ], 10 ),
			parseInt( m[ 1 ], 10 ),
			parseInt( m[ 2 ], 10 ),
		);
	} catch {
		return 210;
	}
}

function rgbToHue( r: number, g: number, b: number ): number {
	const rn = r / 255;
	const gn = g / 255;
	const bn = b / 255;
	const max = Math.max( rn, gn, bn );
	const min = Math.min( rn, gn, bn );
	const d = max - min;
	if ( d === 0 ) {
		return 210;
	}
	let h: number;
	switch ( max ) {
		case rn:
			h = ( gn - bn ) / d + ( gn < bn ? 6 : 0 );
			break;
		case gn:
			h = ( bn - rn ) / d + 2;
			break;
		default:
			h = ( rn - gn ) / d + 4;
			break;
	}
	return Math.round( h * 60 );
}

function hslToInt( h: number, s: number, l: number ): number {
	const sn = s / 100;
	const ln = l / 100;
	const c = ( 1 - Math.abs( 2 * ln - 1 ) ) * sn;
	const hp = h / 60;
	const x = c * ( 1 - Math.abs( ( hp % 2 ) - 1 ) );
	let r = 0;
	let g = 0;
	let b = 0;
	if ( hp < 1 ) {
		r = c;
		g = x;
	} else if ( hp < 2 ) {
		r = x;
		g = c;
	} else if ( hp < 3 ) {
		g = c;
		b = x;
	} else if ( hp < 4 ) {
		g = x;
		b = c;
	} else if ( hp < 5 ) {
		r = x;
		b = c;
	} else {
		r = c;
		b = x;
	}
	const m = ln - c / 2;
	const ri = Math.round( ( r + m ) * 255 );
	const gi = Math.round( ( g + m ) * 255 );
	const bi = Math.round( ( b + m ) * 255 );
	return ri * 0x10000 + gi * 0x100 + bi;
}

/**
 * Lighten or darken a 0xRRGGBB colour. `delta` in (-1, +1):
 * negative darkens (multiplies each channel toward 0), positive
 * lightens (interpolates each channel toward 255). Used by the disc
 * renderer to produce the bottom rim (-0.18) without a separate
 * Pixi gradient texture.
 *
 * No bitwise ops — the project's lint rule bans `>>` / `&` / `|`,
 * so channel extraction goes through Math.floor + modulo.
 */
function shadeColor( color: number, delta: number ): number {
	const r = Math.floor( color / 0x10000 ) % 256;
	const g = Math.floor( color / 0x100 ) % 256;
	const b = color % 256;
	const adj = ( ch: number ): number => {
		if ( delta >= 0 ) {
			return Math.round( ch + ( 255 - ch ) * delta );
		}
		return Math.round( ch * ( 1 + delta ) );
	};
	return adj( r ) * 0x10000 + adj( g ) * 0x100 + adj( b );
}

function stripTags( html: string ): string {
	const tmp = document.createElement( 'div' );
	tmp.innerHTML = html;
	return tmp.textContent || tmp.innerText || '';
}

function showToast( title: string, err: unknown ): void {
	const reason = err instanceof Error ? err.message : String( err );
	const api = window.wp?.desktop;
	if ( api && typeof api.showToast === 'function' ) {
		api.showToast( {
			message: `${ title } ${ reason }`.trim(),
			duration: 6000,
		} );
		return;
	}
	// eslint-disable-next-line no-console
	console.error( title, err );
}

interface ShellJsonResponse {
	json: unknown;
	headers: Headers;
}

async function fetchShellJson( url: string ): Promise< ShellJsonResponse > {
	const cfg = getConfig();
	const api = window.wp?.desktop;
	const init: RequestInit = {
		method: 'GET',
		credentials: 'same-origin',
		headers: {
			'X-WP-Nonce': cfg.restNonce,
			Accept: 'application/json',
		},
	};
	let response: Response;
	if ( api && typeof api.fetch === 'function' ) {
		response = await api.fetch( url, init, {
			windowId: 'desktop-mode-posts',
		} );
	} else {
		response = await fetch( url, init );
	}
	if ( ! response.ok ) {
		throw new Error( `${ response.status } ${ response.statusText }` );
	}
	const json = await response.json();
	return { json, headers: response.headers };
}
