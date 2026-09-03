/**
 * Posts app — the Tags tab: a Pixi-driven tag cloud.
 *
 * Tags are flat, so the metaphor is a sticker wall: each tag is a
 * hashtag pill, its size encodes the post count, a stable per-slug hue
 * and a tiny rotation give the wall its hand-arranged texture. Layout
 * is a deterministic spiral pack sorted by count — popular tags at the
 * centre, the long tail outward — pulled into clusters once the
 * co-occurrence data lands.
 *
 * Interactions:
 *   - **Click** a chip → focus: camera eases in, other chips dim and
 *     push outward, posts fan radially (10 per page, ◀ ▶ paginate), the
 *     sidebar edits it.
 *   - **Drag** a chip → reposition (persisted per site to localStorage).
 *   - **Drag** empty canvas → pan; **wheel** → cursor-anchored zoom.
 *   - **Add tag** → a draft form; **Reflow** → repack from scratch.
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
import {
	computePositionsKey,
	fontSizeFor,
	packBoxesWithClusters,
	readPersistedPositions,
	tagHue,
	tagRotation,
	truncateChipName,
	writePersistedPositions,
	type Aabb,
} from './cloud-layout';
import { paintSidebar, type CloudSidebarHost } from './cloud-sidebar';
import type { TermNeighbor, TermRow } from './types';

const PREFIX = 'os-tagcloud';
const CHIP_TEXT_RES = 3;
const CHIP_PAD_X = 11;
const CHIP_PAD_Y = 6;
const CHIP_GAP_HASH = 4;
const CHIP_GAP_COUNT = 8;
const SPOTLIGHT_RADIUS = POST_RING_RADIUS + 130;

interface TagChip {
	container: PixiContainer;
	shadow: PixiGraphics;
	bg: PixiGraphics;
	hashText: PixiText;
	nameText: PixiText;
	countText: PixiText;
	cachedHover: boolean;
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

function createTagChip( pixi: PixiNamespace, chipLayer: PixiContainer, term: TermRow, fontSize: number, hue: number ): TagChip {
	const container = new pixi.Container();
	container.eventMode = 'static';
	container.cursor = 'pointer';
	const shadow = new pixi.Graphics();
	const bg = new pixi.Graphics();
	const text = ( value: string, fill: number, size: number, weight: string ): PixiText =>
		new pixi.Text( { text: value, style: { fill, fontSize: size, fontFamily: FONT_FAMILY, fontWeight: weight }, resolution: CHIP_TEXT_RES } );
	const hashText = text( '#', hslToInt( hue, 65, 42 ), fontSize, '700' );
	const nameText = text( truncateChipName( term.name ), 0x1d2327, fontSize, '600' );
	const countText = text( String( term.count ), 0xffffff, Math.max( 10, Math.round( fontSize * 0.55 ) ), '700' );
	for ( const child of [ shadow, bg, hashText, nameText, countText ] ) {
		container.addChild( child );
	}
	chipLayer.addChild( container );
	return { container, shadow, bg, hashText, nameText, countText, cachedHover: false };
}

/**
 * Mount the tag cloud inside `host`. Fetches the tag list on mount;
 * renames / creates / deletes go through REST and are reflected
 * locally. Returns the teardown.
 */
export async function mountTagsCloud( host: HTMLElement, env: CanvasEnv ): Promise< () => void > {
	const loaded = await loadPixi( host, __( 'Tag cloud unavailable.' ) );
	if ( ! loaded ) {
		return () => {};
	}
	// A non-null binding the closures below can capture.
	const pixi: PixiNamespace = loaded;
	const { client } = env;
	const chrome = buildCanvasChrome( host, PREFIX, {
		buttons: [
			{ className: `${ PREFIX }__btn ${ PREFIX }__btn--primary`, icon: 'dashicons-plus', label: __( 'Add tag' ) },
			{ className: `${ PREFIX }__btn`, icon: 'dashicons-image-rotate', label: __( 'Recenter' ) },
			{
				className: `${ PREFIX }__btn`,
				icon: 'dashicons-grid-view',
				label: __( 'Reflow' ),
				title: __( 'Recompute the chip layout from scratch — discards manual repositioning.' ),
			},
		],
		searchPlaceholder: __( 'Search tags…' ),
		searchAria: __( 'Search tags in the cloud' ),
		hint: __( 'Click a tag to focus + edit · drag to reposition · wheel to zoom' ),
	} );
	const [ addTagBtn, recenterBtn, reflowBtn ] = chrome.buttons;
	const { stage, sidebar } = chrome;

	// --- Pixi --------------------------------------------------------
	const { app, world } = await createPixiApp( pixi, stage, `${ PREFIX }__canvas` );
	// Back to front: post edges → tag pills → post markers → post chips.
	const chipLayer = new pixi.Container();
	const postEdgeLayer = new pixi.Container();
	const postLayer = new pixi.Container();
	const postChipLayer = new pixi.Container();
	for ( const layer of [ postEdgeLayer, chipLayer, postLayer, postChipLayer ] ) {
		world.addChild( layer );
	}
	const postEdgeGfx = new pixi.Graphics();
	postEdgeLayer.addChild( postEdgeGfx );

	// --- State --------------------------------------------------------
	const interaction = createInteraction();
	const camera = createCamera( world, stage );
	const tags = new Map< number, TagBox >();
	let dragChip: TagBox | null = null;
	let dragOffset: PixiPoint = { x: 0, y: 0 };
	let dragStart: PixiPoint | null = null;
	let raf: number | null = null;
	let lastTick = performance.now();
	let nudgeAwayFrom: { x: number; y: number; radius: number } | null = null;
	let prevView: { scale: number; x: number; y: number } | null = null;
	let draft = false;
	let terms: TermRow[] = [];
	const positionsKey = computePositionsKey();
	const persistedPositions = readPersistedPositions( positionsKey );
	// tag id → co-occurring siblings; empty until the fetch lands, and
	// then the packer becomes cluster-aware.
	let cooccurrenceMap: Map< number, TermNeighbor[] > = new Map();
	const themeHue = readAdminThemeHue();

	const fan = createPostFan( {
		pixi,
		postLayer,
		postChipLayer,
		postEdgeGfx,
		env,
		param: 'tags',
		interaction,
		chipFontSize: 12,
		chipTextRes: CHIP_TEXT_RES,
		pagerLabelSize: 12,
		pagerGlyphSize: 14,
		getCenter: ( id ) => {
			const box = tags.get( id );
			return box ? { x: box.x, y: box.y, tone: hslToInt( box.hue, 70, 48 ) } : null;
		},
		onCountReconciled: ( termId, total ) => {
			const box = tags.get( termId );
			if ( box && box.count !== total ) {
				box.count = total;
				terms = terms.map( ( t ) => ( t.id === box.id ? { ...t, count: total } : t ) );
				layoutChip( box );
			}
		},
		onOpenPost: () => closeFocus(),
	} );

	// --- Data --------------------------------------------------------
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

	function buildCloud(): void {
		const liveIds = new Set( terms.map( ( t ) => t.id ) );
		for ( const [ id, box ] of tags ) {
			if ( ! liveIds.has( id ) ) {
				chipLayer.removeChild( box.chip.container );
				box.chip.container.destroy( { children: true } );
				tags.delete( id );
			}
		}
		// Sizes against the population max, so the dynamic range is the
		// same at any tag count.
		const maxCount = Math.max( 1, ...terms.map( ( t ) => t.count ) );
		// Existing boxes keep their positions; new terms enter cold and
		// are spiral-packed below.
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
				continue;
			}
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
				x: persisted?.x ?? 0,
				y: persisted?.y ?? 0,
				tx: persisted?.x ?? 0,
				ty: persisted?.y ?? 0,
				width: 0,
				height: 0,
				chip: createTagChip( pixi, chipLayer, term, fontSize, hue ),
			};
			tags.set( term.id, box );
			layoutChip( box );
			wireChipPointer( box );
			if ( ! persisted ) {
				fresh.push( box );
			}
		}
		const placed: Aabb[] = [];
		const placedById = new Map< number, { x: number; y: number } >();
		for ( const box of tags.values() ) {
			if ( ! fresh.includes( box ) ) {
				placed.push( { x: box.tx - box.width / 2, y: box.ty - box.height / 2, w: box.width, h: box.height } );
				placedById.set( box.id, { x: box.tx, y: box.ty } );
			}
		}
		fresh.sort( ( a, b ) => b.count - a.count );
		packBoxesWithClusters( fresh, placed, placedById, cooccurrenceMap );
		for ( const box of fresh ) {
			// Fresh chips paint at their slot instead of easing from 0,0.
			box.x = box.tx;
			box.y = box.ty;
		}
	}

	function wireChipPointer( box: TagBox ): void {
		const c = box.chip.container;
		c.on( 'pointerdown', ( e ) => {
			const ev = e as { global: PixiPoint };
			stopBubble( interaction, e );
			dragChip = box;
			dragStart = { x: ev.global.x, y: ev.global.y };
			const local = camera.stageToWorld( ev.global );
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

	/** Measure the chip for its intrinsic font size, then paint it. */
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
		// The size IS the reading — most-used tags look biggest.
		chip.nameText.style.fontSize = box.fontSize;
		chip.hashText.style.fontSize = box.fontSize;
		chip.countText.style.fontSize = Math.max( 10, Math.round( box.fontSize * 0.55 ) );
		const nameH = chip.nameText.height;
		const countBadgeW = Math.max( 18, chip.countText.width + 10 );
		const countBadgeH = Math.max( 14, chip.countText.height + 4 );
		box.width = CHIP_PAD_X + chip.hashText.width + CHIP_GAP_HASH + chip.nameText.width + CHIP_GAP_COUNT + countBadgeW + CHIP_PAD_X;
		box.height = Math.max( nameH, countBadgeH ) + CHIP_PAD_Y * 2;
		paintChip( box );
	}

	function paintChip( box: TagBox ): void {
		const chip = box.chip;
		const focused = fan.focusId === box.id;
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
		const borderColor = focused ? hslToInt( box.hue, 70, 38 ) : hslToInt( box.hue, 50, 70 );
		const countBg = focused ? hslToInt( box.hue, 80, 30 ) : hslToInt( box.hue, 70, 50 );

		// A soft drop shadow — paper stickers pinned to a corkboard.
		chip.shadow.clear();
		chip.shadow.roundRect( left - 1, top + 3, totalW + 2, totalH + 2, radius + 1 );
		let shadowAlpha = 0.1;
		if ( focused ) {
			shadowAlpha = 0.18;
		} else if ( chip.cachedHover ) {
			shadowAlpha = 0.16;
		}
		chip.shadow.fill( { color: 0x000000, alpha: shadowAlpha } );
		chip.bg.clear();
		chip.bg.roundRect( left, top, totalW, totalH, radius );
		chip.bg.fill( fillBg );
		chip.bg.stroke( { color: borderColor, width: focused ? 2 : 1.25, alpha: focused ? 1 : 0.85 } );

		const hashW = chip.hashText.width;
		const nameW = chip.nameText.width;
		const nameH = chip.nameText.height;
		const countW = chip.countText.width;
		const countH = chip.countText.height;
		const countBadgeW = Math.max( 18, countW + 10 );
		const countBadgeH = Math.max( 14, countH + 4 );
		chip.hashText.x = left + CHIP_PAD_X;
		chip.hashText.y = ( totalH - nameH ) / 2 + top;
		chip.hashText.style.fill = focused ? 0xffffff : hslToInt( box.hue, 65, 42 );
		chip.nameText.x = left + CHIP_PAD_X + hashW + CHIP_GAP_HASH;
		chip.nameText.y = ( totalH - nameH ) / 2 + top;
		chip.nameText.style.fill = focused ? 0xffffff : 0x1d2327;
		const badgeX = left + CHIP_PAD_X + hashW + CHIP_GAP_HASH + nameW + CHIP_GAP_COUNT;
		const badgeY = ( totalH - countBadgeH ) / 2 + top;
		// The count badge is a second roundRect on bg with its own fill.
		chip.bg.roundRect( badgeX, badgeY, countBadgeW, countBadgeH, countBadgeH / 2 );
		chip.bg.fill( countBg );
		chip.countText.x = badgeX + ( countBadgeW - countW ) / 2;
		chip.countText.y = badgeY + ( countBadgeH - countH ) / 2;
		chip.countText.style.fill = 0xffffff;
	}

	// --- Per frame ---------------------------------------------------
	function syncChipPositions(): void {
		const chipCounterScale = 1 / Math.max( 0.01, world.scale.x );
		const anyFocus = fan.focusId !== null;
		for ( const box of tags.values() ) {
			const c = box.chip.container;
			c.x = box.x;
			c.y = box.y;
			// Counter-scale only when zoomed OUT: zoomed in, the intrinsic
			// font sizes ARE the reading.
			c.scale.set( Math.max( 1, chipCounterScale ) );
			c.rotation = box.rotation;
			const targetAlpha = ! anyFocus || fan.focusId === box.id ? 1 : 0.32;
			if ( Math.abs( c.alpha - targetAlpha ) > 0.005 ) {
				c.alpha += ( targetAlpha - c.alpha ) * 0.18;
			} else {
				c.alpha = targetAlpha;
			}
		}
		fan.syncChips( chipCounterScale );
	}

	function tick(): void {
		const now = performance.now();
		const dt = Math.min( 50, now - lastTick );
		lastTick = now;
		camera.ease();
		// Chips drift toward their targets (back into place after a
		// drag lifts, out of the spotlight zone while a chip is focused).
		for ( const box of tags.values() ) {
			if ( box === dragChip ) {
				continue;
			}
			let tx = box.tx;
			let ty = box.ty;
			if ( nudgeAwayFrom && box.id !== fan.focusId ) {
				const dx = box.tx - nudgeAwayFrom.x;
				const dy = box.ty - nudgeAwayFrom.y;
				const d = Math.sqrt( dx * dx + dy * dy ) || 1;
				const limit = nudgeAwayFrom.radius + Math.max( box.width, box.height ) / 2;
				if ( d < limit ) {
					const push = limit + 12;
					tx = nudgeAwayFrom.x + ( dx / d ) * push;
					ty = nudgeAwayFrom.y + ( dy / d ) * push;
				}
			}
			const ease = 1 - Math.exp( -dt * 0.012 );
			box.x += ( tx - box.x ) * ease;
			box.y += ( ty - box.y ) * ease;
		}
		fan.ease();
		fan.drawEdges();
		syncChipPositions();
		raf = requestAnimationFrame( tick );
	}

	// --- Stage pointer -----------------------------------------------
	app.stage.on( 'pointerdown', ( e ) => {
		const ev = e as { global: PixiPoint };
		interaction.panActive = true;
		interaction.panStart = { x: ev.global.x, y: ev.global.y };
		interaction.panMovedDist = 0;
	} );
	app.stage.on( 'pointermove', ( e ) => {
		const ev = e as { global: PixiPoint };
		if ( dragChip ) {
			const cursorWorld = camera.stageToWorld( ev.global );
			dragChip.x = cursorWorld.x + dragOffset.x;
			dragChip.y = cursorWorld.y + dragOffset.y;
			dragChip.tx = dragChip.x;
			dragChip.ty = dragChip.y;
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
	const onStagePointerUp = ( e?: unknown ): void => {
		if ( dragChip ) {
			const box = dragChip;
			const startPos = dragStart;
			dragChip = null;
			dragStart = null;
			let movement = Infinity;
			const ev = e as { global?: PixiPoint } | undefined;
			if ( startPos && ev?.global ) {
				movement = Math.hypot( ev.global.x - startPos.x, ev.global.y - startPos.y );
			}
			if ( movement < 3 ) {
				void focusTag( box.id );
			} else {
				persistedPositions.set( box.id, { x: box.tx, y: box.ty } );
				writePersistedPositions( positionsKey, persistedPositions );
			}
		}
		interaction.panActive = false;
		interaction.panStart = null;
	};
	app.stage.on( 'pointerup', onStagePointerUp );
	app.stage.on( 'pointerupoutside', onStagePointerUp );

	// --- Focus -------------------------------------------------------
	async function focusTag( id: number ): Promise< void > {
		if ( fan.focusId === id ) {
			closeFocus();
			return;
		}
		const wasFocused = fan.focusId !== null;
		fan.focusId = id;
		fan.focusPage = 1;
		interaction.lastFocusChange = performance.now();
		const focused = tags.get( id );
		if ( focused ) {
			if ( ! wasFocused ) {
				prevView = { scale: camera.targetScale, x: camera.targetWorldX, y: camera.targetWorldY };
			}
			camera.frameOn( focused.x, focused.y );
			nudgeAwayFrom = { x: focused.x, y: focused.y, radius: SPOTLIGHT_RADIUS };
		}
		for ( const box of tags.values() ) {
			paintChip( box );
		}
		paintSidebar( sidebarHost );
		await fan.load();
	}

	function closeFocus(): void {
		fan.focusId = null;
		interaction.lastFocusChange = performance.now();
		fan.invalidate();
		nudgeAwayFrom = null;
		if ( prevView ) {
			camera.targetScale = prevView.scale;
			camera.targetWorldX = prevView.x;
			camera.targetWorldY = prevView.y;
			prevView = null;
		}
		paintSidebar( sidebarHost );
		fan.clear();
		for ( const box of tags.values() ) {
			paintChip( box );
		}
	}

	const sidebarHost: CloudSidebarHost = {
		sidebar,
		client,
		themeHue,
		terms: () => terms,
		setTerms: ( next ) => {
			terms = next;
		},
		tag: ( id ) => tags.get( id ),
		focusId: () => fan.focusId,
		setFocus: ( id ) => {
			fan.focusId = id;
		},
		draft: () => draft,
		setDraft: ( on ) => {
			draft = on;
		},
		applyTagUpdate: ( id, patch ) => {
			const box = tags.get( id );
			if ( ! box ) {
				return;
			}
			box.name = patch.name;
			box.description = patch.description;
			box.slug = patch.slug;
			// Hue and rotation derive from the slug.
			box.hue = tagHue( box.slug || box.name, themeHue );
			box.rotation = tagRotation( box.slug || box.name );
			layoutChip( box );
		},
		forgetTag: ( id ) => {
			persistedPositions.delete( id );
			writePersistedPositions( positionsKey, persistedPositions );
		},
		buildCloud,
		clearPosts: () => fan.clear(),
		loadPosts: () => fan.load(),
	};

	// --- Camera ------------------------------------------------------
	function cloudBounds(): Bounds | null {
		if ( tags.size === 0 ) {
			return null;
		}
		const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
		for ( const box of tags.values() ) {
			b.minX = Math.min( b.minX, box.tx - box.width / 2 );
			b.minY = Math.min( b.minY, box.ty - box.height / 2 );
			b.maxX = Math.max( b.maxX, box.tx + box.width / 2 );
			b.maxY = Math.max( b.maxY, box.ty + box.height / 2 );
		}
		return b;
	}
	function recenterCamera(): void {
		const focused = fan.focusId === null ? undefined : tags.get( fan.focusId );
		if ( focused && camera.frameOn( focused.x, focused.y ) ) {
			return;
		}
		camera.fitToView( cloudBounds(), { animate: true } );
	}
	const unwatch = watchStageSize( pixi, app, stage, {
		onFirstFit: () => camera.fitToView( cloudBounds() ),
		onSettle: recenterCamera,
	} );
	recenterBtn.addEventListener( 'click', recenterCamera );
	addTagBtn.addEventListener( 'click', () => {
		draft = true;
		paintSidebar( sidebarHost );
	} );
	reflowBtn.addEventListener( 'click', () => {
		// Wipe the persisted positions and repack from scratch with the
		// latest co-occurrence map; chips ease into their new slots.
		persistedPositions.clear();
		writePersistedPositions( positionsKey, persistedPositions );
		for ( const box of tags.values() ) {
			box.tx = 0;
			box.ty = 0;
		}
		const allBoxes = Array.from( tags.values() ).sort( ( a, b ) => b.count - a.count );
		packBoxesWithClusters( allBoxes, [], new Map(), cooccurrenceMap );
		camera.fitToView( cloudBounds(), { animate: true } );
		void refreshCooccurrence();
	} );
	app.canvas.addEventListener( 'click', ( e ) => {
		if ( isEmptyCanvasClick( interaction, e, app.canvas ) && ! dragChip && fan.focusId !== null ) {
			closeFocus();
		}
	} );

	// Authoritative any-status counts via the bulk endpoint; font sizes
	// track the fresh population max, positions stay put.
	async function refreshCountsViaBulk(): Promise< void > {
		if ( terms.length === 0 ) {
			return;
		}
		try {
			const map = await client.fetchTermCounts( 'post_tag', terms.map( ( t ) => t.id ) );
			let dirty = false;
			terms = terms.map( ( t ) => {
				const fresh = map[ String( t.id ) ];
				if ( typeof fresh === 'number' && fresh !== t.count ) {
					dirty = true;
					return { ...t, count: fresh };
				}
				return t;
			} );
			if ( dirty ) {
				const maxCount = Math.max( 1, ...terms.map( ( t ) => t.count ) );
				for ( const t of terms ) {
					const box = tags.get( t.id );
					if ( box ) {
						box.count = t.count;
						box.fontSize = fontSizeFor( t.count, maxCount );
						layoutChip( box );
					}
				}
				if ( fan.focusId !== null ) {
					paintSidebar( sidebarHost );
				}
			}
		} catch {
			// The term-list count stays; the bulk endpoint is a backup.
		}
	}

	// Re-pack every non-persisted chip around the user's dragged ones
	// once co-occurrence data arrives; the tick eases them over.
	function relayoutWithCooccurrence(): void {
		const placed: Aabb[] = [];
		const placedById = new Map< number, { x: number; y: number } >();
		const toRepack: TagBox[] = [];
		for ( const box of tags.values() ) {
			if ( persistedPositions.has( box.id ) ) {
				placed.push( { x: box.tx - box.width / 2, y: box.ty - box.height / 2, w: box.width, h: box.height } );
				placedById.set( box.id, { x: box.tx, y: box.ty } );
			} else {
				toRepack.push( box );
			}
		}
		toRepack.sort( ( a, b ) => b.count - a.count );
		packBoxesWithClusters( toRepack, placed, placedById, cooccurrenceMap );
	}

	async function refreshCooccurrence(): Promise< void > {
		try {
			cooccurrenceMap = await client.fetchTagCooccurrence( 'tags', 8 );
			if ( cooccurrenceMap.size > 0 ) {
				relayoutWithCooccurrence();
			}
		} catch {
			// Non-fatal — the pure spiral stays.
		}
	}

	// --- Bootstrap ---------------------------------------------------
	buildCloud();
	paintSidebar( sidebarHost );
	raf = requestAnimationFrame( tick );
	void refreshCountsViaBulk();
	void refreshCooccurrence();
	if ( terms.length === 0 ) {
		const empty = document.createElement( 'div' );
		empty.className = `${ PREFIX }__empty`;
		empty.textContent = __( 'No tags yet. Click "Add tag" to start building the cloud.' );
		stage.appendChild( empty );
	}
	const unsearch = wireCanvasSearch( chrome, PREFIX, {
		matches: ( q ) =>
			Array.from( tags.values() ).filter( ( t ) => t.name.toLowerCase().includes( q ) || t.slug.toLowerCase().includes( q ) ),
		select: ( t ) => void focusTag( t.id ),
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
