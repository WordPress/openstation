/**
 * Pixi-driven tag cloud for the Tags tab.
 *
 * Tags are flat — no hierarchy, no parent/child edges — so the right
 * metaphor isn't a tree of circles (the Categories mindmap), it's a
 * sticker wall. Each tag is a hashtag-style pill chip; size encodes
 * post count (the classic "tag cloud" convention); a stable per-slug
 * hue plus a tiny rotation give the wall its hand-arranged texture.
 *
 * Render: pure Pixi inside a single world container, identical pan +
 * zoom + counter-scaled chip text pattern as the Categories mindmap so
 * the two tabs feel like the same surface. Layout is a deterministic
 * Archimedean spiral pack, sorted by count descending — popular tags
 * land at canvas centre, the long tail flows outward.
 *
 * Interactions:
 *   - **Click** a chip → focus: camera eases in, other chips dim +
 *     push outward to clear the spotlight, posts fan radially from the
 *     focused chip (10 per page, ←/→ paginate), sidebar shows the
 *     name/slug/description editor.
 *   - **Drag** a chip → reposition (visual only — tags carry no
 *     hierarchy to update). Position persists per-site to localStorage.
 *   - **Drag** empty canvas → pan; **wheel** → cursor-anchored zoom.
 *   - **+ Add tag** → opens a draft form in the sidebar; nothing hits
 *     REST until the user fills in a name and clicks Create.
 *   - **Click empty space** → close the focused chip + post fan.
 *
 * @public
 * @since 0.16.0
 */

import { __, sprintf } from '../i18n';
import { joinRestUrl } from '../rest-url';
import { trackedFetch } from '../tracked-fetch';
import {
	type PostsWindowClient,
	type TermNeighbor,
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
	rotation: number;
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
	lineTo( x: number, y: number ): PixiGraphics;
	stroke( style: { color: number; width: number; alpha?: number } ): PixiGraphics;
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
	style: {
		fill: number;
		fontSize?: number;
		fontFamily?: string;
		fontWeight?: string;
	};
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

interface TagChip {
	container: PixiContainer;
	shadow: PixiGraphics;
	bg: PixiGraphics;
	hashText: PixiText;
	nameText: PixiText;
	countText: PixiText;
	width: number;
	height: number;
	cachedName: string;
	cachedCount: number;
	cachedFocused: boolean;
	cachedHover: boolean;
	cachedHue: number;
}

interface TagBox {
	id: number;
	name: string;
	slug: string;
	description: string;
	count: number;
	hue: number;
	rotation: number;
	fontSize: number;
	x: number;
	y: number;
	tx: number;
	ty: number;
	width: number;
	height: number;
	chip: TagChip;
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

interface PostMini {
	id: number;
	title: string;
	editUrl: string;
	angle: number;
	r: number;
	x: number;
	y: number;
	tx: number;
	ty: number;
	gfx: PixiGraphics;
	tone: number;
}

const POST_PER_PAGE = 10;
const POST_RING_RADIUS = 170;
const MIN_FONT_SIZE = 11;
const MAX_FONT_SIZE = 28;
const FONT_FAMILY =
	'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
// Text resolution — 3× rasterises glyphs at 3× detail so the chip text
// stays crisp through the world's full zoom range (capped at 2.5×).
const CHIP_TEXT_RES = 3;
const CHIP_NAME_MAX_CHARS = 22;
const POST_TITLE_MAX_CHARS = 22;
// Padding inside the chip bg around the text content.
const CHIP_PAD_X = 11;
const CHIP_PAD_Y = 6;
// Gap between the # glyph and the tag name, and between name and count.
const CHIP_GAP_HASH = 4;
const CHIP_GAP_COUNT = 8;
// Spiral-pack: extra padding around each chip's AABB so they don't
// kiss. ~12px reads as a hand-arranged sticker wall, not a brick.
const SPIRAL_PADDING = 14;
// Spotlight keep-out radius around the focused chip — pushes other
// chips outward so the satellite post-ring (POST_RING_RADIUS) plus
// pager (~60px below) stay clear.
const SPOTLIGHT_RADIUS = POST_RING_RADIUS + 130;

/**
 * Mount the tag cloud inside `host`. Self-fetches the full tag list on
 * first mount; subsequent renames/creates/deletes are pushed through
 * REST and reflected locally. Returns a teardown that destroys the
 * WebGL context + sidebar overlays.
 *
 * @param host Empty container element. Existing children are removed.
 * @return Async teardown function.
 */
export async function mountTagsCloud(
	host: HTMLElement,
	client: PostsWindowClient,
): Promise< () => void > {
	const api = window.wp?.desktop;
	if ( ! api || typeof api.loadModules !== 'function' ) {
		host.textContent = __( 'Tag cloud unavailable: shell modules API missing.' );
		return () => {};
	}
	try {
		await api.loadModules( [ 'pixijs' ] );
	} catch {
		host.textContent = __( 'Tag cloud unavailable.' );
		return () => {};
	}
	const pixiMaybe = ( window as unknown as { PIXI?: PixiNamespace } ).PIXI;
	if ( ! pixiMaybe ) {
		host.textContent = __( 'Tag cloud unavailable.' );
		return () => {};
	}
	const pixi: PixiNamespace = pixiMaybe;

	host.replaceChildren();
	host.classList.add( 'wpd-tagcloud' );

	// --- Toolbar -------------------------------------------------------
	const toolbar = document.createElement( 'div' );
	toolbar.className = 'wpd-tagcloud__toolbar';
	const addTagBtn = document.createElement( 'button' );
	addTagBtn.type = 'button';
	addTagBtn.className = 'wpd-tagcloud__btn wpd-tagcloud__btn--primary';
	addTagBtn.innerHTML =
		'<span class="dashicons dashicons-plus" aria-hidden="true"></span>' +
		__( 'Add tag' );
	const recenterBtn = document.createElement( 'button' );
	recenterBtn.type = 'button';
	recenterBtn.className = 'wpd-tagcloud__btn';
	recenterBtn.innerHTML =
		'<span class="dashicons dashicons-image-rotate" aria-hidden="true"></span>' +
		__( 'Recenter' );
	const reflowBtn = document.createElement( 'button' );
	reflowBtn.type = 'button';
	reflowBtn.className = 'wpd-tagcloud__btn';
	reflowBtn.innerHTML =
		'<span class="dashicons dashicons-grid-view" aria-hidden="true"></span>' +
		__( 'Reflow' );
	reflowBtn.title = __(
		'Recompute the chip layout from scratch — discards manual repositioning.',
	);
	// Fuzzy-search input. Wired below, after `tags` + `focusTag` exist;
	// the DOM lives here so the toolbar paints with the box in place
	// from the first frame.
	const searchWrap = document.createElement( 'div' );
	searchWrap.className = 'wpd-tagcloud__search';
	const searchInput = document.createElement( 'input' );
	searchInput.type = 'search';
	searchInput.className = 'wpd-tagcloud__search-input';
	searchInput.placeholder = __( 'Search tags…' );
	searchInput.setAttribute(
		'aria-label',
		__( 'Search tags in the cloud' ),
	);
	searchWrap.appendChild( searchInput );
	const searchResults = document.createElement( 'ul' );
	searchResults.className = 'wpd-tagcloud__search-results';
	searchResults.hidden = true;
	searchWrap.appendChild( searchResults );
	const hint = document.createElement( 'span' );
	hint.className = 'wpd-tagcloud__hint';
	hint.textContent = __(
		'Click a tag to focus + edit · drag to reposition · wheel to zoom',
	);
	toolbar.appendChild( addTagBtn );
	toolbar.appendChild( recenterBtn );
	toolbar.appendChild( reflowBtn );
	toolbar.appendChild( searchWrap );
	toolbar.appendChild( hint );
	host.appendChild( toolbar );

	// --- Layout: canvas on the left, fixed sidebar on the right ------
	const layout = document.createElement( 'div' );
	layout.className = 'wpd-tagcloud__layout';
	host.appendChild( layout );

	const stage = document.createElement( 'div' );
	stage.className = 'wpd-tagcloud__stage';
	stage.classList.add( 'is-loading' );
	layout.appendChild( stage );

	const sidebar = document.createElement( 'aside' );
	sidebar.className = 'wpd-tagcloud__sidebar';
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
	app.canvas.classList.add( 'wpd-tagcloud__canvas' );

	const world = new pixi.Container();
	world.x = stage.clientWidth / 2;
	world.y = stage.clientHeight / 2;
	app.stage.addChild( world );

	// Layer order (back to front):
	//   postEdgeLayer    → faint radial lines from focused chip to posts
	//   chipLayer        → tag pills (above the lines so a focused
	//                      chip's connectors visibly pass behind it)
	//   postLayer        → invisible post markers (kept for compat)
	//   postChipLayer    → post pill chips (the visible satellites)
	//   pagerLayer       → ◀ N / M ▶ controls under the post fan
	const chipLayer = new pixi.Container();
	const postEdgeLayer = new pixi.Container();
	const postLayer = new pixi.Container();
	const postChipLayer = new pixi.Container();
	world.addChild( postEdgeLayer );
	world.addChild( chipLayer );
	world.addChild( postLayer );
	world.addChild( postChipLayer );

	const postEdgeGfx = new pixi.Graphics();
	postEdgeLayer.addChild( postEdgeGfx );

	// Pager — same shape as the Categories mindmap so the spotlit
	// surface reads identically across both tabs. Lives on `postLayer`
	// so it scales with the world (matches the satellite ring it
	// controls). Toggling `.visible` is cheaper than rebuilding the
	// children per render.
	const pager = new pixi.Container();
	pager.eventMode = 'passive';
	pager.visible = false;
	postLayer.addChild( pager );
	const pagerPrev = new pixi.Graphics();
	const pagerNext = new pixi.Graphics();
	const pagerLabel = new pixi.Text( {
		text: '1 / 1',
		style: {
			fill: 0x50575e,
			fontSize: 12,
			fontFamily: FONT_FAMILY,
			fontWeight: '600',
		},
	} );
	pagerLabel.anchor.set( 0.5 );
	pagerPrev.eventMode = 'static';
	pagerPrev.cursor = 'pointer';
	pagerNext.eventMode = 'static';
	pagerNext.cursor = 'pointer';
	pagerPrev.hitArea = new pixi.Circle( 0, 0, 16 );
	pagerNext.hitArea = new pixi.Circle( 0, 0, 16 );
	pager.addChild( pagerPrev );
	pager.addChild( pagerLabel );
	pager.addChild( pagerNext );
	const stopBubble = ( e: unknown ): void => {
		( e as { stopPropagation?: () => void } ).stopPropagation?.();
		pixiInteractionAt = performance.now();
	};
	pagerPrev.on( 'pointerdown', stopBubble );
	pagerNext.on( 'pointerdown', stopBubble );
	pagerPrev.on( 'pointertap', ( e ) => {
		stopBubble( e );
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
	const tags = new Map< number, TagBox >();
	const postChips = new Map< number, PostChip >();
	const postNodes = new Map< number, PostMini >();
	let focusId: number | null = null;
	let focusPage = 1;
	let focusTotalPages = 1;
	// Monotonic token for in-flight post loads — prevents stale
	// responses from overwriting a freshly-changed focus. Same pattern
	// as Categories mindmap.
	let loadSeq = 0;
	let pixiInteractionAt = 0;
	let dragChip: TagBox | null = null;
	let dragOffset: PixiPoint = { x: 0, y: 0 };
	let dragStart: PixiPoint | null = null;
	let panActive = false;
	let panStart: PixiPoint | null = null;
	let panMovedDist = 0;
	let raf: number | null = null;
	let lastTick = performance.now();
	let targetScale = world.scale.x;
	let targetWorldX = world.x;
	let targetWorldY = world.y;
	let nudgeAwayFrom: { x: number; y: number; radius: number } | null = null;
	let prevView: { scale: number; x: number; y: number } | null = null;
	let lastFocusChange = 0;
	// Draft state for "create new tag". When set, paintSidebar renders
	// a Create/Cancel form for a not-yet-persisted term; REST is only
	// hit on click. Same flow as the Categories mindmap.
	let draft: true | null = null;
	// Stable list of source TermRows — server-of-record for redraws.
	let terms: TermRow[] = [];

	// Persisted manual chip positions (drag-to-reposition). Keyed by
	// term id; survives F5 within the same browser. Cleared by Reflow.
	const positionsKey = computePositionsKey();
	const persistedPositions = readPersistedPositions( positionsKey );

	// Co-occurrence map: tag id → list of co-occurring sibling tags
	// (with `shared` post counts). Populated from
	// `/desktop-mode/v1/tag-cooccurrence` on mount and on Reflow;
	// empty until the fetch resolves. When non-empty, the spiral pack
	// switches to cluster-aware mode — tags that share posts sit
	// near each other on the canvas instead of being placed in pure
	// popularity-only order.
	let cooccurrenceMap: Map< number, TermNeighbor[] > = new Map();

	const themeHue = readAdminThemeHue();

	// --- Data fetch + initial layout ---------------------------------
	try {
		const all: TermRow[] = [];
		let page = 1;
		while ( page <= 5 ) {
			const res = await client.fetchTerms( 'tags', { page, perPage: 100 } );
			all.push( ...res.items );
			if ( page >= res.totalPages ) {
				break;
			}
			page++;
		}
		terms = all;
	} catch ( err ) {
		showToast( __( 'Couldn’t load tags:' ), err );
	}

	const showError = ( title: string, err: unknown ): void =>
		showToast( title, err );

	function buildCloud(): void {
		// Drop boxes whose terms disappeared.
		const liveIds = new Set( terms.map( ( t ) => t.id ) );
		for ( const [ id, box ] of tags ) {
			if ( ! liveIds.has( id ) ) {
				chipLayer.removeChild( box.chip.container );
				box.chip.container.destroy( { children: true } );
				tags.delete( id );
			}
		}

		// Compute font sizes against the population max so the cloud's
		// dynamic range stays the same regardless of total tag count.
		const maxCount = Math.max( 1, ...terms.map( ( t ) => t.count ) );

		// Reuse existing TagBoxes so positions persist across rebuilds
		// (after rename, create, etc.). New terms enter cold; their
		// initial position is filled in by the spiral packer below.
		const fresh: TagBox[] = [];
		for ( const term of terms ) {
			const fontSize = fontSizeFor( term.count, maxCount );
			const hue = tagHue( term.slug || term.name, themeHue );
			const rotation = tagRotation( term.slug || term.name );
			const existing = tags.get( term.id );
			if ( existing ) {
				existing.name = term.name;
				existing.slug = term.slug;
				existing.description = term.description;
				existing.count = term.count;
				existing.fontSize = fontSize;
				existing.hue = hue;
				existing.rotation = rotation;
				layoutChip( existing );
			} else {
				const chip = createTagChip( pixi, chipLayer, term, fontSize, hue );
				const persisted = persistedPositions.get( term.id );
				const box: TagBox = {
					id: term.id,
					name: term.name,
					slug: term.slug,
					description: term.description,
					count: term.count,
					fontSize,
					hue,
					rotation,
					x: persisted ? persisted.x : 0,
					y: persisted ? persisted.y : 0,
					tx: persisted ? persisted.x : 0,
					ty: persisted ? persisted.y : 0,
					width: 0,
					height: 0,
					chip,
				};
				tags.set( term.id, box );
				layoutChip( box );
				wireChipPointer( box );
				if ( ! persisted ) {
					fresh.push( box );
				}
			}
		}

		// Spiral-pack any boxes that don't have a manually-set or
		// previously-computed position. Sort by count desc so popular
		// tags get prime real estate near the centre. When the
		// cooccurrence map is non-empty, `packBoxesWithClusters`
		// anchors each fresh chip near its placed neighbours; with an
		// empty map it falls back to the original origin-anchored
		// spiral.
		const placed: Array< { x: number; y: number; w: number; h: number } > = [];
		const placedById = new Map< number, { x: number; y: number } >();
		for ( const box of tags.values() ) {
			if ( ! fresh.includes( box ) ) {
				placed.push( {
					x: box.tx - box.width / 2,
					y: box.ty - box.height / 2,
					w: box.width,
					h: box.height,
				} );
				placedById.set( box.id, { x: box.tx, y: box.ty } );
			}
		}
		fresh.sort( ( a, b ) => b.count - a.count );
		packBoxesWithClusters( fresh, placed, placedById, cooccurrenceMap );
		for ( const box of fresh ) {
			// `packBoxesWithClusters` wrote tx/ty; mirror onto x/y so
			// fresh chips paint at their final position instead of
			// easing from (0,0).
			box.x = box.tx;
			box.y = box.ty;
		}
	}

	// (createTagChip / wireChipPointer / layoutChip below)

	function wireChipPointer( box: TagBox ): void {
		const c = box.chip.container;
		c.on( 'pointerdown', ( e: unknown ) => {
			const ev = e as { global: PixiPoint; stopPropagation?: () => void };
			ev.stopPropagation?.();
			pixiInteractionAt = performance.now();
			dragChip = box;
			dragStart = { x: ev.global.x, y: ev.global.y };
			const local = stageToWorld( { x: ev.global.x, y: ev.global.y } );
			dragOffset = { x: box.x - local.x, y: box.y - local.y };
		} );
		c.on( 'pointerover', () => {
			box.chip.cachedHover = true;
			paintChip( box );
		} );
		c.on( 'pointerout', () => {
			box.chip.cachedHover = false;
			paintChip( box );
		} );
	}

	function layoutChip( box: TagBox ): void {
		const chip = box.chip;
		const displayName = truncateChipName( box.name );
		const countStr = String( box.count );

		if ( chip.nameText.text !== displayName ) {
			chip.nameText.text = displayName;
		}
		if ( chip.countText.text !== countStr ) {
			chip.countText.text = countStr;
		}

		// Font size is intrinsic to the chip — it doesn't counter-scale
		// like Categories. Most-used tags should LOOK biggest; that's
		// the tag-cloud convention. Counter-scaling the container only
		// kicks in for zoom-out so glyphs stay readable.
		chip.nameText.style.fontSize = box.fontSize;
		chip.hashText.style.fontSize = box.fontSize;
		chip.countText.style.fontSize = Math.max(
			10,
			Math.round( box.fontSize * 0.55 ),
		);

		chip.cachedName = displayName;
		chip.cachedCount = box.count;
		chip.cachedHue = box.hue;

		const hashW = chip.hashText.width;
		const nameW = chip.nameText.width;
		const nameH = chip.nameText.height;
		const countW = chip.countText.width;
		const countH = chip.countText.height;
		const countBadgeW = Math.max( 18, countW + 10 );
		const countBadgeH = Math.max( 14, countH + 4 );
		const totalW =
			CHIP_PAD_X +
			hashW +
			CHIP_GAP_HASH +
			nameW +
			CHIP_GAP_COUNT +
			countBadgeW +
			CHIP_PAD_X;
		const totalH = Math.max( nameH, countBadgeH ) + CHIP_PAD_Y * 2;
		box.width = totalW;
		box.height = totalH;

		paintChip( box );
	}

	function paintChip( box: TagBox ): void {
		const chip = box.chip;
		const focused = focusId === box.id;
		chip.cachedFocused = focused;
		const totalW = box.width;
		const totalH = box.height;
		const left = -totalW / 2;
		const top = -totalH / 2;
		const radius = totalH / 2;

		let fillBg: number;
		if ( focused ) {
			fillBg = hslToInt( box.hue, 70, 48 );
		} else if ( chip.cachedHover ) {
			fillBg = hslToInt( box.hue, 70, 92 );
		} else {
			fillBg = hslToInt( box.hue, 60, 95 );
		}
		const borderColor = focused
			? hslToInt( box.hue, 70, 38 )
			: hslToInt( box.hue, 50, 70 );
		const textColor = focused ? 0xffffff : 0x1d2327;
		const hashColor = focused
			? 0xffffff
			: hslToInt( box.hue, 65, 42 );
		const countBg = focused
			? hslToInt( box.hue, 80, 30 )
			: hslToInt( box.hue, 70, 50 );

		// Soft drop shadow — a slightly bigger pill behind the chip,
		// offset by 2px and rendered with low alpha. Reads as paper
		// stickers pinned to a corkboard. Scales nicely under zoom
		// because everything happens in world space.
		chip.shadow.clear();
		chip.shadow.roundRect(
			left - 1,
			top + 3,
			totalW + 2,
			totalH + 2,
			radius + 1,
		);
		let shadowAlpha = 0.1;
		if ( focused ) {
			shadowAlpha = 0.18;
		} else if ( chip.cachedHover ) {
			shadowAlpha = 0.16;
		}
		chip.shadow.fill( {
			color: 0x000000,
			alpha: shadowAlpha,
		} );

		chip.bg.clear();
		chip.bg.roundRect( left, top, totalW, totalH, radius );
		chip.bg.fill( fillBg );
		chip.bg.stroke( {
			color: borderColor,
			width: focused ? 2 : 1.25,
			alpha: focused ? 1 : 0.85,
		} );

		// Position the # glyph, name, and count badge inside the pill.
		const hashW = chip.hashText.width;
		const nameW = chip.nameText.width;
		const nameH = chip.nameText.height;
		const countW = chip.countText.width;
		const countH = chip.countText.height;
		const countBadgeW = Math.max( 18, countW + 10 );
		const countBadgeH = Math.max( 14, countH + 4 );

		chip.hashText.x = left + CHIP_PAD_X;
		chip.hashText.y = ( totalH - nameH ) / 2 + top;
		chip.hashText.style.fill = hashColor;

		chip.nameText.x = left + CHIP_PAD_X + hashW + CHIP_GAP_HASH;
		chip.nameText.y = ( totalH - nameH ) / 2 + top;
		chip.nameText.style.fill = textColor;

		const badgeX =
			left +
			CHIP_PAD_X +
			hashW +
			CHIP_GAP_HASH +
			nameW +
			CHIP_GAP_COUNT;
		const badgeY = ( totalH - countBadgeH ) / 2 + top;
		// The count badge is drawn as a small filled pill behind the
		// number; we draw it directly on bg via a second roundRect call
		// with a fill swap (Pixi 8 keeps the prior fill style stateful,
		// so we explicitly re-fill).
		chip.bg.roundRect(
			badgeX,
			badgeY,
			countBadgeW,
			countBadgeH,
			countBadgeH / 2,
		);
		chip.bg.fill( countBg );

		chip.countText.x = badgeX + ( countBadgeW - countW ) / 2;
		chip.countText.y = badgeY + ( countBadgeH - countH ) / 2;
		chip.countText.style.fill = 0xffffff;
	}

	// --- Spiral packer ------------------------------------------------
	// Walk an Archimedean spiral outward from (anchorX, anchorY) in
	// fine angular steps, picking the first slot whose AABB doesn't
	// intersect any already-placed AABB (with SPIRAL_PADDING breathing
	// room). Order matters — boxes are sorted by count desc before
	// this runs, so popular tags claim their anchor's centre first.
	// The slight Y stretch (0.7×) gives the cloud a wider,
	// newspaper-like aspect ratio.
	//
	// `anchorX`/`anchorY` default to the origin (backwards-compatible
	// with the pre-clustering call sites that always packed at 0,0).
	// The cooccurrence-aware path passes a non-zero anchor — the
	// weighted centroid of already-placed co-occurring siblings — so
	// related tags pack next to each other.
	function findSpiralSlot(
		w: number,
		h: number,
		placed: Array< { x: number; y: number; w: number; h: number } >,
		anchorX = 0,
		anchorY = 0,
	): { x: number; y: number } {
		if ( placed.length === 0 ) {
			return { x: anchorX, y: anchorY };
		}
		const padding = SPIRAL_PADDING;
		// Try the anchor itself first — if free, we want the spiral to
		// place this chip exactly at its centroid, not one tick out.
		{
			const aabb = {
				x: anchorX - w / 2 - padding,
				y: anchorY - h / 2 - padding,
				w: w + padding * 2,
				h: h + padding * 2,
			};
			let overlap = false;
			for ( const p of placed ) {
				if ( aabbIntersect( aabb, p ) ) {
					overlap = true;
					break;
				}
			}
			if ( ! overlap ) {
				return { x: anchorX, y: anchorY };
			}
		}
		// Step the spiral so the angular increment shrinks at higher
		// radii (more candidate slots per ring further out, where they
		// matter); inner steps stay coarse so the centre packs tight.
		let theta = 0;
		const maxIter = 10000;
		for ( let i = 0; i < maxIter; i++ ) {
			theta += 0.18;
			const r = theta * 5;
			const cx = anchorX + r * Math.cos( theta );
			const cy = anchorY + r * Math.sin( theta ) * 0.7;
			const aabb = {
				x: cx - w / 2 - padding,
				y: cy - h / 2 - padding,
				w: w + padding * 2,
				h: h + padding * 2,
			};
			let overlap = false;
			for ( const p of placed ) {
				if ( aabbIntersect( aabb, p ) ) {
					overlap = true;
					break;
				}
			}
			if ( ! overlap ) {
				return { x: cx, y: cy };
			}
		}
		// Should never hit — the spiral is unbounded — but a safe
		// fallback (place far below the anchor) keeps the function
		// total.
		return {
			x: anchorX,
			y: anchorY + ( placed.length + 1 ) * ( h + padding ),
		};
	}

	// Cluster-aware spiral pack. For each box in `boxesInOrder`,
	// computes an anchor as the weighted centroid of its already-
	// placed co-occurring siblings (read from `placedById`); falls
	// back to a freshly-allocated "new cluster" anchor on a coarse
	// meta-spiral when the box has no placed neighbour yet. Then
	// calls `findSpiralSlot` from that anchor and writes
	// `box.tx`/`box.ty`. Mutates `placed` + `placedById` so later
	// boxes see this one.
	//
	// When `cooccurrence` is empty the math collapses to the original
	// origin-anchored spiral pack (every box gets the cluster-0
	// anchor at (0,0)), so the no-cooccurrence-data path stays
	// identical to before clustering existed.
	function packBoxesWithClusters(
		boxesInOrder: TagBox[],
		placed: Array< { x: number; y: number; w: number; h: number } >,
		placedById: Map< number, { x: number; y: number } >,
		cooccurrence: Map< number, TermNeighbor[] >,
	): void {
		let clusterCounter = 0;
		const allocateClusterAnchor = (): { x: number; y: number } => {
			const idx = clusterCounter++;
			if ( idx === 0 ) {
				return { x: 0, y: 0 };
			}
			// Phyllotaxis-ish meta-spiral: each new cluster centre
			// sits at golden-angle θ ≈ 137° from the previous, on a
			// ring whose radius grows linearly. The slight Y stretch
			// (0.8) matches the inner spiral's newspaper aspect.
			const theta = idx * 2.4;
			const radius = 120 + idx * 70;
			return {
				x: radius * Math.cos( theta ),
				y: radius * Math.sin( theta ) * 0.8,
			};
		};
		for ( const box of boxesInOrder ) {
			let anchorX = 0;
			let anchorY = 0;
			let usedCentroid = false;
			const neighbors = cooccurrence.get( box.id );
			if ( neighbors && neighbors.length > 0 ) {
				let sumX = 0;
				let sumY = 0;
				let sumW = 0;
				for ( const n of neighbors ) {
					const pos = placedById.get( n.id );
					if ( ! pos ) {
						continue;
					}
					sumX += pos.x * n.shared;
					sumY += pos.y * n.shared;
					sumW += n.shared;
				}
				if ( sumW > 0 ) {
					anchorX = sumX / sumW;
					anchorY = sumY / sumW;
					usedCentroid = true;
				}
			}
			if ( ! usedCentroid ) {
				const anchor = allocateClusterAnchor();
				anchorX = anchor.x;
				anchorY = anchor.y;
			}
			const slot = findSpiralSlot(
				box.width,
				box.height,
				placed,
				anchorX,
				anchorY,
			);
			box.tx = slot.x;
			box.ty = slot.y;
			placedById.set( box.id, { x: slot.x, y: slot.y } );
			placed.push( {
				x: slot.x - box.width / 2,
				y: slot.y - box.height / 2,
				w: box.width,
				h: box.height,
			} );
		}
	}

	// --- Per-frame pass ----------------------------------------------
	function syncChipPositions(): void {
		const chipCounterScale = 1 / Math.max( 0.01, world.scale.x );
		const anyFocus = focusId !== null;
		for ( const box of tags.values() ) {
			const c = box.chip.container;
			c.x = box.x;
			c.y = box.y;
			// Counter-scale only when zoomed OUT. Zoomed in, intrinsic
			// font-size differences ARE the reading; counter-scaling
			// would erase the size signal. Min 1 keeps a max-zoom-out
			// cloud legible without flattening the count hierarchy at
			// natural zoom.
			const counter = Math.max( 1, chipCounterScale );
			c.scale.set( counter );
			c.rotation = box.rotation;
			const focused = focusId === box.id;
			const targetAlpha = ! anyFocus || focused ? 1 : 0.32;
			if ( Math.abs( c.alpha - targetAlpha ) > 0.005 ) {
				c.alpha += ( targetAlpha - c.alpha ) * 0.18;
			} else {
				c.alpha = targetAlpha;
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
			if ( chip.container.alpha < 1 ) {
				chip.container.alpha = Math.min(
					1,
					chip.container.alpha + 0.18,
				);
			}
		}
	}

	function tick(): void {
		const now = performance.now();
		const dt = Math.min( 50, now - lastTick );
		lastTick = now;

		// Smooth-zoom easing — same coefficient as the Categories
		// mindmap so wheel + focus animations feel identical across
		// the two tabs.
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

		// Chip motion. Two contributions:
		//   1. drift toward target position (so chips push back into
		//      place after the user lifts a drag, and resettle after a
		//      spotlight ends);
		//   2. spotlight nudge — when a chip is focused, push every
		//      other chip outside the post-ring keep-out zone so the
		//      satellite cards aren't covered.
		for ( const box of tags.values() ) {
			if ( box === dragChip ) {
				continue;
			}
			let tx = box.tx;
			let ty = box.ty;
			if ( nudgeAwayFrom && box.id !== focusId ) {
				const dx = box.tx - nudgeAwayFrom.x;
				const dy = box.ty - nudgeAwayFrom.y;
				const d = Math.sqrt( dx * dx + dy * dy ) || 1;
				const limit =
					nudgeAwayFrom.radius +
					Math.max( box.width, box.height ) / 2;
				if ( d < limit ) {
					const push = limit + 12;
					tx = nudgeAwayFrom.x + ( dx / d ) * push;
					ty = nudgeAwayFrom.y + ( dy / d ) * push;
				}
			}
			// Eased pull toward the (possibly nudged) target position.
			// dt-aware so transitions stay smooth on slow frames.
			const ease = 1 - Math.exp( -dt * 0.012 );
			box.x += ( tx - box.x ) * ease;
			box.y += ( ty - box.y ) * ease;
		}

		// Post mini-nodes ease toward their satellite target slots.
		for ( const p of postNodes.values() ) {
			p.x += ( p.tx - p.x ) * 0.18;
			p.y += ( p.ty - p.y ) * 0.18;
			p.gfx.x = p.x;
			p.gfx.y = p.y;
		}

		drawPostEdges();
		syncChipPositions();
		raf = requestAnimationFrame( tick );
	}

	function drawPostEdges(): void {
		postEdgeGfx.clear();
		if ( focusId === null ) {
			return;
		}
		const center = tags.get( focusId );
		if ( ! center ) {
			return;
		}
		for ( const post of postNodes.values() ) {
			postEdgeGfx.moveTo( center.x, center.y );
			postEdgeGfx.lineTo( post.x, post.y );
			postEdgeGfx.stroke( {
				color: hslToInt( center.hue, 60, 50 ),
				width: 1,
				alpha: 0.35,
			} );
		}
	}

	// --- Stage pointer + wheel ---------------------------------------
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
		if ( dragChip ) {
			const cursorWorld = stageToWorld( ev.global );
			const nx = cursorWorld.x + dragOffset.x;
			const ny = cursorWorld.y + dragOffset.y;
			dragChip.x = nx;
			dragChip.y = ny;
			dragChip.tx = nx;
			dragChip.ty = ny;
			return;
		}
		if ( panActive && panStart ) {
			const dx = ev.global.x - panStart.x;
			const dy = ev.global.y - panStart.y;
			world.x += dx;
			world.y += dy;
			targetWorldX += dx;
			targetWorldY += dy;
			panMovedDist += Math.sqrt( dx * dx + dy * dy );
			panStart = { x: ev.global.x, y: ev.global.y };
		}
	}

	function onStagePointerUp( e?: unknown ): void {
		if ( dragChip ) {
			const box = dragChip;
			const startPos = dragStart;
			dragChip = null;
			dragStart = null;
			let movement = Infinity;
			const ev = e as { global?: PixiPoint } | undefined;
			if ( startPos && ev && ev.global ) {
				const dx = ev.global.x - startPos.x;
				const dy = ev.global.y - startPos.y;
				movement = Math.sqrt( dx * dx + dy * dy );
			}
			if ( movement < 3 ) {
				// Tap, not drag → focus.
				void focusTag( box.id );
			} else {
				// Real drag → persist the new position.
				persistedPositions.set( box.id, { x: box.tx, y: box.ty } );
				writePersistedPositions( positionsKey, persistedPositions );
			}
		}
		panActive = false;
		panStart = null;
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
	app.stage.on( 'pointerup', ( e ) => onStagePointerUp( e ) );
	app.stage.on( 'pointerupoutside', ( e ) => onStagePointerUp( e ) );

	function onWheel( e: WheelEvent ): void {
		e.preventDefault();
		// Exponential zoom — see the matching block in
		// categories-mindmap.ts for full rationale. Briefly: a flat
		// 10% multiplier per event was harsh on trackpads (which
		// emit many small-delta events per gesture) and tolerable
		// on mice (one big-delta event per detent). Math.exp scales
		// the multiplier with the wheel delta so both devices
		// converge to a smooth feel.
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
		const wx = ( sx - targetWorldX ) / prev;
		const wy = ( sy - targetWorldY ) / prev;
		targetScale = next;
		targetWorldX = sx - wx * next;
		targetWorldY = sy - wy * next;
	}
	stage.addEventListener( 'wheel', onWheel, { passive: false } );

	// --- Resize ------------------------------------------------------
	let firstFitDone = false;
	// Single mechanism for "refit when the canvas actually changes
	// size" — see the matching block in categories-mindmap.ts for
	// the rationale. Briefly: ResizeObserver is the only signal
	// universal across every resize path (title-bar maximize, drag-
	// resize, snap, browser resize, fullscreen, future paths…); a
	// 24px significance threshold separates real resizes from sub-
	// pixel sidebar reflows; an 80ms debounce waits for the CSS
	// transition to settle before fitting.
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
		app.render();
	}
	const ro = new ResizeObserver( onResize );
	ro.observe( stage );

	// --- Focus + posts -----------------------------------------------
	async function focusTag( id: number ): Promise< void > {
		if ( focusId === id ) {
			closeFocus();
			return;
		}
		const wasFocused = focusId !== null;
		focusId = id;
		focusPage = 1;
		lastFocusChange = performance.now();
		const focused = tags.get( id );
		if ( focused ) {
			if ( ! wasFocused ) {
				prevView = {
					scale: targetScale,
					x: targetWorldX,
					y: targetWorldY,
				};
			}
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
		}
		// Repaint chips so the focused one picks up the saturated fill.
		for ( const box of tags.values() ) {
			paintChip( box );
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
		nudgeAwayFrom = null;
		if ( prevView ) {
			targetScale = prevView.scale;
			targetWorldX = prevView.x;
			targetWorldY = prevView.y;
			prevView = null;
		}
		paintSidebar();
		clearPosts();
		for ( const box of tags.values() ) {
			paintChip( box );
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
		container.alpha = 0;

		const bg = new pixi.Graphics();
		container.addChild( bg );

		const dot = new pixi.Graphics();
		container.addChild( dot );

		const titleText = new pixi.Text( {
			text: post.title,
			style: {
				fill: 0x1d2327,
				fontSize: 12,
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
			// Open the post in a new shell window AND exit focus mode
			// in the same gesture. Without the closeFocus the canvas
			// stays zoomed-in on the spotlit chip — when the user
			// finishes editing and returns to the Posts window, they
			// can't see the rest of the cloud until they manually
			// click empty canvas. Closing focus here makes "click a
			// satellite post" a clean transition: open the post,
			// release the camera back to the full cloud view.
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

	// Per-(tagId, page) cache for the satellite post fan. See the
	// matching block in categories-mindmap.ts for rationale: first
	// click fetches, subsequent clicks within POSTS_CACHE_TTL_MS hit
	// the cache and render synchronously.
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
		focusedTagId: number,
	): void {
		focusTotalPages = entry.totalPages;
		if ( Number.isFinite( entry.realTotal ) ) {
			const box = tags.get( focusedTagId );
			if ( box && box.count !== entry.realTotal ) {
				box.count = entry.realTotal;
				terms = terms.map( ( t ) =>
					t.id === box.id
						? { ...t, count: entry.realTotal }
						: t,
				);
				layoutChip( box );
			}
		}
		renderPosts( entry.items );
	}

	async function loadPostsForFocus(): Promise< void > {
		if ( focusId === null ) {
			return;
		}
		const mySeq = ++loadSeq;
		const myFocusId = focusId;
		const cacheKey = `${ focusId }:${ focusPage }`;
		const cached = postsCache.get( cacheKey );
		if ( cached && performance.now() - cached.fetchedAt < POSTS_CACHE_TTL_MS ) {
			applyPostsResult( cached, myFocusId );
			return;
		}
		const cfg = client.getConfig();
		const url = new URL( cfg.postsUrl );
		url.searchParams.set( 'tags', String( focusId ) );
		url.searchParams.set( 'per_page', String( POST_PER_PAGE ) );
		url.searchParams.set( 'page', String( focusPage ) );
		url.searchParams.set( 'status', 'any' );
		url.searchParams.set( '_fields', 'id,title,status' );
		try {
			const response = await fetchShellJson( client, url.toString() );
			if ( mySeq !== loadSeq || focusId !== myFocusId ) {
				return;
			}
			const raw =
				( response.json as Array< {
					id: number;
					title?: { rendered?: string };
				} > ) ?? [];
			const totalPages = Math.max(
				1,
				parseInt( response.headers.get( 'X-WP-TotalPages' ) ?? '1', 10 ) || 1,
			);
			// Authoritative count from the same query the table view
			// runs — keeps the chip badge honest when the term-list
			// REST count is stale (drafts/pending under custom-status
			// plugins, REST cache layers).
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
		const center = tags.get( focusId );
		if ( ! center ) {
			return;
		}
		const count = items.length;
		const ringR = POST_RING_RADIUS + Math.max( 0, count - 8 ) * 6;
		const tone = hslToInt( center.hue, 70, 48 );
		items.forEach( ( item, idx ) => {
			const angle =
				( ( 2 * Math.PI ) / Math.max( 1, count ) ) * idx -
				Math.PI / 2;
			const tx = center.x + Math.cos( angle ) * ringR;
			const ty = center.y + Math.sin( angle ) * ringR;
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
		const center = tags.get( focusId );
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
		pagerPrev.x = -38;
		pagerPrev.y = 0;
		pagerNext.x = 38;
		pagerNext.y = 0;
		pagerLabel.x = 0;
		pagerLabel.y = 0;
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
		const children = ( gfx as unknown as { children?: PixiContainer[] } )
			.children;
		const label = ( children?.[ 0 ] as PixiText | undefined ) ?? null;
		if ( ! label ) {
			const t = new pixi.Text( {
				text: glyph,
				style: {
					fill: disabled ? 0xb0b3b8 : 0x50575e,
					fontSize: 14,
					fontFamily: FONT_FAMILY,
					fontWeight: '600',
				},
			} );
			t.anchor.set( 0.5 );
			gfx.addChild( t );
		} else {
			label.text = glyph;
			label.style.fill = disabled ? 0xb0b3b8 : 0x50575e;
		}
	}

	function openInPostsTab(
		_id: number,
		editUrl: string,
		title?: string,
	): void {
		const wm = api?.windowManager;
		const derive = api?.deriveWindowId;
		// If the Posts window is in fullscreen ("focus") mode, the
		// new post window opens with a normal z-index and would be
		// hidden behind the fullscreen z-stack. Exit fullscreen
		// first so the user actually sees the post they clicked.
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

	// --- Sidebar editor ----------------------------------------------
	function paintDraftSidebar(): void {
		const header = document.createElement( 'div' );
		header.className = 'wpd-tagcloud__sidebar-header';
		const dot = document.createElement( 'span' );
		dot.className = 'wpd-tagcloud__sidebar-dot';
		dot.style.background = `hsl( ${ themeHue }deg 60% 55% )`;
		const label = document.createElement( 'code' );
		label.className = 'wpd-tagcloud__sidebar-slug';
		label.textContent = __( 'New tag' );
		header.appendChild( dot );
		header.appendChild( label );
		sidebar.appendChild( header );

		const nameLabel = document.createElement( 'label' );
		nameLabel.className = 'wpd-tagcloud__sidebar-label';
		nameLabel.textContent = __( 'Name' );
		sidebar.appendChild( nameLabel );
		const nameInput = document.createElement( 'input' );
		nameInput.type = 'text';
		nameInput.className = 'wpd-tagcloud__editor-name';
		nameInput.placeholder = __( 'e.g. featured' );
		sidebar.appendChild( nameInput );
		requestAnimationFrame( () => nameInput.focus() );

		const descLabel = document.createElement( 'label' );
		descLabel.className = 'wpd-tagcloud__sidebar-label';
		descLabel.textContent = __( 'Description' );
		sidebar.appendChild( descLabel );
		const descInput = document.createElement( 'textarea' );
		descInput.className = 'wpd-tagcloud__editor-desc';
		descInput.placeholder = __( 'Description (optional)' );
		descInput.rows = 4;
		sidebar.appendChild( descInput );

		const actions = document.createElement( 'div' );
		actions.className = 'wpd-tagcloud__editor-actions';

		const createBtn = document.createElement( 'button' );
		createBtn.type = 'button';
		createBtn.className = 'wpd-tagcloud__btn wpd-tagcloud__btn--primary';
		createBtn.textContent = __( 'Create' );

		const cancelBtn = document.createElement( 'button' );
		cancelBtn.type = 'button';
		cancelBtn.className = 'wpd-tagcloud__btn wpd-tagcloud__btn--danger';
		cancelBtn.textContent = __( 'Cancel' );

		const handleCreate = async (): Promise< void > => {
			const name = nameInput.value.trim();
			if ( ! name ) {
				nameInput.focus();
				return;
			}
			createBtn.disabled = true;
			try {
				const created = await client.createTag( name );
				const next: TermRow = {
					id: created.id,
					name: created.name,
					slug:
						( created as unknown as { slug?: string } ).slug ||
						'',
					parent: 0,
					count: 0,
					description:
						( created as unknown as { description?: string } )
							.description || '',
					isDefault: false,
				};
				if ( ! terms.some( ( t ) => t.id === next.id ) ) {
					terms = terms.concat( next );
				}
				// If the user supplied a description in the same flow,
				// patch it through. createTag only takes the name; the
				// description goes via updateTerm so the user gets a
				// single "Create" click for both.
				const desc = descInput.value.trim();
				if ( desc ) {
					try {
						const updated = await client.updateTerm(
							'tags',
							created.id,
							{ description: desc },
						);
						terms = terms.map( ( t ) =>
							t.id === updated.id
								? {
									...t,
									description:
										updated.description ?? desc,
								}
								: t,
						);
					} catch {
						// Description failure shouldn't lose the tag —
						// surface a toast but keep the new term.
						showError(
							__( 'Tag created but description failed:' ),
							null,
						);
					}
				}
				draft = null;
				buildCloud();
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

	function paintSidebar(): void {
		sidebar.replaceChildren();
		if ( draft !== null ) {
			paintDraftSidebar();
			return;
		}
		if ( focusId === null ) {
			const empty = document.createElement( 'div' );
			empty.className = 'wpd-tagcloud__sidebar-empty';
			const icon = document.createElement( 'span' );
			icon.className = 'dashicons dashicons-tag';
			icon.setAttribute( 'aria-hidden', 'true' );
			empty.appendChild( icon );
			const title = document.createElement( 'h3' );
			title.className = 'wpd-tagcloud__sidebar-empty-title';
			title.textContent = __( 'No tag selected' );
			empty.appendChild( title );
			const help = document.createElement( 'p' );
			help.className = 'wpd-tagcloud__sidebar-empty-hint';
			help.textContent = __(
				'Click a tag on the cloud to edit it, or click + Add tag to create a new one.',
			);
			empty.appendChild( help );
			sidebar.appendChild( empty );
			return;
		}
		const box = tags.get( focusId );
		if ( ! box ) {
			focusId = null;
			paintSidebar();
			return;
		}
		const id = box.id;

		const header = document.createElement( 'div' );
		header.className = 'wpd-tagcloud__sidebar-header';
		const dot = document.createElement( 'span' );
		dot.className = 'wpd-tagcloud__sidebar-dot';
		dot.style.background = `hsl( ${ box.hue }deg 60% 55% )`;
		const term = terms.find( ( t ) => t.id === id );
		const idLabel = document.createElement( 'code' );
		idLabel.className = 'wpd-tagcloud__sidebar-slug';
		idLabel.textContent = `#${ id }`;
		header.appendChild( dot );
		header.appendChild( idLabel );
		sidebar.appendChild( header );

		const nameLabel = document.createElement( 'label' );
		nameLabel.className = 'wpd-tagcloud__sidebar-label';
		nameLabel.textContent = __( 'Name' );
		sidebar.appendChild( nameLabel );
		const nameInput = document.createElement( 'input' );
		nameInput.type = 'text';
		nameInput.className = 'wpd-tagcloud__editor-name';
		nameInput.value = box.name;
		nameInput.placeholder = __( 'Name' );
		sidebar.appendChild( nameInput );

		const slugLabel = document.createElement( 'label' );
		slugLabel.className = 'wpd-tagcloud__sidebar-label';
		slugLabel.textContent = __( 'Slug' );
		sidebar.appendChild( slugLabel );
		const slugInput = document.createElement( 'input' );
		slugInput.type = 'text';
		slugInput.className = 'wpd-tagcloud__editor-name';
		slugInput.value = term?.slug || '';
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
		descLabel.className = 'wpd-tagcloud__sidebar-label';
		descLabel.textContent = __( 'Description' );
		sidebar.appendChild( descLabel );
		const descInput = document.createElement( 'textarea' );
		descInput.className = 'wpd-tagcloud__editor-desc';
		descInput.value = box.description || '';
		descInput.placeholder = __( 'Description (optional)' );
		descInput.rows = 4;
		sidebar.appendChild( descInput );

		const meta = document.createElement( 'p' );
		meta.className = 'wpd-tagcloud__sidebar-meta';
		meta.textContent = sprintf(
			/* translators: %d: post count. */
			__( '%d posts tagged with this.' ),
			box.count,
		);
		sidebar.appendChild( meta );

		const actions = document.createElement( 'div' );
		actions.className = 'wpd-tagcloud__editor-actions';

		const saveBtn = document.createElement( 'button' );
		saveBtn.type = 'button';
		saveBtn.className = 'wpd-tagcloud__btn wpd-tagcloud__btn--primary';
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
				name === box.name &&
				description === ( box.description || '' ) &&
				slugRaw === currentSlug
			) {
				return;
			}
			const patch: {
				name: string;
				description: string;
				slug?: string;
			} = { name, description };
			if ( slugRaw !== currentSlug ) {
				patch.slug = slugRaw;
			}
			try {
				const updated = await client.updateTerm( 'tags', box.id, patch );
				box.name = updated.name;
				box.description = updated.description;
				box.slug = updated.slug ?? box.slug;
				// Slug change → refresh hue + rotation (both are
				// derived from the slug). New colour repaints below.
				box.hue = tagHue( box.slug || box.name, themeHue );
				box.rotation = tagRotation( box.slug || box.name );
				terms = terms.map( ( t ) =>
					t.id === box.id
						? {
							...t,
							name: updated.name,
							description: updated.description,
							slug: updated.slug ?? t.slug,
						}
						: t,
				);
				layoutChip( box );
				paintSidebar();
			} catch ( err ) {
				showError( __( 'Couldn’t save:' ), err );
			}
		} );

		const delBtn = document.createElement( 'button' );
		delBtn.type = 'button';
		delBtn.className = 'wpd-tagcloud__btn wpd-tagcloud__btn--danger';
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
				await client.deleteTerm( 'tags', box.id );
				terms = terms.filter( ( t ) => t.id !== box.id );
				persistedPositions.delete( box.id );
				writePersistedPositions( positionsKey, persistedPositions );
				focusId = null;
				clearPosts();
				buildCloud();
				paintSidebar();
			} catch ( err ) {
				showError( __( 'Couldn’t delete:' ), err );
			}
		} );

		actions.appendChild( saveBtn );
		actions.appendChild( delBtn );
		sidebar.appendChild( actions );
	}

	function startDraft(): void {
		draft = true;
		paintSidebar();
	}

	addTagBtn.addEventListener( 'click', () => {
		startDraft();
	} );

	function fitToView( opts: { padding?: number; animate?: boolean } = {} ): void {
		// `animate=false` snaps the live world transform; `animate=true`
		// only updates the targets and lets the per-frame easing in
		// tick() interpolate smoothly. See the matching block in
		// categories-mindmap.ts for full rationale.
		const padding = opts.padding ?? 90;
		const animate = opts.animate ?? false;
		const r = stage.getBoundingClientRect();
		if ( tags.size === 0 || r.width === 0 || r.height === 0 ) {
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
		for ( const box of tags.values() ) {
			minX = Math.min( minX, box.tx - box.width / 2 );
			minY = Math.min( minY, box.ty - box.height / 2 );
			maxX = Math.max( maxX, box.tx + box.width / 2 );
			maxY = Math.max( maxY, box.ty + box.height / 2 );
		}
		const w = Math.max( 1, maxX - minX );
		const h = Math.max( 1, maxY - minY );
		const sx = ( r.width - padding * 2 ) / w;
		const sy = ( r.height - padding * 2 ) / h;
		const scale = Math.max( 0.2, Math.min( 1.5, Math.min( sx, sy ) ) );
		const cx = ( minX + maxX ) / 2;
		const cy = ( minY + maxY ) / 2;
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
	 * Focus-aware recenter — frames the focused chip + post fan when
	 * one is active, otherwise frames the whole cloud. Always
	 * animates; called from the resize-end settle and the recenter
	 * button.
	 */
	function recenterCamera(): void {
		if ( focusId !== null ) {
			const focused = tags.get( focusId );
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

	reflowBtn.addEventListener( 'click', () => {
		// Wipe persisted positions and rebuild the layout from
		// scratch. Useful if the user dragged things into chaos and
		// wants the popularity-sorted clustered cloud back.
		persistedPositions.clear();
		writePersistedPositions( positionsKey, persistedPositions );
		// Reset every box's target to "needs spiral placement".
		for ( const box of tags.values() ) {
			box.tx = 0;
			box.ty = 0;
		}
		// Re-pack every chip from scratch, using the latest
		// cooccurrence map (if any). Background-refresh below picks
		// up any new co-occurrence data so a future Reflow click
		// reflects the live tag graph.
		const allBoxes = Array.from( tags.values() );
		allBoxes.sort( ( a, b ) => b.count - a.count );
		packBoxesWithClusters(
			allBoxes,
			[],
			new Map< number, { x: number; y: number } >(),
			cooccurrenceMap,
		);
		// Smooth zoom-out as the cloud rearranges. Chips ease into
		// their new positions in tick(); the camera animates to the
		// new framing in lockstep.
		fitToView( { animate: true } );
		// Background: re-fetch cooccurrence so the next Reflow uses
		// fresh data without blocking this click.
		void refreshCooccurrence();
	} );

	// Click empty canvas → close focus. Pixi paints into the canvas,
	// so a click on a chip / pager / drag also fires a DOM click on
	// the canvas underneath. The interaction-timestamp + pan-distance
	// guards keep this from closing a freshly-deployed chip.
	app.canvas.addEventListener( 'click', ( e ) => {
		const now = performance.now();
		if (
			now - lastFocusChange < 250 ||
			now - pixiInteractionAt < 250
		) {
			return;
		}
		if ( panMovedDist > 4 ) {
			return;
		}
		const target = e.target;
		if ( target === app.canvas && ! dragChip && focusId !== null ) {
			closeFocus();
		}
	} );

	async function refreshCountsViaBulk(): Promise< void > {
		// Defensive fallback — hit the plugin's bulk-count endpoint to
		// get the authoritative "any non-trashed status" count per
		// term. The `desktop_mode_count` REST field on `/wp/v2/tags`
		// is the primary source (and `fetchTerms` already prefers it),
		// but on hosts where REST middleware strips custom fields, the
		// chip silently falls back to core's `count` — which only
		// counts published posts and ignores drafts, pending, future,
		// and private. The bulk endpoint runs a single GROUP BY query
		// over `posts` filtered by `post_status NOT IN ('trash',
		// 'auto-draft', 'inherit')`, so it's the same definition
		// users mean by "tagged posts" regardless of which fields
		// survived the response pipeline.
		if ( terms.length === 0 ) {
			return;
		}
		const cfg = client.getConfig();
		const url = new URL(
			joinRestUrl( cfg.restRoot, 'desktop-mode/v1/term-counts' ),
		);
		// Server expects the WP internal taxonomy slug (`post_tag`),
		// not the REST endpoint base (`tags`) — `get_taxonomy()`
		// inside the callback walks the registered-taxonomies map.
		url.searchParams.set( 'taxonomy', 'post_tag' );
		url.searchParams.set(
			'ids',
			terms.map( ( t ) => t.id ).join( ',' ),
		);
		try {
			const response = await fetchShellJson( client, url.toString() );
			const map = response.json as Record< string, number >;
			let dirty = false;
			terms = terms.map( ( t ) => {
				const fresh = map[ String( t.id ) ];
				if ( typeof fresh === 'number' && fresh !== t.count ) {
					dirty = true;
					const box = tags.get( t.id );
					if ( box ) {
						box.count = fresh;
						// Font size is derived from count vs. max,
						// so a count change can shift the chip's
						// intrinsic size. Recompute against the new
						// population max in one pass below — doing
						// per-box `layoutChip` here would compute
						// against the stale max.
					}
					return { ...t, count: fresh };
				}
				return t;
			} );
			if ( dirty ) {
				// Recompute font sizes against the FRESH population
				// max so the cloud's dynamic range tracks the new
				// counts. Rebuild only the visual layer — chip
				// positions stay where they were.
				const maxCount = Math.max(
					1,
					...terms.map( ( t ) => t.count ),
				);
				for ( const t of terms ) {
					const box = tags.get( t.id );
					if ( ! box ) {
						continue;
					}
					box.count = t.count;
					box.fontSize = fontSizeFor( t.count, maxCount );
					layoutChip( box );
				}
				// Sidebar shows the live count for the focused tag —
				// repaint so the meta line ("N posts tagged with this")
				// catches the bulk-corrected value.
				if ( focusId !== null ) {
					paintSidebar();
				}
			}
		} catch {
			// Silent — we already have whatever count the term-list
			// REST returned. The bulk endpoint is just a backup.
		}
	}

	// Re-pack every non-persisted chip using the current cooccurrence
	// map. Persisted (user-dragged) chips stay where the user put
	// them and double as anchors that the rest packs around. Called
	// when fresh cooccurrence data arrives — the pixi tick eases x/y
	// toward the new tx/ty so chips smoothly drift to their cluster
	// positions without a hard jump.
	function relayoutWithCooccurrence(): void {
		const placed: Array<
			{ x: number; y: number; w: number; h: number }
		> = [];
		const placedById = new Map< number, { x: number; y: number } >();
		const toRepack: TagBox[] = [];
		for ( const box of tags.values() ) {
			if ( persistedPositions.has( box.id ) ) {
				placed.push( {
					x: box.tx - box.width / 2,
					y: box.ty - box.height / 2,
					w: box.width,
					h: box.height,
				} );
				placedById.set( box.id, { x: box.tx, y: box.ty } );
			} else {
				toRepack.push( box );
			}
		}
		toRepack.sort( ( a, b ) => b.count - a.count );
		packBoxesWithClusters( toRepack, placed, placedById, cooccurrenceMap );
	}

	async function refreshCooccurrence(): Promise< void > {
		// Background fetch — empty map on failure leaves the layout
		// in pure-spiral mode (no regression vs. pre-clustering).
		try {
			const fetched = await client.fetchTagCooccurrence( 'tags', 8 );
			cooccurrenceMap = fetched;
			if ( cooccurrenceMap.size > 0 ) {
				relayoutWithCooccurrence();
			}
		} catch {
			// Non-fatal — keep the current layout.
		}
	}

	// --- Bootstrap ---------------------------------------------------
	buildCloud();
	paintSidebar();
	raf = requestAnimationFrame( tick );
	// Authoritative counts via the bulk endpoint. Runs in the
	// background; the cloud is interactive immediately, then chip
	// counts + font sizes settle to the any-status values once the
	// response lands.
	void refreshCountsViaBulk();
	// Cooccurrence is fetched async too. The initial paint uses the
	// pure popularity spiral; when the response lands, non-persisted
	// chips are re-packed into clusters and the pixi tick eases them
	// from their spiral positions to the new cluster positions.
	void refreshCooccurrence();

	// Empty-state hint when no tags exist.
	if ( terms.length === 0 ) {
		const empty = document.createElement( 'div' );
		empty.className = 'wpd-tagcloud__empty';
		empty.textContent = __(
			'No tags yet. Click "Add tag" to start building the cloud.',
		);
		stage.appendChild( empty );
	}

	// --- Search wiring ------------------------------------------------
	// Case-insensitive substring match on tag name + slug, top 10 by
	// post count. Selecting a result (mouse OR keyboard) delegates to
	// `focusTag` (pan + zoom + sidebar). DOM was created with the
	// toolbar above.
	//
	// Keyboard nav: ArrowDown/ArrowUp move the highlight, Enter
	// activates it, Escape clears. Mouse hover also moves the
	// highlight so keyboard + mouse don't fight.
	//
	// Mousedown (not click) on the result + preventDefault keeps focus
	// on the input — otherwise the button steals focus and the input's
	// own blur fires, which used to race with the click and sometimes
	// hide the dropdown before the click handler ran.
	let currentMatches: TagBox[] = [];
	let selectedIndex = 0;
	const repaintHighlight = (): void => {
		const items = searchResults.querySelectorAll< HTMLButtonElement >(
			'.wpd-tagcloud__search-result',
		);
		items.forEach( ( el, i ) => {
			const active = i === selectedIndex;
			el.classList.toggle( 'is-active', active );
			if ( active ) {
				el.scrollIntoView( { block: 'nearest' } );
			}
		} );
	};
	const selectMatch = ( t: TagBox ): void => {
		searchInput.value = '';
		searchResults.hidden = true;
		searchResults.replaceChildren();
		currentMatches = [];
		selectedIndex = 0;
		void focusTag( t.id );
	};
	const renderSearchResults = (): void => {
		const q = searchInput.value.trim().toLowerCase();
		if ( q.length === 0 ) {
			searchResults.hidden = true;
			searchResults.replaceChildren();
			currentMatches = [];
			selectedIndex = 0;
			return;
		}
		currentMatches = Array.from( tags.values() )
			.filter(
				( t ) =>
					t.name.toLowerCase().includes( q ) ||
					t.slug.toLowerCase().includes( q ),
			)
			.sort( ( a, b ) => b.count - a.count )
			.slice( 0, 10 );
		selectedIndex = 0;
		searchResults.replaceChildren();
		currentMatches.forEach( ( t, i ) => {
			const li = document.createElement( 'li' );
			const btn = document.createElement( 'button' );
			btn.type = 'button';
			btn.className = 'wpd-tagcloud__search-result';
			if ( i === 0 ) {
				btn.classList.add( 'is-active' );
			}
			const nameEl = document.createElement( 'span' );
			nameEl.className = 'wpd-tagcloud__search-title';
			nameEl.textContent = t.name || `#${ t.id }`;
			const countEl = document.createElement( 'span' );
			countEl.className = 'wpd-tagcloud__search-meta';
			countEl.textContent = sprintf(
				/* translators: %d: number of posts assigned to a tag. */
				__( '%d posts' ),
				t.count,
			);
			btn.appendChild( nameEl );
			btn.appendChild( countEl );
			btn.addEventListener( 'mousedown', ( ev ) => {
				ev.preventDefault();
				selectMatch( t );
			} );
			btn.addEventListener( 'mouseenter', () => {
				selectedIndex = i;
				repaintHighlight();
			} );
			li.appendChild( btn );
			searchResults.appendChild( li );
		} );
		searchResults.hidden = currentMatches.length === 0;
	};
	searchInput.addEventListener( 'input', renderSearchResults );
	searchInput.addEventListener( 'focus', renderSearchResults );
	searchInput.addEventListener( 'keydown', ( ev ) => {
		if ( ev.key === 'ArrowDown' ) {
			if ( currentMatches.length === 0 ) {
				return;
			}
			ev.preventDefault();
			selectedIndex = Math.min(
				selectedIndex + 1,
				currentMatches.length - 1,
			);
			repaintHighlight();
		} else if ( ev.key === 'ArrowUp' ) {
			if ( currentMatches.length === 0 ) {
				return;
			}
			ev.preventDefault();
			selectedIndex = Math.max( selectedIndex - 1, 0 );
			repaintHighlight();
		} else if ( ev.key === 'Enter' ) {
			if ( currentMatches.length === 0 ) {
				return;
			}
			ev.preventDefault();
			selectMatch( currentMatches[ selectedIndex ] );
		} else if ( ev.key === 'Escape' ) {
			searchInput.value = '';
			searchResults.hidden = true;
			searchResults.replaceChildren();
			currentMatches = [];
			selectedIndex = 0;
		}
	} );
	searchInput.addEventListener( 'blur', () => {
		// Delayed so any mousedown on a result still fires its handler
		// before the dropdown vanishes. Mousedown+preventDefault keeps
		// focus on the input so this blur normally won't even fire on
		// result clicks, but this remains the dismiss path for "click
		// somewhere else / tab away".
		setTimeout( () => {
			searchResults.hidden = true;
		}, 120 );
	} );
	const onDocClickSearch = ( ev: Event ): void => {
		if ( ! searchWrap.contains( ev.target as Node ) ) {
			searchResults.hidden = true;
		}
	};
	document.addEventListener( 'click', onDocClickSearch );

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
		document.removeEventListener( 'click', onDocClickSearch );
		try {
			app.destroy( true, { children: true, texture: true } );
		} catch {
			// pixi 8 destroy quirks; ignore.
		}
		host.replaceChildren();
		host.classList.remove( 'wpd-tagcloud' );
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fontSizeFor( count: number, max: number ): number {
	// sqrt() compresses the high tail so a single 1000-post tag
	// doesn't dwarf everything else; matches the disc-radius mapping
	// used by Categories so the two surfaces feel related.
	const ratio = Math.sqrt( count / Math.max( 1, max ) );
	return Math.round(
		MIN_FONT_SIZE + ( MAX_FONT_SIZE - MIN_FONT_SIZE ) * ratio,
	);
}

function truncateChipName( name: string ): string {
	return name.length > CHIP_NAME_MAX_CHARS
		? name.slice( 0, CHIP_NAME_MAX_CHARS - 1 ) + '…'
		: name;
}

function aabbIntersect(
	a: { x: number; y: number; w: number; h: number },
	b: { x: number; y: number; w: number; h: number },
): boolean {
	return (
		a.x < b.x + b.w &&
		a.x + a.w > b.x &&
		a.y < b.y + b.h &&
		a.y + a.h > b.y
	);
}

/**
 * Stable per-slug hash. Plain modular accumulator (no bitwise ops so
 * the lint rule that bans `|`/`&`/`>>>` stays happy) — the modulus
 * 2^31 keeps the running value safely below the IEEE-754 53-bit mantissa
 * limit so multiplication stays exact across long slugs.
 */
function slugHash( slug: string ): number {
	let h = 0;
	for ( let i = 0; i < slug.length; i++ ) {
		h = ( h * 31 + slug.charCodeAt( i ) ) % 2147483647;
	}
	return h;
}

/**
 * Stable per-slug hue so a tag always paints the same colour across
 * sessions. Offsets from the admin theme hue so the cloud stays in
 * the same colour family as the rest of the shell.
 */
function tagHue( slug: string, baseHue: number ): number {
	const h = slugHash( slug );
	return ( ( ( baseHue + ( h % 256 ) * 1.4 ) % 360 ) + 360 ) % 360;
}

/**
 * Tiny per-slug rotation so the cloud reads as a hand-arranged sticker
 * wall instead of an axis-aligned tile grid. Returns radians in the
 * range ~[-3°, +3°] — enough texture to be felt, not enough to make
 * the labels hard to read.
 */
function tagRotation( slug: string ): number {
	const h = slugHash( slug );
	const sign = h % 2 === 0 ? -1 : 1;
	const mag = ( Math.floor( h / 2 ) % 4 ) * 0.011; // 0, 0.011, 0.022, 0.033 rad
	return sign * mag;
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

async function fetchShellJson(
	client: PostsWindowClient,
	url: string,
): Promise< ShellJsonResponse > {
	const cfg = client.getConfig();
	const init: RequestInit = {
		method: 'GET',
		credentials: 'same-origin',
		headers: {
			'X-WP-Nonce': cfg.restNonce,
			Accept: 'application/json',
		},
	};
	const response = await trackedFetch( url, init, {
		windowId: 'desktop-mode-posts',
	} );
	if ( ! response.ok ) {
		throw new Error( `${ response.status } ${ response.statusText }` );
	}
	const json = await response.json();
	return { json, headers: response.headers };
}

// ---------------------------------------------------------------------------
// localStorage — persist the user's manually-dragged chip positions.
// Scoped per-site (location.host + admin URL prefix) so two WP sites
// in the same browser don't clobber each other.
// ---------------------------------------------------------------------------

interface PersistedPosition {
	x: number;
	y: number;
}

function computePositionsKey(): string {
	try {
		const host = window.location.host || 'unknown';
		const path = window.location.pathname.replace( /\/?wp-admin\/?.*$/, '' );
		return `wpd-tagcloud-positions:${ host }${ path }`;
	} catch {
		return 'wpd-tagcloud-positions:fallback';
	}
}

function readPersistedPositions(
	key: string,
): Map< number, PersistedPosition > {
	try {
		const raw = window.localStorage.getItem( key );
		if ( ! raw ) {
			return new Map();
		}
		const parsed = JSON.parse( raw );
		if ( ! parsed || typeof parsed !== 'object' ) {
			return new Map();
		}
		const out = new Map< number, PersistedPosition >();
		for ( const [ k, v ] of Object.entries(
			parsed as Record< string, unknown >,
		) ) {
			const id = parseInt( k, 10 );
			if ( ! Number.isFinite( id ) ) {
				continue;
			}
			const pos = v as { x?: unknown; y?: unknown };
			if (
				typeof pos?.x === 'number' &&
				typeof pos?.y === 'number'
			) {
				out.set( id, { x: pos.x, y: pos.y } );
			}
		}
		return out;
	} catch {
		return new Map();
	}
}

function writePersistedPositions(
	key: string,
	positions: Map< number, PersistedPosition >,
): void {
	try {
		const obj: Record< string, PersistedPosition > = {};
		for ( const [ id, pos ] of positions ) {
			obj[ String( id ) ] = pos;
		}
		window.localStorage.setItem( key, JSON.stringify( obj ) );
	} catch {
		// localStorage may be disabled (incognito quotas, host policy);
		// silently lose the persistence rather than throw.
	}
}

// ---------------------------------------------------------------------------
// Chip factory — kept outside the mount closure so the type signature
// is plain and the mount function stays focused on state + glue.
// ---------------------------------------------------------------------------

function createTagChip(
	pixi: PixiNamespace,
	chipLayer: PixiContainer,
	term: TermRow,
	fontSize: number,
	hue: number,
): TagChip {
	const container = new pixi.Container();
	container.eventMode = 'static';
	container.cursor = 'pointer';

	const shadow = new pixi.Graphics();
	container.addChild( shadow );
	const bg = new pixi.Graphics();
	container.addChild( bg );

	const hashText = new pixi.Text( {
		text: '#',
		style: {
			fill: hslToInt( hue, 65, 42 ),
			fontSize,
			fontFamily: FONT_FAMILY,
			fontWeight: '700',
		},
		resolution: CHIP_TEXT_RES,
	} );
	container.addChild( hashText );

	const nameText = new pixi.Text( {
		text: truncateChipName( term.name ),
		style: {
			fill: 0x1d2327,
			fontSize,
			fontFamily: FONT_FAMILY,
			fontWeight: '600',
		},
		resolution: CHIP_TEXT_RES,
	} );
	container.addChild( nameText );

	const countText = new pixi.Text( {
		text: String( term.count ),
		style: {
			fill: 0xffffff,
			fontSize: Math.max( 10, Math.round( fontSize * 0.55 ) ),
			fontFamily: FONT_FAMILY,
			fontWeight: '700',
		},
		resolution: CHIP_TEXT_RES,
	} );
	container.addChild( countText );

	chipLayer.addChild( container );

	return {
		container,
		shadow,
		bg,
		hashText,
		nameText,
		countText,
		width: 0,
		height: 0,
		cachedName: '',
		cachedCount: -1,
		cachedFocused: false,
		cachedHover: false,
		cachedHue: -1,
	};
}
