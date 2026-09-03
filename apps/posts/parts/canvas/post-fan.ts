/**
 * Posts app — the satellite post fan both term canvases deploy around
 * a focused node: the paged fetch (with a per-(term, page) cache), the
 * ring of post chips easing out from the centre, the in-world ◀ N / M ▶
 * pager, the radial edges, and the "open this post in a window" door.
 *
 * @public
 */

import { __ } from '../../../../src/i18n';
import type { CanvasEnv } from '../app';
import { POST_RING_RADIUS, stopBubble, type Interaction } from './camera';
import { FONT_FAMILY, showToast, stripTags, type PixiContainer, type PixiGraphics, type PixiNamespace, type PixiText } from './pixi';

export const POST_PER_PAGE = 10;
const POST_TITLE_MAX_CHARS = 22;
const POSTS_CACHE_TTL_MS = 60_000;

export interface PostMini {
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

interface PostChip {
	container: PixiContainer;
	bg: PixiGraphics;
	dot: PixiGraphics;
	titleText: PixiText;
	cachedHover: boolean;
}

interface PostsCacheEntry {
	items: Array< { id: number; title: string; editUrl: string } >;
	totalPages: number;
	realTotal: number;
	fetchedAt: number;
}

export interface PostFanDeps {
	pixi: PixiNamespace;
	postLayer: PixiContainer;
	postChipLayer: PixiContainer;
	postEdgeGfx: PixiGraphics;
	env: CanvasEnv;
	/** The `wp/v2/posts` query param naming the term (`categories` | `tags`). */
	param: 'categories' | 'tags';
	interaction: Interaction;
	/** Chip text size and rasterisation resolution. */
	chipFontSize: number;
	chipTextRes: number;
	pagerLabelSize: number;
	pagerGlyphSize: number;
	pagerTextRes?: number;
	/** The focused node's position + tone, or null when it is gone. */
	getCenter: ( id: number ) => { x: number; y: number; tone: number } | null;
	/** The authoritative `X-WP-Total` landed for a term. */
	onCountReconciled: ( termId: number, total: number ) => void;
	/** A satellite was opened — the canvas closes its focus. */
	onOpenPost: () => void;
}

export interface PostFan {
	focusId: number | null;
	focusPage: number;
	focusTotalPages: number;
	readonly posts: Map< number, PostMini >;
	/** Fetch (or serve from cache) and render the fan for the focus. */
	load(): Promise< void >;
	/** Drop the fan and hide the pager. */
	clear(): void;
	/** Invalidate any in-flight load — on close focus. */
	invalidate(): void;
	/** Per frame: ease the satellites toward their ring slots. */
	ease(): void;
	/** Radial lines from the centre to each satellite. */
	drawEdges(): void;
	/** Per frame: position + counter-scale the chips, fade them in. */
	syncChips( counterScale: number ): void;
}

/**
 * Open a post's editor in a shell window — the same path the table's
 * title links use — after leaving the list window's fullscreen, where
 * a normal-z window would otherwise open behind it.
 */
export function openPostWindow( env: CanvasEnv, editUrl: string, title?: string ): void {
	const api = window.wp?.os;
	const wm = api?.windowManager;
	const derive = api?.deriveWindowId;
	const listWin =
		wm && typeof ( wm as { getById?: ( id: string ) => unknown } ).getById === 'function'
			? ( wm as { getById: ( id: string ) => { isFullscreen?: () => boolean; toggleFullscreen?: () => void } | undefined } ).getById( env.windowId )
			: undefined;
	if ( listWin && typeof listWin.isFullscreen === 'function' && typeof listWin.toggleFullscreen === 'function' && listWin.isFullscreen() ) {
		listWin.toggleFullscreen();
	}
	if ( wm && typeof derive === 'function' ) {
		const id = derive( editUrl );
		wm.open( { id, baseId: id, url: editUrl, title: title ?? editUrl, icon: 'dashicons-admin-post' } );
		return;
	}
	try {
		window.open( editUrl, '_blank' );
	} catch {
		window.location.assign( editUrl );
	}
}

export function createPostFan( deps: PostFanDeps ): PostFan {
	const { pixi, postLayer, postChipLayer, postEdgeGfx, interaction } = deps;
	const posts = new Map< number, PostMini >();
	const chips = new Map< number, PostChip >();
	const cache = new Map< string, PostsCacheEntry >();
	// Monotonic token for in-flight loads: a fast click between nodes
	// (or a page flip during a slow fetch) must not land stale
	// satellites on the wrong term.
	let loadSeq = 0;

	// Pager — one container, painted once and toggled with `.visible`.
	// `passive` so pointer events pass to the children, which opt in
	// with explicit hit areas (a static container with no hitArea
	// falls back to the union of child bounds and steals clicks).
	const pager = new pixi.Container();
	pager.eventMode = 'passive';
	pager.visible = false;
	postLayer.addChild( pager );
	const pagerPrev = new pixi.Graphics();
	const pagerNext = new pixi.Graphics();
	const pagerLabel = new pixi.Text( {
		text: '1 / 1',
		style: { fill: 0x50575e, fontSize: deps.pagerLabelSize, fontFamily: FONT_FAMILY, fontWeight: '600' },
		...( deps.pagerTextRes ? { resolution: deps.pagerTextRes } : {} ),
	} );
	pagerLabel.anchor.set( 0.5 );
	for ( const g of [ pagerPrev, pagerNext ] ) {
		g.eventMode = 'static';
		g.cursor = 'pointer';
		g.hitArea = new pixi.Circle( 0, 0, 16 );
		g.on( 'pointerdown', ( e ) => stopBubble( interaction, e ) );
	}
	pager.addChild( pagerPrev );
	pager.addChild( pagerLabel );
	pager.addChild( pagerNext );
	pagerPrev.on( 'pointertap', ( e ) => {
		stopBubble( interaction, e );
		// The DOM click that follows must not read as "empty canvas".
		interaction.lastFocusChange = performance.now();
		if ( fan.focusPage > 1 ) {
			fan.focusPage--;
			void fan.load();
		}
	} );
	pagerNext.on( 'pointertap', ( e ) => {
		stopBubble( interaction, e );
		interaction.lastFocusChange = performance.now();
		if ( fan.focusPage < fan.focusTotalPages ) {
			fan.focusPage++;
			void fan.load();
		}
	} );

	function drawPagerButton( gfx: PixiGraphics, glyph: string, disabled: boolean ): void {
		gfx.clear();
		gfx.circle( 0, 0, 14 );
		gfx.fill( { color: disabled ? 0xf2f2f2 : 0xffffff, alpha: disabled ? 0.7 : 1 } );
		gfx.stroke( { color: 0x000000, width: 1, alpha: 0.12 } );
		const label = ( ( gfx as unknown as { children?: PixiContainer[] } ).children?.[ 0 ] as PixiText | undefined ) ?? null;
		if ( ! label ) {
			const t = new pixi.Text( {
				text: glyph,
				style: { fill: disabled ? 0xb0b3b8 : 0x50575e, fontSize: deps.pagerGlyphSize, fontFamily: FONT_FAMILY, fontWeight: '600' },
				...( deps.pagerTextRes ? { resolution: deps.pagerTextRes } : {} ),
			} );
			t.anchor.set( 0.5 );
			gfx.addChild( t );
		} else {
			label.text = glyph;
			label.style.fill = disabled ? 0xb0b3b8 : 0x50575e;
		}
	}

	function repaintPager(): void {
		const center = fan.focusId === null ? null : deps.getCenter( fan.focusId );
		if ( ! center || fan.focusTotalPages <= 1 ) {
			pager.visible = false;
			return;
		}
		pager.visible = true;
		const prevDisabled = fan.focusPage <= 1;
		const nextDisabled = fan.focusPage >= fan.focusTotalPages;
		drawPagerButton( pagerPrev, '◀', prevDisabled );
		drawPagerButton( pagerNext, '▶', nextDisabled );
		pagerPrev.cursor = prevDisabled ? 'default' : 'pointer';
		pagerNext.cursor = nextDisabled ? 'default' : 'pointer';
		pagerLabel.text = `${ fan.focusPage } / ${ fan.focusTotalPages }`;
		pagerPrev.x = -38;
		pagerNext.x = 38;
		pagerPrev.y = 0;
		pagerNext.y = 0;
		pagerLabel.x = 0;
		pagerLabel.y = 0;
		pager.x = center.x;
		pager.y = center.y + POST_RING_RADIUS + 60;
	}

	function layoutChip( chip: PostChip, post: PostMini ): void {
		const displayTitle =
			post.title.length > POST_TITLE_MAX_CHARS ? post.title.slice( 0, POST_TITLE_MAX_CHARS - 1 ) + '…' : post.title;
		if ( chip.titleText.text !== displayTitle ) {
			chip.titleText.text = displayTitle;
		}
		const padX = 9;
		const padY = 3;
		const dotR = 4;
		const gap = 6;
		const titleW = chip.titleText.width;
		const titleH = chip.titleText.height;
		const totalW = padX + dotR * 2 + gap + titleW + padX;
		const totalH = Math.max( titleH, dotR * 2 ) + padY * 2;
		const left = -totalW / 2;
		const top = -totalH / 2;
		chip.bg.clear();
		chip.bg.roundRect( left, top, totalW, totalH, totalH / 2 );
		if ( chip.cachedHover ) {
			chip.bg.fill( { color: 0xffffff, alpha: 1 } );
			chip.bg.stroke( { color: post.tone, width: 1.5, alpha: 1 } );
		} else {
			chip.bg.fill( { color: 0xffffff, alpha: 0.95 } );
			chip.bg.stroke( { color: 0x000000, width: 1, alpha: 0.12 } );
		}
		chip.dot.clear();
		chip.dot.circle( left + padX + dotR, 0, dotR );
		chip.dot.fill( { color: post.tone, alpha: 0.85 } );
		chip.dot.stroke( { color: 0xffffff, width: 1 } );
		chip.titleText.x = left + padX + dotR * 2 + gap;
		chip.titleText.y = -titleH / 2;
	}

	function ensureChip( post: PostMini ): void {
		if ( chips.has( post.id ) ) {
			return;
		}
		const container = new pixi.Container();
		container.eventMode = 'static';
		container.cursor = 'pointer';
		// Starts invisible; `syncChips` fades it in with the ring motion.
		container.alpha = 0;
		const bg = new pixi.Graphics();
		const dot = new pixi.Graphics();
		const titleText = new pixi.Text( {
			text: post.title,
			style: { fill: 0x1d2327, fontSize: deps.chipFontSize, fontFamily: FONT_FAMILY, fontWeight: '500' },
			resolution: deps.chipTextRes,
		} );
		container.addChild( bg );
		container.addChild( dot );
		container.addChild( titleText );
		const chip: PostChip = { container, bg, dot, titleText, cachedHover: false };
		chips.set( post.id, chip );
		postChipLayer.addChild( container );
		container.on( 'pointerdown', ( e ) => stopBubble( interaction, e ) );
		container.on( 'pointertap', () => {
			// Open the post AND release the camera in the same gesture.
			openPostWindow( deps.env, post.editUrl, post.title );
			deps.onOpenPost();
		} );
		container.on( 'pointerover', () => {
			chip.cachedHover = true;
			layoutChip( chip, post );
		} );
		container.on( 'pointerout', () => {
			chip.cachedHover = false;
			layoutChip( chip, post );
		} );
		layoutChip( chip, post );
	}

	function render( items: PostsCacheEntry[ 'items' ] ): void {
		fan.clear();
		const center = fan.focusId === null ? null : deps.getCenter( fan.focusId );
		if ( ! center ) {
			return;
		}
		const count = items.length;
		const ringR = POST_RING_RADIUS + Math.max( 0, count - 8 ) * 6;
		items.forEach( ( item, idx ) => {
			const angle = ( ( 2 * Math.PI ) / Math.max( 1, count ) ) * idx - Math.PI / 2;
			// `gfx` only carries a position for the edge drawing; the chip
			// is the visual.
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
				tx: center.x + Math.cos( angle ) * ringR,
				ty: center.y + Math.sin( angle ) * ringR,
				gfx,
				tone: center.tone,
			};
			posts.set( item.id, post );
			ensureChip( post );
		} );
		repaintPager();
	}

	function apply( entry: PostsCacheEntry, termId: number ): void {
		fan.focusTotalPages = entry.totalPages;
		// The authoritative count, even on a cache hit.
		if ( Number.isFinite( entry.realTotal ) && entry.realTotal >= 0 ) {
			deps.onCountReconciled( termId, entry.realTotal );
		}
		render( entry.items );
	}

	const fan: PostFan = {
		focusId: null,
		focusPage: 1,
		focusTotalPages: 1,
		posts,
		async load() {
			if ( fan.focusId === null ) {
				return;
			}
			const mySeq = ++loadSeq;
			const termId = fan.focusId;
			const key = `${ termId }:${ fan.focusPage }`;
			const cached = cache.get( key );
			if ( cached && performance.now() - cached.fetchedAt < POSTS_CACHE_TTL_MS ) {
				apply( cached, termId );
				return;
			}
			try {
				const res = await deps.env.client.fetchTermPosts( deps.param, termId, fan.focusPage, POST_PER_PAGE );
				if ( mySeq !== loadSeq || fan.focusId !== termId ) {
					return;
				}
				const base = deps.env.extra.editPostUrlBase ?? '';
				const entry: PostsCacheEntry = {
					items: res.items.map( ( p ) => ( {
						id: p.id,
						title: stripTags( p.title ),
						editUrl: `${ base }?post=${ p.id }&action=edit`,
					} ) ),
					totalPages: res.totalPages,
					realTotal: res.total,
					fetchedAt: performance.now(),
				};
				cache.set( key, entry );
				apply( entry, termId );
			} catch ( err ) {
				showToast( __( 'Couldn’t load posts:' ), err );
			}
		},
		clear() {
			for ( const post of posts.values() ) {
				postLayer.removeChild( post.gfx );
				post.gfx.destroy();
			}
			posts.clear();
			for ( const chip of chips.values() ) {
				postChipLayer.removeChild( chip.container );
				chip.container.destroy( { children: true } );
			}
			chips.clear();
			postEdgeGfx.clear();
			pager.visible = false;
		},
		invalidate() {
			loadSeq++;
		},
		ease() {
			for ( const p of posts.values() ) {
				p.x += ( p.tx - p.x ) * 0.18;
				p.y += ( p.ty - p.y ) * 0.18;
				p.gfx.x = p.x;
				p.gfx.y = p.y;
			}
		},
		drawEdges() {
			postEdgeGfx.clear();
			const center = fan.focusId === null ? null : deps.getCenter( fan.focusId );
			if ( ! center ) {
				return;
			}
			for ( const post of posts.values() ) {
				postEdgeGfx.moveTo( center.x, center.y );
				postEdgeGfx.lineTo( post.x, post.y );
				postEdgeGfx.stroke( { color: center.tone, width: 1, alpha: 0.35 } );
			}
		},
		syncChips( counterScale ) {
			for ( const post of posts.values() ) {
				const chip = chips.get( post.id );
				if ( ! chip ) {
					continue;
				}
				chip.container.x = post.x;
				chip.container.y = post.y;
				chip.container.scale.set( counterScale );
				if ( chip.container.alpha < 1 ) {
					chip.container.alpha = Math.min( 1, chip.container.alpha + 0.18 );
				}
			}
		},
	};
	return fan;
}
