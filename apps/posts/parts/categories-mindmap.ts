/**
 * Posts app — the Categories tab: a Pixi-driven mind map.
 *
 * Pure Pixi render: discs, edges, name + count chips and post chips
 * all live inside the world container, so they zoom and pan
 * sub-pixel-smoothly with the wheel. Chip text is counter-scaled so
 * labels stay readable at any zoom. The sidebar editor is HTML
 * (`mindmap-sidebar.ts`) — native form inputs are the right tool there.
 *
 * Interactions:
 *   - **Click** a node → focus: the disc is haloed, satellite post
 *     chips animate out from its centre (10 per page, ◀ ▶ paginate),
 *     the sidebar edits it, everything else dims.
 *   - **Drag** a node onto another → reparent (REST update).
 *   - **Drag** empty canvas → pan; **wheel** → zoom.
 *   - **Add root category** / **+ Child** → a draft form in the sidebar.
 *   - **Click empty space** → close the focus.
 *
 * @public
 */

import { __ } from '../../../src/i18n';
import type { CanvasEnv } from './app';
import {
	POST_RING_RADIUS,
	createCamera,
	createInteraction,
	isEmptyCanvasClick,
	stopBubble,
	watchStageSize,
	type Bounds,
} from './canvas/camera';
import { buildCanvasChrome, wireCanvasSearch } from './canvas/chrome';
import {
	FONT_FAMILY,
	createPixiApp,
	destroyPixiApp,
	hslToInt,
	loadPixi,
	readAdminThemeHue,
	showToast,
	type PixiContainer,
	type PixiGraphics,
	type PixiNamespace,
	type PixiPoint,
	type PixiText,
} from './canvas/pixi';
import { createPostFan } from './canvas/post-fan';
import { bezierAt, drawCurvedEdge, drawDropTarget, drawNodeDisc, type MindNode } from './mindmap-draw';
import { paintSidebar, type MindmapSidebarHost } from './mindmap-sidebar';
import type { TermRow } from './types';

const PREFIX = 'os-mindmap';
const REPULSION_K = 5500;
const SPRING_K = 0.05;
const SPRING_LEN = 130;
const MIN_RADIUS = 22;
const MAX_RADIUS = 48;
// 4× rasterises every glyph at 4× detail — crisp through the world's
// full zoom range and on HiDPI displays.
const CHIP_TEXT_RES = 4;
const CHIP_NAME_MAX_CHARS = 18;
// The post ring + room for the pager + breathing room, so neighbouring
// discs sit clearly outside the satellite cards.
const SPOTLIGHT_RADIUS = POST_RING_RADIUS + 130;

interface CategoryChip {
	container: PixiContainer;
	bg: PixiGraphics;
	nameText: PixiText;
	countBg: PixiGraphics;
	countText: PixiText;
	cachedName: string;
	cachedCount: number;
	cachedFocused: boolean;
	cachedHover: boolean;
	cachedColor: number;
}

function nodeRadius( count: number, all: TermRow[] ): number {
	const max = Math.max( 1, ...all.map( ( t ) => t.count ) );
	return MIN_RADIUS + ( MAX_RADIUS - MIN_RADIUS ) * Math.sqrt( count / max );
}

function truncateChipName( name: string ): string {
	return name.length > CHIP_NAME_MAX_CHARS ? name.slice( 0, CHIP_NAME_MAX_CHARS - 1 ) + '…' : name;
}

/**
 * Mount the mind map inside `host`. Fetches the category tree on
 * mount; reparents / renames / creates go through REST and are
 * reflected locally. Returns the teardown.
 */
export async function mountCategoriesMindmap( host: HTMLElement, env: CanvasEnv ): Promise< () => void > {
	const loaded = await loadPixi( host, __( 'Mindmap unavailable.' ) );
	if ( ! loaded ) {
		return () => {};
	}
	// A non-null binding the closures below can capture.
	const pixi: PixiNamespace = loaded;
	const { client } = env;
	const chrome = buildCanvasChrome( host, PREFIX, {
		buttons: [
			{ className: `${ PREFIX }__btn ${ PREFIX }__btn--primary`, icon: 'dashicons-plus', label: __( 'Add root category' ) },
			{ className: `${ PREFIX }__btn`, icon: 'dashicons-image-rotate', label: __( 'Recenter' ) },
		],
		searchPlaceholder: __( 'Search categories…' ),
		searchAria: __( 'Search categories in the mindmap' ),
		hint: __( 'Click a node to focus + edit · drag onto another to reparent · wheel to zoom' ),
	} );
	const [ addRootBtn, recenterBtn ] = chrome.buttons;
	const { stage, sidebar } = chrome;

	// --- Pixi --------------------------------------------------------
	const { app, world } = await createPixiApp( pixi, stage, `${ PREFIX }__canvas` );
	const edgeLayer = new pixi.Container();
	const nodeLayer = new pixi.Container();
	const postEdgeLayer = new pixi.Container();
	const postLayer = new pixi.Container();
	// Chip layers sit ABOVE the discs so text stays readable when the
	// discs are dense; all inherit the world's pan/zoom.
	const chipLayer = new pixi.Container();
	const postChipLayer = new pixi.Container();
	for ( const layer of [ edgeLayer, postEdgeLayer, postLayer, nodeLayer, chipLayer, postChipLayer ] ) {
		world.addChild( layer );
	}
	const edgeGfx = new pixi.Graphics();
	edgeLayer.addChild( edgeGfx );
	const postEdgeGfx = new pixi.Graphics();
	postEdgeLayer.addChild( postEdgeGfx );

	// --- State --------------------------------------------------------
	const interaction = createInteraction();
	const camera = createCamera( world, stage );
	const nodes = new Map< number, MindNode >();
	const chips = new Map< number, CategoryChip >();
	let dragNode: MindNode | null = null;
	let dragHover: MindNode | null = null;
	let dragStartPos: PixiPoint | null = null;
	let dragOffset: PixiPoint = { x: 0, y: 0 };
	let raf: number | null = null;
	let lastTick = performance.now();
	// "Spotlight" keep-out zone around the focused node: the physics
	// tick repels the other nodes away from the post ring.
	let nudgeAwayFrom: { x: number; y: number; radius: number } | null = null;
	// Pinned roots ignore the physics term, so their targets are moved
	// directly for the spotlight and restored from here on close.
	const pinnedTargetBackup = new Map< number, { tx: number; ty: number } >();
	// The view before the FIRST deploy of a focus session, restored on
	// close; switching between nodes keeps the original.
	let prevView: { scale: number; x: number; y: number } | null = null;
	let draft: { parent: number } | null = null;
	let terms: TermRow[] = [];

	const themeHue = readAdminThemeHue();
	const clusterColor = ( idx: number ): number => hslToInt( ( themeHue + idx * 47 ) % 360, 55, 52 );

	const fan = createPostFan( {
		pixi,
		postLayer,
		postChipLayer,
		postEdgeGfx,
		env,
		param: 'categories',
		interaction,
		chipFontSize: 14,
		chipTextRes: CHIP_TEXT_RES,
		pagerLabelSize: 14,
		pagerGlyphSize: 16,
		pagerTextRes: CHIP_TEXT_RES,
		getCenter: ( id ) => {
			const n = nodes.get( id );
			return n ? { x: n.x, y: n.y, tone: n.color } : null;
		},
		onCountReconciled: ( termId, total ) => {
			const node = nodes.get( termId );
			if ( node && node.count !== total ) {
				node.count = total;
				terms = terms.map( ( t ) => ( t.id === node.id ? { ...t, count: total } : t ) );
				layoutChip( ensureChip( node ), node );
			}
		},
		onOpenPost: () => closeFocus(),
	} );

	// --- Data --------------------------------------------------------
	try {
		const all: TermRow[] = [];
		let page = 1;
		while ( page <= 5 ) {
			const res = await client.fetchTerms( 'categories', { page, perPage: 100 } );
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

	function isUncategorized( term: TermRow ): boolean {
		// `openstation_is_default` reads `default_category`, which works
		// on any locale; the id / slug / name match is the fallback.
		return term.isDefault || term.id === 1 || term.slug === 'uncategorized' || term.name.toLowerCase() === 'uncategorized';
	}

	// "No custom categories yet" over the stage while only Uncategorized
	// exists; removed the moment a real category lands.
	function syncEmptyHint(): void {
		const existing = stage.querySelector< HTMLElement >( `.${ PREFIX }__empty` );
		if ( terms.length <= 1 ) {
			if ( ! existing ) {
				const empty = document.createElement( 'div' );
				empty.className = `${ PREFIX }__empty`;
				empty.textContent = __( 'No custom categories yet. Click "Add root category" to start branching.' );
				stage.appendChild( empty );
			}
		} else if ( existing ) {
			existing.remove();
		}
	}

	function upsertNode( term: TermRow, facts: { tx: number; ty: number; radius: number; depth: number; color: number; pinned: boolean } ): MindNode {
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
				x: facts.tx,
				y: facts.ty,
				tx: facts.tx,
				ty: facts.ty,
				radius: facts.radius,
				depth: facts.depth,
				color: facts.color,
				gfx,
				pinned: facts.pinned,
			};
			nodeLayer.addChild( gfx );
			// Taps are detected in the stage's pointerup (movement < 2px,
			// no drop target) — binding `pointertap` too double-fired and
			// toggled the focus off in a single click.
			const created = node;
			gfx.on( 'pointerdown', ( e ) => onNodePointerDown( e, created ) );
			nodes.set( term.id, node );
		} else {
			node.parent = term.parent;
			node.name = term.name;
			node.description = term.description;
			node.count = term.count;
			node.depth = facts.depth;
			node.color = facts.color;
			node.radius = facts.radius;
			node.tx = facts.tx;
			node.ty = facts.ty;
			node.pinned = facts.pinned;
		}
		drawNodeDisc( pixi, node, false );
		return node;
	}

	/** Radial layout: targets per node; the tick eases nodes into them. */
	function buildTree(): void {
		const childMap = new Map< number, TermRow[] >();
		for ( const t of terms ) {
			const list = childMap.get( t.parent ) ?? [];
			list.push( t );
			childMap.set( t.parent, list );
		}
		// Uncategorized is the centrepiece — every untagged post drains
		// into it — so it sits at 0,0 outside the radial walk.
		const allRoots = childMap.get( 0 ) ?? [];
		const roots = allRoots.filter( ( r ) => ! isUncategorized( r ) );
		const uncategorized = allRoots.find( isUncategorized );

		const place = ( term: TermRow, depth: number, rootIdx: number, angle: number, angleSpan: number ): void => {
			// More roots → a bigger ring; a centred Uncategorized forces a
			// 140px minimum so a single root never shares 0,0 with it.
			const rootRingByCount = roots.length > 1 ? 110 + roots.length * 28 : 0;
			const rootRing = uncategorized ? Math.max( rootRingByCount, 140 ) : rootRingByCount;
			const baseRadius = depth === 0 ? rootRing : rootRing + 160 + ( depth - 1 ) * 150;
			const color = depth === 0 ? clusterColor( rootIdx ) : nodes.get( term.parent )?.color ?? clusterColor( rootIdx );
			upsertNode( term, {
				tx: baseRadius * Math.cos( angle ),
				ty: baseRadius * Math.sin( angle ),
				radius: nodeRadius( term.count, terms ),
				depth,
				color,
				pinned: depth === 0,
			} );
			const kids = childMap.get( term.id ) ?? [];
			if ( kids.length > 0 ) {
				const sub = angleSpan / kids.length;
				kids.forEach( ( child, i ) => place( child, depth + 1, rootIdx, angle - angleSpan / 2 + sub * ( i + 0.5 ), sub * 0.85 ) );
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
		roots.forEach( ( root, idx ) => place( root, 0, idx, ( ( 2 * Math.PI ) / rootCount ) * idx, ( 2 * Math.PI ) / rootCount ) );
		if ( uncategorized ) {
			upsertNode( uncategorized, { tx: 0, ty: 0, radius: nodeRadius( uncategorized.count, terms ), depth: 0, color: 0x8c8f94, pinned: true } );
		}
		syncEmptyHint();
	}

	function drawEdges(): void {
		edgeGfx.clear();
		for ( const node of nodes.values() ) {
			const parent = node.parent ? nodes.get( node.parent ) : undefined;
			if ( ! parent ) {
				continue;
			}
			// The edge to the CURRENT parent goes dashed + faded while the
			// node is being dragged; while a node is deployed every edge
			// not attached to it dims.
			const isOldLink = dragNode !== null && node === dragNode;
			const isFocusEdge = fan.focusId !== null && ( node.id === fan.focusId || node.parent === fan.focusId );
			const dimMul = fan.focusId !== null && ! isFocusEdge ? 0.35 : 1;
			drawCurvedEdge( edgeGfx, parent.x, parent.y, node.x, node.y, parent.color, isOldLink ? { dashed: true, alpha: 0.28 * dimMul } : { alpha: 0.5 * dimMul } );
		}
		// The preview edge to the drop target: a glow underlay, a
		// marching dashed line, and a pulse travelling along the curve.
		if ( dragNode && dragHover ) {
			const { x: x1, y: y1 } = dragNode;
			const { x: x2, y: y2, color: targetColor } = dragHover;
			drawCurvedEdge( edgeGfx, x1, y1, x2, y2, targetColor, { alpha: 0.22, width: 9 } );
			drawCurvedEdge( edgeGfx, x1, y1, x2, y2, targetColor, {
				alpha: 0.95,
				width: 2.5,
				dashed: true,
				dashStride: 2,
				dashPhase: Math.floor( performance.now() / 70 ),
			} );
			const pt = ( performance.now() % 1300 ) / 1300;
			const dx = x2 - x1;
			const p = bezierAt( pt, x1, y1, x1 + dx * 0.5, y1, x2 - dx * 0.5, y2, x2, y2 );
			edgeGfx.circle( p.x, p.y, 5 );
			edgeGfx.fill( { color: 0xffffff, alpha: 0.95 } );
			edgeGfx.stroke( { color: targetColor, width: 2, alpha: 1 } );
		}
		fan.drawEdges();
	}

	// --- Chips (in-world, counter-scaled) ----------------------------
	function ensureChip( node: MindNode ): CategoryChip {
		const existing = chips.get( node.id );
		if ( existing ) {
			return existing;
		}
		const container = new pixi.Container();
		container.eventMode = 'static';
		container.cursor = 'pointer';
		const bg = new pixi.Graphics();
		const nameText = new pixi.Text( {
			text: truncateChipName( node.name ),
			style: { fill: 0x1d2327, fontSize: 14, fontFamily: FONT_FAMILY, fontWeight: '600' },
			resolution: CHIP_TEXT_RES,
		} );
		const countBg = new pixi.Graphics();
		const countText = new pixi.Text( {
			text: String( node.count ),
			style: { fill: 0xffffff, fontSize: 12, fontFamily: FONT_FAMILY, fontWeight: '700' },
			resolution: CHIP_TEXT_RES,
		} );
		container.addChild( bg );
		container.addChild( nameText );
		container.addChild( countBg );
		container.addChild( countText );
		const chip: CategoryChip = {
			container,
			bg,
			nameText,
			countBg,
			countText,
			cachedName: '',
			cachedCount: -1,
			cachedFocused: false,
			cachedHover: false,
			cachedColor: -1,
		};
		chips.set( node.id, chip );
		chipLayer.addChild( container );
		container.on( 'pointerdown', ( e ) => stopBubble( interaction, e ) );
		container.on( 'pointertap', () => void focusNode( node.id ) );
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
		const focused = fan.focusId === node.id;
		const displayName = truncateChipName( node.name );
		const countStr = String( node.count );
		// Pixi.Text re-rasterises on assignment — only when changed.
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
		const nameW = chip.nameText.width;
		const nameH = chip.nameText.height;
		const countW = chip.countText.width;
		const countH = chip.countText.height;
		const badgeW = Math.max( 18, countW + countPadX * 2 );
		const badgeH = countH + countPadY * 2;
		const totalW = padX + nameW + gap + badgeW + padX;
		const totalH = Math.max( nameH, badgeH ) + padY * 2;
		// Anchor: top-centre at the container origin, placed at the
		// disc's bottom-centre.
		const left = -totalW / 2;
		chip.bg.clear();
		chip.bg.roundRect( left, 0, totalW, totalH, totalH / 2 );
		if ( focused ) {
			chip.bg.fill( node.color );
		} else if ( chip.cachedHover ) {
			chip.bg.fill( { color: 0xffffff, alpha: 0.96 } );
			chip.bg.stroke( { color: node.color, width: 1.5, alpha: 1 } );
		} else {
			chip.bg.fill( { color: 0xffffff, alpha: 0.88 } );
			chip.bg.stroke( { color: 0x000000, width: 1, alpha: 0.06 } );
		}
		chip.nameText.x = left + padX;
		chip.nameText.y = ( totalH - nameH ) / 2;
		chip.nameText.style.fill = focused ? 0xffffff : 0x1d2327;
		const badgeX = left + padX + nameW + gap;
		const badgeY = ( totalH - badgeH ) / 2;
		chip.countBg.clear();
		chip.countBg.roundRect( badgeX, badgeY, badgeW, badgeH, badgeH / 2 );
		chip.countBg.fill( focused ? { color: 0xffffff, alpha: 0.25 } : node.color );
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

	/**
	 * Per frame: prune dead chips, position the live ones (counter-
	 * scaled so their on-screen size is constant at any zoom), dim the
	 * unfocused branches while a node is deployed, and relayout any
	 * chip whose cached facts diverged from its node.
	 */
	function syncChipPositions(): void {
		for ( const id of [ ...chips.keys() ] ) {
			if ( ! nodes.has( id ) ) {
				destroyChip( id );
			}
		}
		const chipCounterScale = 1 / Math.max( 0.01, world.scale.x );
		const anyFocus = fan.focusId !== null;
		for ( const node of nodes.values() ) {
			const chip = ensureChip( node );
			chip.container.x = node.x;
			chip.container.y = node.y + node.radius + 6;
			chip.container.scale.set( chipCounterScale );
			const focused = fan.focusId === node.id;
			const targetAlpha = ! anyFocus || focused ? 1 : 0.4;
			for ( const target of [ chip.container, node.gfx ] ) {
				if ( Math.abs( target.alpha - targetAlpha ) > 0.005 ) {
					target.alpha += ( targetAlpha - target.alpha ) * 0.18;
				} else {
					target.alpha = targetAlpha;
				}
			}
			if (
				chip.cachedName !== truncateChipName( node.name ) ||
				chip.cachedCount !== node.count ||
				chip.cachedFocused !== focused ||
				chip.cachedColor !== node.color
			) {
				layoutChip( chip, node );
			}
		}
		fan.syncChips( chipCounterScale );
	}

	// --- Force simulation --------------------------------------------
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
			// Spotlight nudge: a strong outward impulse while inside the
			// keep-out zone, nothing outside it.
			if ( nudgeAwayFrom && a.id !== fan.focusId ) {
				const ndx = a.x - nudgeAwayFrom.x;
				const ndy = a.y - nudgeAwayFrom.y;
				const nd = Math.sqrt( ndx * ndx + ndy * ndy ) || 1;
				const limit = nudgeAwayFrom.radius + a.radius;
				if ( nd < limit ) {
					const pushK = 18;
					fx += ( ndx / nd ) * pushK * ( limit - nd );
					fy += ( ndy / nd ) * pushK * ( limit - nd );
				}
			}
			if ( a !== dragNode ) {
				// Physics eased over dt, blended with a gentle pull toward
				// the radial slot.
				a.x += fx * dt * 0.001 + ( a.tx - a.x ) * 0.02;
				a.y += fy * dt * 0.001 + ( a.ty - a.y ) * 0.02;
			}
			a.gfx.x = a.x;
			a.gfx.y = a.y;
		}
	}

	/** Converge while the stage is still hidden, then lock the equilibrium in as the targets. */
	function preSettlePhysics( iterations: number ): void {
		for ( let i = 0; i < iterations; i++ ) {
			physicsStep( 16 );
		}
		for ( const n of nodes.values() ) {
			n.tx = n.x;
			n.ty = n.y;
		}
	}

	function tick(): void {
		const now = performance.now();
		const dt = Math.min( 50, now - lastTick );
		lastTick = now;
		camera.ease();
		physicsStep( dt );
		fan.ease();
		drawEdges();
		if ( dragNode && dragHover ) {
			drawDropTarget( pixi, dragHover, dragNode.color );
		}
		syncChipPositions();
		raf = requestAnimationFrame( tick );
	}

	// --- Drag / pan --------------------------------------------------
	function onNodePointerDown( e: unknown, node: MindNode ): void {
		const ev = e as { global: PixiPoint };
		stopBubble( interaction, e );
		dragNode = node;
		node.pinned = true;
		node.tx = node.x;
		node.ty = node.y;
		dragStartPos = { x: ev.global.x, y: ev.global.y };
		// Keep the cursor-to-centre offset, so a grab at the edge drags
		// by the edge.
		const local = camera.stageToWorld( ev.global );
		dragOffset = { x: node.x - local.x, y: node.y - local.y };
	}

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

	app.stage.on( 'pointerdown', ( e ) => {
		const ev = e as { global: PixiPoint };
		interaction.panActive = true;
		interaction.panStart = { x: ev.global.x, y: ev.global.y };
		interaction.panMovedDist = 0;
	} );
	app.stage.on( 'pointermove', ( e ) => {
		const ev = e as { global: PixiPoint };
		if ( dragNode ) {
			const cursorWorld = camera.stageToWorld( ev.global );
			const nx = cursorWorld.x + dragOffset.x;
			const ny = cursorWorld.y + dragOffset.y;
			dragNode.x = nx;
			dragNode.y = ny;
			dragNode.tx = nx;
			dragNode.ty = ny;
			dragNode.gfx.x = nx;
			dragNode.gfx.y = ny;
			// Drop where the user POINTS, not where the disc sits.
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
					drawNodeDisc( pixi, dragHover, fan.focusId === dragHover.id );
				}
				dragHover = hover;
				if ( hover ) {
					drawDropTarget( pixi, hover, dragNode.color );
				}
			}
			return;
		}
		if ( interaction.panActive && interaction.panStart ) {
			const dx = ev.global.x - interaction.panStart.x;
			const dy = ev.global.y - interaction.panStart.y;
			camera.pan( dx, dy );
			interaction.panMovedDist += Math.sqrt( dx * dx + dy * dy );
			interaction.panStart = { x: ev.global.x, y: ev.global.y };
		}
	} );
	const onStagePointerUp = async ( e?: unknown ): Promise< void > => {
		if ( dragNode ) {
			const node = dragNode;
			const target = dragHover;
			const startPos = dragStartPos;
			dragNode = null;
			dragHover = null;
			dragStartPos = null;
			node.pinned = node.depth === 0;
			let movement = Infinity;
			const ev = e as { global?: PixiPoint } | undefined;
			if ( startPos && ev?.global ) {
				movement = Math.hypot( ev.global.x - startPos.x, ev.global.y - startPos.y );
			}
			// A tap (≤2px, no drop target) focuses; the threshold is tight
			// so a short real drag never fetches posts.
			if ( ! target && movement < 2 ) {
				void focusNode( node.id );
				interaction.panActive = false;
				interaction.panStart = null;
				return;
			}
			// A cycle only forms when the target is a descendant of the
			// node; the inverse (dragging C onto grandparent A) is a
			// legitimate skip-level move.
			if ( target && target.id !== node.parent && ! isAncestor( node.id, target.id ) ) {
				try {
					await client.updateTerm( 'categories', node.id, { parent: target.id } );
					node.parent = target.id;
					terms = terms.map( ( t ) => ( t.id === node.id ? { ...t, parent: target.id } : t ) );
					buildTree();
				} catch ( err ) {
					showToast( __( 'Reparent failed:' ), err );
				}
			} else {
				drawNodeDisc( pixi, node, fan.focusId === node.id );
				if ( target ) {
					drawNodeDisc( pixi, target, fan.focusId === target.id );
				}
			}
		}
		interaction.panActive = false;
		interaction.panStart = null;
		// `panMovedDist` deliberately survives: the DOM click fires
		// after pointerup and reads it.
	};
	app.stage.on( 'pointerup', ( e ) => void onStagePointerUp( e ) );
	app.stage.on( 'pointerupoutside', ( e ) => void onStagePointerUp( e ) );

	// --- Focus -------------------------------------------------------
	async function focusNode( id: number ): Promise< void > {
		if ( fan.focusId === id ) {
			closeFocus();
			return;
		}
		const wasFocused = fan.focusId !== null;
		fan.focusId = id;
		fan.focusPage = 1;
		interaction.lastFocusChange = performance.now();
		const focused = nodes.get( id );
		if ( focused ) {
			if ( ! wasFocused ) {
				prevView = { scale: camera.targetScale, x: camera.targetWorldX, y: camera.targetWorldY };
			}
			camera.frameOn( focused.x, focused.y );
			nudgeAwayFrom = { x: focused.x, y: focused.y, radius: SPOTLIGHT_RADIUS };
			// Shove the pinned roots inside the zone outward; restored on close.
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
		for ( const n of nodes.values() ) {
			drawNodeDisc( pixi, n, fan.focusId === n.id );
		}
		paintSidebar( sidebarHost );
		await fan.load();
	}

	function closeFocus(): void {
		fan.focusId = null;
		interaction.lastFocusChange = performance.now();
		fan.invalidate();
		nudgeAwayFrom = null;
		for ( const [ id, t ] of pinnedTargetBackup ) {
			const n = nodes.get( id );
			if ( n ) {
				n.tx = t.tx;
				n.ty = t.ty;
			}
		}
		pinnedTargetBackup.clear();
		if ( prevView ) {
			camera.targetScale = prevView.scale;
			camera.targetWorldX = prevView.x;
			camera.targetWorldY = prevView.y;
			prevView = null;
		}
		paintSidebar( sidebarHost );
		fan.clear();
		for ( const n of nodes.values() ) {
			drawNodeDisc( pixi, n, false );
		}
	}

	const sidebarHost: MindmapSidebarHost = {
		sidebar,
		client,
		terms: () => terms,
		setTerms: ( next ) => {
			terms = next;
		},
		node: ( id ) => nodes.get( id ),
		focusId: () => fan.focusId,
		setFocus: ( id ) => {
			fan.focusId = id;
		},
		draft: () => draft,
		setDraft: ( next ) => {
			// A draft under a node that no longer exists is refused.
			draft = next && next.parent !== 0 && ! nodes.get( next.parent ) ? draft : next;
		},
		clusterColor,
		buildTree,
		relayoutNode: ( id ) => {
			const n = nodes.get( id );
			if ( n ) {
				layoutChip( ensureChip( n ), n );
			}
		},
		clearPosts: () => fan.clear(),
		loadPosts: () => fan.load(),
	};

	// --- Camera ------------------------------------------------------
	function treeBounds(): Bounds | null {
		if ( nodes.size === 0 ) {
			return null;
		}
		// The label row hangs ~30 world-units below each disc.
		const LABEL_OVERHANG = 30;
		const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
		for ( const n of nodes.values() ) {
			b.minX = Math.min( b.minX, n.tx - n.radius );
			b.minY = Math.min( b.minY, n.ty - n.radius );
			b.maxX = Math.max( b.maxX, n.tx + n.radius );
			b.maxY = Math.max( b.maxY, n.ty + n.radius + LABEL_OVERHANG );
		}
		return b;
	}
	function recenterCamera(): void {
		const focused = fan.focusId === null ? undefined : nodes.get( fan.focusId );
		if ( focused && camera.frameOn( focused.x, focused.y ) ) {
			return;
		}
		camera.fitToView( treeBounds(), { animate: true } );
	}
	const unwatch = watchStageSize( pixi, app, stage, {
		onFirstFit: () => camera.fitToView( treeBounds() ),
		onSettle: recenterCamera,
	} );
	recenterBtn.addEventListener( 'click', recenterCamera );
	addRootBtn.addEventListener( 'click', () => {
		draft = { parent: 0 };
		paintSidebar( sidebarHost );
	} );
	app.canvas.addEventListener( 'click', ( e ) => {
		if ( isEmptyCanvasClick( interaction, e, app.canvas ) && ! dragNode && fan.focusId !== null ) {
			closeFocus();
		}
	} );

	// Authoritative counts via the bulk endpoint, in the background —
	// the per-term REST field is sometimes stripped by hosts.
	async function refreshCountsViaBulk(): Promise< void > {
		if ( terms.length === 0 ) {
			return;
		}
		try {
			const map = await client.fetchTermCounts( 'category', terms.map( ( t ) => t.id ) );
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
			// Radii derive from the count ratio — rebuild and reframe.
			if ( dirty ) {
				buildTree();
				camera.fitToView( treeBounds(), { animate: true } );
			}
		} catch {
			// The term-list count stays; the bulk endpoint is a backup.
		}
	}

	// --- Bootstrap ---------------------------------------------------
	buildTree();
	paintSidebar( sidebarHost );
	preSettlePhysics( 80 );
	raf = requestAnimationFrame( tick );
	void refreshCountsViaBulk();
	const unsearch = wireCanvasSearch( chrome, PREFIX, {
		matches: ( q ) => Array.from( nodes.values() ).filter( ( n ) => n.name.toLowerCase().includes( q ) ),
		select: ( n ) => void focusNode( n.id ),
	} );

	return () => {
		if ( raf !== null ) {
			cancelAnimationFrame( raf );
			raf = null;
		}
		unwatch();
		unsearch();
		camera.dispose();
		destroyPixiApp( app, host, PREFIX );
	};
}

