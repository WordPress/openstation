/**
 * Posts-window first-open intro — Pixi-driven preview.
 *
 * The first time a user opens the redesigned native Posts window we
 * pop a modal that previews the new categories experience: a small
 * Pixi mindmap with a fake taxonomy that the user can grab and
 * reparent. No REST writes — the demo is a pure local toy whose
 * only job is to hint at what the real Categories tab feels like.
 *
 * Lifecycle is identical to {@link wpdConfirm}: render a backdrop +
 * dialog, return a Promise that resolves with the chosen action,
 * tear down on close. Two outcomes: `'confirm'` ("Got it"), or
 * `'settings'` ("Take me to settings"). Either way the dialog is
 * marked seen by the caller.
 *
 * Reuses the framework's `wp.desktop.loadModules( ['pixijs'] )` so
 * the bundle does not ship Pixi twice. Falls back to a static
 * markup-only intro when Pixi is unavailable (offline boot, the
 * shell hasn't loaded yet, etc.) so the dialog is never broken.
 *
 * @public
 * @since 0.8.0
 */

import { __ } from '../i18n';

interface PixiPoint { x: number; y: number; }
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
	sortableChildren?: boolean;
}
interface PixiGraphics extends PixiContainer {
	clear(): PixiGraphics;
	circle( x: number, y: number, r: number ): PixiGraphics;
	roundRect( x: number, y: number, w: number, h: number, r: number ): PixiGraphics;
	moveTo( x: number, y: number ): PixiGraphics;
	bezierCurveTo(
		cp1x: number, cp1y: number,
		cp2x: number, cp2y: number,
		x: number, y: number,
	): PixiGraphics;
	lineTo( x: number, y: number ): PixiGraphics;
	stroke( style: { color: number; width: number; alpha?: number } ): PixiGraphics;
	fill( style: { color: number; alpha?: number } | number ): PixiGraphics;
}
interface PixiApp {
	canvas: HTMLCanvasElement;
	stage: PixiContainer;
	renderer: { resize( w: number, h: number ): void; width: number; height: number; render(): void };
	init( opts: unknown ): Promise< void >;
	// Options object only — a literal `true` triggers Pixi's
	// releaseGlobalResources() and corrupts other live Applications.
	destroy( rendererOpts?: { removeView?: boolean }, opts?: unknown ): void;
	ticker: { add( cb: () => void ): void; remove( cb: () => void ): void };
}
interface PixiText extends PixiContainer {
	text: string;
	width: number;
	height: number;
	anchor: { set( v: number ): void };
	style: { fill: number; fontSize?: number; fontFamily?: string; fontWeight?: string };
	resolution: number;
}
interface PixiNamespace {
	Application: new () => PixiApp;
	Container: new () => PixiContainer;
	Graphics: new () => PixiGraphics;
	Text: new ( opts: {
		text: string;
		style: { fill: number; fontSize?: number; fontFamily?: string; fontWeight?: string };
		resolution?: number;
		anchor?: { x: number; y: number };
	} ) => PixiText;
	Circle: new ( x: number, y: number, r: number ) => unknown;
}

/**
 * Outcome of the dialog:
 *
 * - `'confirm'`  — user clicked "Got it" → caller should mark seen.
 * - `'settings'` — user clicked "Take me to settings" → caller marks
 *                  seen and routes to OS Settings.
 * - `'cancel'`   — Escape / backdrop click → caller MUST NOT mark
 *                  seen. Lets us test the intro repeatedly without
 *                  having to wipe meta from OS Settings.
 */
export type IntroResult = 'confirm' | 'settings' | 'cancel';

interface FloatPhase {
	/** Angular offsets so each node bobs out of phase with its siblings. */
	phaseX: number;
	phaseY: number;
	/** Per-node frequency in radians per ms. */
	freqX: number;
	freqY: number;
	/** Pixel amplitude — how far the node drifts off its layout target. */
	ampX: number;
	ampY: number;
}

interface DemoNode extends FloatPhase {
	id: string;
	name: string;
	parent: string | null;
	color: number;
	radius: number;
	x: number;
	y: number;
	/** Force-sim velocity — accumulates per-tick repulsion + spring + anchor forces. */
	vx: number;
	vy: number;
	/** Layout anchor — the radial seed position the simulation softly pulls toward. */
	tx: number;
	ty: number;
	gfx: PixiGraphics;
	label: PixiText;
	dragging: boolean;
}

interface TagChip extends FloatPhase {
	id: string;
	name: string;
	count: number;
	hue: number;
	fontSize: number;
	width: number;
	height: number;
	x: number;
	y: number;
	tx: number;
	ty: number;
	bg: PixiGraphics;
	hashText: PixiText;
	nameText: PixiText;
	countText: PixiText;
	container: PixiContainer;
	dragging: boolean;
	hover: boolean;
}

const ROOT_ID = '__root__';
const PALETTE = [
	0x2271b1, // wp blue
	0x7c3aed, // violet
	0x059669, // emerald
	0xdb2777, // pink
	0xea580c, // orange
	0x0891b2, // cyan
];

/** Fake taxonomy used for the demo. */
function buildSeedTree(): Map< string, DemoNode > {
	const seeds: Array< Pick< DemoNode, 'id' | 'name' | 'parent' > > = [
		{ id: 'science', name: __( 'Science' ), parent: ROOT_ID },
		{ id: 'biology', name: __( 'Biology' ), parent: 'science' },
		{ id: 'astronomy', name: __( 'Astronomy' ), parent: 'science' },
		{ id: 'physics', name: __( 'Physics' ), parent: 'science' },

		{ id: 'society', name: __( 'Society' ), parent: ROOT_ID },
		{ id: 'economics', name: __( 'Economics' ), parent: 'society' },
		{ id: 'politics', name: __( 'Politics' ), parent: 'society' },

		{ id: 'culture', name: __( 'Culture' ), parent: ROOT_ID },
		{ id: 'music', name: __( 'Music' ), parent: 'culture' },
		{ id: 'cinema', name: __( 'Cinema' ), parent: 'culture' },
	];
	const map = new Map< string, DemoNode >();
	seeds.forEach( ( s, i ) => {
		map.set( s.id, {
			id: s.id,
			name: s.name,
			parent: s.parent,
			color: PALETTE[ i % PALETTE.length ],
			radius: s.parent === ROOT_ID ? 34 : 24,
			x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0,
			gfx: null as unknown as PixiGraphics,
			label: null as unknown as PixiText,
			dragging: false,
			...makeFloatPhase( i, 4, 3.5 ),
		} );
	} );
	return map;
}

/**
 * Per-node oscillation parameters. Each node bobs around its
 * layout anchor on independent X / Y sinusoids so the whole canvas
 * looks "alive" and hints that things can move. Frequencies are
 * intentionally slow (~6–10 second period) — anything faster reads
 * as jitter rather than floating.
 */
function makeFloatPhase(
	seed: number,
	ampX: number,
	ampY: number,
): FloatPhase {
	// Pseudo-random but deterministic per seed so a re-mount renders
	// the same wobble pattern.
	const r = ( n: number ): number => {
		const x = Math.sin( seed * 9301 + n * 49297 ) * 233280;
		return x - Math.floor( x );
	};
	return {
		phaseX: r( 1 ) * Math.PI * 2,
		phaseY: r( 2 ) * Math.PI * 2,
		// 0.0006–0.0012 rad/ms ≈ 5–10 second periods.
		freqX: 0.0006 + r( 3 ) * 0.0006,
		freqY: 0.0006 + r( 4 ) * 0.0006,
		ampX,
		ampY,
	};
}

/** Faux tag list for the demo — counts encode chip size. */
const TAG_SEEDS: Array< { id: string; name: string; count: number; hue: number } > = [
	{ id: 't-wp', name: 'wordpress', count: 42, hue: 210 },
	{ id: 't-design', name: 'design', count: 28, hue: 280 },
	{ id: 't-code', name: 'code', count: 33, hue: 145 },
	{ id: 't-photo', name: 'photo', count: 22, hue: 320 },
	{ id: 't-news', name: 'news', count: 19, hue: 10 },
];

const TAG_FONT_MIN = 11;
const TAG_FONT_MAX = 16;
const TAG_PAD_X = 9;
const TAG_PAD_Y = 4;
const TAG_GAP_HASH = 3;
const TAG_GAP_COUNT = 6;

function fontSizeFor( count: number, max: number ): number {
	if ( max <= 0 ) {
		return TAG_FONT_MIN;
	}
	const t = Math.min( 1, count / max );
	return TAG_FONT_MIN + ( TAG_FONT_MAX - TAG_FONT_MIN ) * t;
}

/**
 * Darken a 0xRRGGBB integer toward black. `factor` is the fraction
 * of each channel to keep — 0.55 turns vivid disc colours into
 * deep, saturated capsule fills that contrast cleanly with the
 * white label text on top.
 */
function darkenColor( color: number, factor: number ): number {
	const r = Math.round( Math.floor( color / 65536 ) * factor );
	const g = Math.round( Math.floor( ( color % 65536 ) / 256 ) * factor );
	const b = Math.round( ( color % 256 ) * factor );
	return r * 65536 + g * 256 + b;
}

/** HSL → 0xRRGGBB integer. Mirrors `tags-cloud.ts`'s `hslToInt`. */
function hslToInt( h: number, s: number, l: number ): number {
	const sat = s / 100;
	const lig = l / 100;
	const c = ( 1 - Math.abs( 2 * lig - 1 ) ) * sat;
	const hp = ( ( h % 360 ) + 360 ) % 360 / 60;
	const xCol = c * ( 1 - Math.abs( ( hp % 2 ) - 1 ) );
	let r = 0;
	let g = 0;
	let b = 0;
	if ( hp < 1 ) {
		r = c; g = xCol;
	} else if ( hp < 2 ) {
		r = xCol; g = c;
	} else if ( hp < 3 ) {
		g = c; b = xCol;
	} else if ( hp < 4 ) {
		g = xCol; b = c;
	} else if ( hp < 5 ) {
		r = xCol; b = c;
	} else {
		r = c; b = xCol;
	}
	const m = lig - c / 2;
	const R = Math.round( ( r + m ) * 255 );
	const G = Math.round( ( g + m ) * 255 );
	const B = Math.round( ( b + m ) * 255 );
	return R * 65536 + G * 256 + B;
}

/** True if `candidate` is `target` or a descendant of `target`. */
function isDescendant(
	nodes: Map< string, DemoNode >,
	candidateId: string,
	targetId: string,
): boolean {
	if ( candidateId === targetId ) {
		return true;
	}
	let cur: string | null = candidateId;
	const visited = new Set< string >();
	while ( cur && ! visited.has( cur ) ) {
		visited.add( cur );
		const n = nodes.get( cur );
		if ( ! n ) {
			return false;
		}
		if ( n.parent === targetId ) {
			return true;
		}
		cur = n.parent;
	}
	return false;
}

/**
 * Re-compute layout anchors for every node. The canvas is split
 * vertically: the upper ~62% holds the categories mindmap, the
 * lower band holds the tags row. Within the categories area we
 * fan roots around its center, then fan children radially around
 * their parent.
 */
function layoutTree(
	nodes: Map< string, DemoNode >,
	width: number,
	height: number,
): void {
	const cx = width / 2;
	// Push the mindmap up a bit so the bottom band has room for the
	// tags row without crowding the lowest children.
	const cy = height * 0.40;
	const roots = Array.from( nodes.values() ).filter( ( n ) => n.parent === ROOT_ID );
	const mindmapH = height * 0.62;
	const rootR = Math.min( width, mindmapH ) * 0.22;
	roots.forEach( ( root, i ) => {
		const angle = ( i / Math.max( 1, roots.length ) ) * Math.PI * 2 - Math.PI / 2;
		root.tx = cx + Math.cos( angle ) * rootR;
		root.ty = cy + Math.sin( angle ) * rootR;
		layoutChildren( nodes, root, angle );
	} );
}

/**
 * Lay tags out as a single horizontal row centered in the lower
 * band of the canvas. Wraps to a second line when the chips don't
 * fit. The float oscillation is what gives the row life — the
 * static layout itself is a simple flow.
 */
function layoutTags(
	tags: TagChip[],
	width: number,
	height: number,
): void {
	const bandTop = height * 0.72;
	const bandH = height * 0.26;
	const bandCy = bandTop + bandH / 2;
	const gap = 8;
	// Bin into rows.
	const rows: TagChip[][] = [ [] ];
	let rowW = 0;
	tags.forEach( ( t ) => {
		const w = t.width || 60;
		if ( rowW + w + gap > width - 24 && rows[ rows.length - 1 ].length > 0 ) {
			rows.push( [] );
			rowW = 0;
		}
		rows[ rows.length - 1 ].push( t );
		rowW += w + gap;
	} );
	const rowSpacing = 38;
	const totalRowsH = rows.length * rowSpacing - rowSpacing;
	const startY = bandCy - totalRowsH / 2;
	rows.forEach( ( row, rIdx ) => {
		const total =
			row.reduce( ( acc, t ) => acc + ( t.width || 60 ), 0 ) +
			gap * Math.max( 0, row.length - 1 );
		let cursor = ( width - total ) / 2;
		row.forEach( ( t ) => {
			const w = t.width || 60;
			t.tx = cursor + w / 2;
			t.ty = startY + rIdx * rowSpacing;
			cursor += w + gap;
		} );
	} );
}

function layoutChildren(
	nodes: Map< string, DemoNode >,
	parent: DemoNode,
	parentAngle: number,
): void {
	const children = Array.from( nodes.values() ).filter(
		( n ) => n.parent === parent.id,
	);
	if ( children.length === 0 ) {
		return;
	}
	const spread = Math.PI * 0.9;
	const baseAngle = parentAngle;
	const step = children.length === 1 ? 0 : spread / ( children.length - 1 );
	const start = baseAngle - spread / 2;
	const r = 95;
	children.forEach( ( child, i ) => {
		const a = children.length === 1 ? baseAngle : start + step * i;
		child.tx = parent.tx + Math.cos( a ) * r;
		child.ty = parent.ty + Math.sin( a ) * r;
		layoutChildren( nodes, child, a );
	} );
}

/** Compute width/height of a tag chip (without drawing it). */
function layoutTagChip( chip: TagChip ): void {
	chip.hashText.style.fontSize = chip.fontSize;
	chip.nameText.style.fontSize = chip.fontSize;
	chip.countText.style.fontSize = Math.max( 9, Math.round( chip.fontSize * 0.6 ) );
	const hashW = chip.hashText.width;
	const nameW = chip.nameText.width;
	const nameH = chip.nameText.height;
	const countW = chip.countText.width;
	const countH = chip.countText.height;
	const countBadgeW = Math.max( 16, countW + 8 );
	const countBadgeH = Math.max( 13, countH + 3 );
	chip.width =
		TAG_PAD_X + hashW + TAG_GAP_HASH + nameW + TAG_GAP_COUNT + countBadgeW + TAG_PAD_X;
	chip.height = Math.max( nameH, countBadgeH ) + TAG_PAD_Y * 2;
}

/** Paint a tag chip — pill bg, hashtag, name, count badge. */
function paintTagChip( chip: TagChip ): void {
	const totalW = chip.width;
	const totalH = chip.height;
	const left = -totalW / 2;
	const top = -totalH / 2;
	const radius = totalH / 2;

	const fillBg = chip.hover
		? hslToInt( chip.hue, 70, 88 )
		: hslToInt( chip.hue, 60, 95 );
	const borderColor = hslToInt( chip.hue, 50, 70 );
	const textColor = 0x1d2327;
	const hashColor = hslToInt( chip.hue, 65, 42 );
	const countBg = hslToInt( chip.hue, 70, 50 );

	chip.bg.clear();
	chip.bg.roundRect( left, top, totalW, totalH, radius );
	chip.bg.fill( fillBg );
	chip.bg.stroke( {
		color: borderColor,
		width: chip.hover ? 1.6 : 1.2,
		alpha: 0.85,
	} );

	const hashW = chip.hashText.width;
	const nameW = chip.nameText.width;
	const nameH = chip.nameText.height;
	const countW = chip.countText.width;
	const countH = chip.countText.height;
	const countBadgeW = Math.max( 16, countW + 8 );
	const countBadgeH = Math.max( 13, countH + 3 );

	chip.hashText.x = left + TAG_PAD_X;
	chip.hashText.y = ( totalH - nameH ) / 2 + top;
	chip.hashText.style.fill = hashColor;

	chip.nameText.x = left + TAG_PAD_X + hashW + TAG_GAP_HASH;
	chip.nameText.y = ( totalH - nameH ) / 2 + top;
	chip.nameText.style.fill = textColor;

	const badgeX =
		left + TAG_PAD_X + hashW + TAG_GAP_HASH + nameW + TAG_GAP_COUNT;
	const badgeY = ( totalH - countBadgeH ) / 2 + top;
	chip.bg.roundRect( badgeX, badgeY, countBadgeW, countBadgeH, countBadgeH / 2 );
	chip.bg.fill( countBg );

	chip.countText.x = badgeX + ( countBadgeW - countW ) / 2;
	chip.countText.y = badgeY + ( countBadgeH - countH ) / 2;
}

/** Renders the static-fallback dialog when Pixi can't load. */
function renderFallback( stage: HTMLElement ): void {
	stage.replaceChildren();
	const note = document.createElement( 'p' );
	note.className = 'wpd-intro__fallback';
	note.textContent = __(
		'A new visual editor for Categories and Tags awaits inside — drag, drop, and reorganize your taxonomy in seconds.',
	);
	stage.appendChild( note );
}

/**
 * Render the intro modal. Returns the user's choice once the dialog
 * is dismissed.
 */
export async function showPostsIntroDialog(): Promise< IntroResult > {
	return new Promise< IntroResult >( ( resolve ) => {
		// --- Backdrop + dialog DOM -----------------------------------
		const backdrop = document.createElement( 'div' );
		backdrop.className = 'wpd-intro-backdrop';
		const dialog = document.createElement( 'div' );
		dialog.className = 'wpd-intro';
		dialog.setAttribute( 'role', 'dialog' );
		dialog.setAttribute( 'aria-modal', 'true' );
		dialog.setAttribute( 'aria-labelledby', 'wpd-intro-title' );
		dialog.tabIndex = -1;
		backdrop.appendChild( dialog );

		const titleEl = document.createElement( 'h2' );
		titleEl.id = 'wpd-intro-title';
		titleEl.className = 'wpd-intro__title';
		titleEl.textContent = __( 'Welcome to the new Posts' );
		dialog.appendChild( titleEl );

		const lede = document.createElement( 'p' );
		lede.className = 'wpd-intro__lede';
		lede.textContent = __(
			'A redesigned Posts experience built around how you actually work. Try the new Categories canvas — grab a node and drop it on another to reparent it.',
		);
		dialog.appendChild( lede );

		const stage = document.createElement( 'div' );
		stage.className = 'wpd-intro__stage';
		dialog.appendChild( stage );

		const escape = document.createElement( 'p' );
		escape.className = 'wpd-intro__escape';
		escape.textContent = __(
			'Prefer the classic Posts list? You can switch back any time from OS Settings → Features.',
		);
		dialog.appendChild( escape );

		const actions = document.createElement( 'div' );
		actions.className = 'wpd-intro__actions';
		const settingsBtn = document.createElement( 'button' );
		settingsBtn.type = 'button';
		settingsBtn.className = 'wpd-intro__btn wpd-intro__btn--secondary';
		settingsBtn.textContent = __( 'Take me to settings' );
		const confirmBtn = document.createElement( 'button' );
		confirmBtn.type = 'button';
		confirmBtn.className = 'wpd-intro__btn wpd-intro__btn--primary';
		confirmBtn.textContent = __( 'Got it' );
		actions.appendChild( settingsBtn );
		actions.appendChild( confirmBtn );
		dialog.appendChild( actions );

		document.body.appendChild( backdrop );

		// --- Cleanup wiring -----------------------------------------
		let teardownPixi: ( () => void ) | null = null;
		const cleanup = ( result: IntroResult ): void => {
			document.removeEventListener( 'keydown', onKey );
			teardownPixi?.();
			backdrop.remove();
			resolve( result );
		};
		const onKey = ( e: KeyboardEvent ): void => {
			if ( e.key === 'Escape' ) {
				e.preventDefault();
				// Escape does NOT mark the intro as seen — the
				// caller treats `'cancel'` as a no-op so the dialog
				// re-appears next open. Useful while testing copy
				// + the Pixi demo without having to reset OS
				// Settings between runs.
				cleanup( 'cancel' );
			}
		};
		document.addEventListener( 'keydown', onKey );

		confirmBtn.addEventListener( 'click', () => cleanup( 'confirm' ) );
		settingsBtn.addEventListener( 'click', () => cleanup( 'settings' ) );
		backdrop.addEventListener( 'click', ( e ) => {
			if ( e.target === backdrop ) {
				// Same rationale as Escape — backdrop dismissal
				// is "I want out" not "I'm done with this once
				// and forever."
				cleanup( 'cancel' );
			}
		} );

		// Focus the dialog so Escape works without a click first.
		requestAnimationFrame( () => dialog.focus() );

		// --- Pixi mount (async; fallback on failure) ----------------
		void mountPixi( stage ).then( ( teardown ) => {
			teardownPixi = teardown;
		} ).catch( () => {
			renderFallback( stage );
		} );
	} );
}

async function mountPixi( stage: HTMLElement ): Promise< () => void > {
	const api = window.wp?.desktop;
	if ( ! api || typeof api.loadModules !== 'function' ) {
		renderFallback( stage );
		return () => {};
	}
	try {
		await api.loadModules( [ 'pixijs' ] );
	} catch {
		renderFallback( stage );
		return () => {};
	}
	const pixiMaybe = ( window as unknown as { PIXI?: PixiNamespace } ).PIXI;
	if ( ! pixiMaybe ) {
		renderFallback( stage );
		return () => {};
	}
	const pixi: PixiNamespace = pixiMaybe;

	const app = new pixi.Application();
	await app.init( {
		resizeTo: stage,
		backgroundAlpha: 0,
		antialias: true,
		autoDensity: true,
		resolution: Math.min( window.devicePixelRatio || 1, 2 ),
	} );
	stage.appendChild( app.canvas );
	app.canvas.classList.add( 'wpd-intro__canvas' );

	const world = new pixi.Container();
	world.sortableChildren = true;
	// Seed scale at 1 — auto-fit eases this each tick to keep every
	// node + tag inside the canvas. Without an explicit seed Pixi
	// would init with `scale.set(1)` already, but setting it
	// explicitly documents the auto-fit contract.
	world.scale.set( 1 );
	app.stage.addChild( world );

	const edgeLayer = new pixi.Container();
	const nodeLayer = new pixi.Container();
	const tagLayer = new pixi.Container();
	// Fake "post" satellites that spawn around nodes when a tag is
	// hovered — drawn above edges but below nodes so the node disc
	// occludes the connector tail behind it.
	const postLayer = new pixi.Container();
	// Stack order: edges < nodes < tags < posts. Hovered-spawn post
	// chips sit ABOVE every other surface so they read as "delivered
	// from the source" instead of buried behind the nodes they're
	// orbiting. Pre-fix they were below nodes and effectively
	// invisible whenever the orbit slot overlapped a disc.
	edgeLayer.zIndex = 1;
	nodeLayer.zIndex = 2;
	tagLayer.zIndex = 3;
	postLayer.zIndex = 5;
	world.addChild( edgeLayer );
	world.addChild( postLayer );
	world.addChild( nodeLayer );
	world.addChild( tagLayer );

	const nodes = buildSeedTree();
	nodes.forEach( ( n ) => {
		const gfx = new pixi.Graphics() as PixiGraphics;
		gfx.eventMode = 'static';
		gfx.cursor = 'grab';
		const label = new pixi.Text( {
			text: n.name,
			style: { fill: 0xffffff, fontSize: 12, fontWeight: '600', fontFamily: 'system-ui, -apple-system, sans-serif' },
			resolution: 3,
			anchor: { x: 0.5, y: 0.5 },
		} );
		gfx.addChild( label );
		n.gfx = gfx;
		n.label = label;
		nodeLayer.addChild( gfx );
	} );

	// --- Tag chips ---------------------------------------------------
	const tags: TagChip[] = [];
	const maxTagCount = TAG_SEEDS.reduce( ( m, t ) => Math.max( m, t.count ), 0 );
	TAG_SEEDS.forEach( ( seed, i ) => {
		const container = new pixi.Container();
		container.eventMode = 'static';
		container.cursor = 'grab';
		const bg = new pixi.Graphics() as PixiGraphics;
		const fontSize = fontSizeFor( seed.count, maxTagCount );
		const hashText = new pixi.Text( {
			text: '#',
			style: { fill: 0x1d2327, fontSize, fontWeight: '600', fontFamily: 'system-ui, -apple-system, sans-serif' },
			resolution: 3,
			anchor: { x: 0, y: 0 },
		} );
		const nameText = new pixi.Text( {
			text: seed.name,
			style: { fill: 0x1d2327, fontSize, fontWeight: '600', fontFamily: 'system-ui, -apple-system, sans-serif' },
			resolution: 3,
			anchor: { x: 0, y: 0 },
		} );
		const countText = new pixi.Text( {
			text: String( seed.count ),
			style: { fill: 0xffffff, fontSize: Math.max( 9, Math.round( fontSize * 0.6 ) ), fontWeight: '700', fontFamily: 'system-ui, -apple-system, sans-serif' },
			resolution: 3,
			anchor: { x: 0, y: 0 },
		} );
		container.addChild( bg, hashText, nameText, countText );
		tagLayer.addChild( container );
		const chip: TagChip = {
			id: seed.id,
			name: seed.name,
			count: seed.count,
			hue: seed.hue,
			fontSize,
			width: 0,
			height: 0,
			x: 0, y: 0, tx: 0, ty: 0,
			bg,
			hashText,
			nameText,
			countText,
			container,
			dragging: false,
			hover: false,
			...makeFloatPhase( 100 + i, 5, 4 ),
		};
		layoutTagChip( chip );
		paintTagChip( chip );
		tags.push( chip );
	} );

	// --- Initial geometry --------------------------------------------
	let stageW = stage.clientWidth || 600;
	let stageH = stage.clientHeight || 360;
	layoutTree( nodes, stageW, stageH );
	layoutTags( tags, stageW, stageH );
	// Spawn nodes from the canvas center so they "explode" outward into
	// their layout — gives the dialog its opening flourish. Tags slide
	// in from below the band.
	const cx0 = stageW / 2;
	const cy0 = stageH * 0.40;
	nodes.forEach( ( n ) => {
		n.x = cx0; n.y = cy0;
	} );
	tags.forEach( ( t ) => {
		t.x = t.tx; t.y = stageH + 40;
	} );

	const drawNode = ( n: DemoNode, hovered: boolean, dropTarget: boolean ): void => {
		n.gfx.clear();
		const r = n.radius * ( hovered ? 1.08 : 1 );
		// Soft halo when this node is a valid drop target.
		if ( dropTarget ) {
			n.gfx.circle( 0, 0, r + 10 ).fill( { color: n.color, alpha: 0.18 } );
		}
		n.gfx
			.circle( 0, 0, r )
			.fill( { color: n.color, alpha: 0.95 } )
			.stroke( { color: 0xffffff, width: dropTarget ? 3 : 1.5, alpha: 0.9 } );

		// Name capsule behind the label so long names ("Astronomy",
		// "Economics", "Politics") that overflow the disc stay
		// legible against the light canvas background. Drawn AFTER
		// the disc so it sits on top of the fill but underneath the
		// label (the label is a child of `n.gfx` and renders last).
		const labelW = n.label.width;
		const labelH = n.label.height;
		// Only paint the capsule when the label actually overflows
		// the disc — keeps short-name nodes (Music, Drama, Macro)
		// reading as clean discs without extra chrome.
		if ( labelW + 6 > r * 2 ) {
			const padX = 8;
			const padY = 3;
			const capW = labelW + padX * 2;
			const capH = labelH + padY * 2;
			// Use a darker shade of the disc colour so the capsule
			// reads as part of the node, not a foreign sticker. The
			// 0.85 alpha lets a hint of the disc fill bleed through
			// where they overlap, knitting the two shapes together.
			n.gfx
				.roundRect( -capW / 2, -capH / 2, capW, capH, capH / 2 )
				.fill( { color: darkenColor( n.color, 0.55 ), alpha: 0.92 } );
		}
		n.gfx.x = n.x;
		n.gfx.y = n.y;
	};

	const drawEdges = (): void => {
		const edgeLayerWithChildren = edgeLayer as unknown as { children: unknown[] };
		const previousChildren = edgeLayerWithChildren.children.slice();
		previousChildren.forEach( ( c ) => edgeLayer.removeChild( c ) );
		const edge = new pixi.Graphics();
		nodes.forEach( ( n ) => {
			if ( ! n.parent || n.parent === ROOT_ID ) {
				return;
			}
			const parent = nodes.get( n.parent );
			if ( ! parent ) {
				return;
			}
			const dx = n.x - parent.x;
			const cp1x = parent.x + dx * 0.5;
			const cp1y = parent.y;
			const cp2x = parent.x + dx * 0.5;
			const cp2y = n.y;
			edge.moveTo( parent.x, parent.y );
			edge.bezierCurveTo( cp1x, cp1y, cp2x, cp2y, n.x, n.y );
		} );
		edge.stroke( { color: 0x94a3b8, width: 1.6, alpha: 0.55 } );
		edgeLayer.addChild( edge );
	};

	// --- Fake "posts on hover" --------------------------------------
	// Each tag has a hand-picked list of (node, title) pairs so the
	// hover deploy looks plausibly relevant — #wordpress posts hang
	// off Society/Politics, #photo off Culture/Cinema, etc. The
	// titles are made up; this is purely a feel-of-the-feature
	// preview, not real data.
	const POSTS_BY_TAG: Record< string, Array< { node: string; title: string } > > = {
		't-wp': [ { node: 'politics', title: __( 'WordPress at scale' ) }, { node: 'economics', title: __( 'Plugins economy' ) }, { node: 'astronomy', title: __( 'Open-source orbits' ) } ],
		't-design': [ { node: 'cinema', title: __( 'Title cards reborn' ) }, { node: 'music', title: __( 'Album art trends' ) }, { node: 'culture', title: __( 'Type as identity' ) } ],
		't-code': [ { node: 'physics', title: __( 'Sim notebooks' ) }, { node: 'astronomy', title: __( 'Pixel pipelines' ) }, { node: 'science', title: __( 'Code as method' ) } ],
		't-photo': [ { node: 'cinema', title: __( 'Anamorphic notes' ) }, { node: 'biology', title: __( 'Field portraits' ) }, { node: 'culture', title: __( 'Sunday playlist' ) } ],
		't-news': [ { node: 'politics', title: __( 'Weekly briefing' ) }, { node: 'economics', title: __( 'Markets recap' ) } ],
	};
	type FakePost = {
		title: string;
		/** What the chip orbits around — a category node or a tag chip. */
		anchorKind: 'node' | 'tag';
		anchorId: string;
		/**
		 * Border / accent color for the chip. Sourced from the
		 * anchor (node disc colour or HSL of the tag hue).
		 */
		accentColor: number;
		angle: number;
		/**
		 * Where the post chip animates FROM. Tag-hover seeds this with
		 * the tag chip's current position so posts visibly fly out of
		 * the tag; category-hover seeds it with the node's center so
		 * they bloom from inside the disc. The container starts here
		 * with alpha:0 and eases toward its orbit slot.
		 */
		originX: number;
		originY: number;
		/**
		 * Per-post orbit radius — slight variation so they don't all
		 * land on the exact same circle.
		 */
		orbit: number;
		container: PixiContainer;
		bg: PixiGraphics;
		text: PixiText;
		spawnedAt: number;
	};
	let fakePosts: FakePost[] = [];

	/** Per-category title pool — shown when hovering a node. */
	const POSTS_BY_CATEGORY: Record< string, string[] > = {
		science: [ __( 'What we learned' ), __( 'Open questions' ), __( 'Methodology notes' ), __( 'Replication study' ) ],
		biology: [ __( 'Fieldwork log' ), __( 'Cell shapes' ), __( 'Microscope diary' ) ],
		botany: [ __( 'Pressed leaves' ), __( 'Greenhouse notes' ), __( 'Native species' ) ],
		zoology: [ __( 'Migration map' ), __( 'Birding weekend' ), __( 'Tracks at dawn' ) ],
		astronomy: [ __( 'Comet schedule' ), __( 'Backyard telescope' ), __( 'Lunar tides' ) ],
		physics: [ __( 'Lab notebook' ), __( 'Toy models' ), __( 'Phase transitions' ) ],

		society: [ __( 'Sunday digest' ), __( 'Local elections' ), __( 'Reader letters' ) ],
		economics: [ __( 'Macro recap' ), __( 'Numbers I noticed' ), __( 'Market mood' ) ],
		macro: [ __( 'Inflation trail' ), __( 'Central banks' ) ],
		micro: [ __( 'Pricing tactics' ), __( 'Coffee shop economics' ) ],
		politics: [ __( 'Campaign trail' ), __( 'Town hall notes' ), __( 'Policy explainer' ) ],

		culture: [ __( 'Type as identity' ), __( 'Sunday playlist' ), __( 'City walks' ) ],
		music: [ __( 'Liner notes' ), __( 'Live this week' ), __( 'Album re-listen' ) ],
		cinema: [ __( 'Title cards reborn' ), __( 'Director cut' ), __( 'Set on the road' ) ],
		drama: [ __( 'Three-act notes' ), __( 'Stage to screen' ) ],
		'sci-fi': [ __( 'Anamorphic notes' ), __( 'Future-proof tropes' ), __( 'Worldbuilding 101' ) ],
	};

	const clearFakePosts = (): void => {
		fakePosts.forEach( ( p ) => {
			try {
				postLayer.removeChild( p.container );
				p.container.destroy( { children: true } );
			} catch {
				/* noop */
			}
		} );
		fakePosts = [];
	};

	/** Internal builder — creates the chip + sets its initial pose. */
	const buildPostChip = (
		title: string,
		anchorKind: 'node' | 'tag',
		anchorId: string,
		accentColor: number,
		angle: number,
		orbit: number,
		originX: number,
		originY: number,
		spawnedAt: number,
	): FakePost => {
		const container = new pixi.Container();
		container.alpha = 0;
		// Start the chip AT the source point so the first ease step
		// already produces a visible "fly out from here" trajectory.
		container.x = originX;
		container.y = originY;
		const bg = new pixi.Graphics() as PixiGraphics;
		const text = new pixi.Text( {
			text: title,
			style: {
				fill: 0x1d2327,
				fontSize: 10,
				fontFamily: 'system-ui, -apple-system, sans-serif',
			},
			resolution: 3,
			anchor: { x: 0, y: 0 },
		} );
		container.addChild( bg, text );
		postLayer.addChild( container );
		return {
			title,
			anchorKind,
			anchorId,
			accentColor,
			angle,
			orbit,
			originX,
			originY,
			container,
			bg,
			text,
			spawnedAt,
		};
	};

	/**
	 * Tag hover: posts orbit AROUND the hovered tag itself — clustered
	 * right next to it so the user sees "these are the posts in this
	 * tag" without having to scan the canvas.
	 */
	const spawnFakePostsFromTag = ( tag: TagChip ): void => {
		clearFakePosts();
		const list = POSTS_BY_TAG[ tag.id ];
		if ( ! list ) {
			return;
		}
		const now = performance.now();
		const ox = tag.container.x;
		const oy = tag.container.y;
		const accent = hslToInt( tag.hue, 70, 50 );
		// Fan upward from the tag (tags live in the bottom band, so
		// the natural reading direction is up). Use a wide spread
		// (~220°) so even six chips don't overlap, and bias the orbit
		// radius up a touch with chip count so a busy tag doesn't
		// crowd itself.
		const titles = list.map( ( p ) => p.title );
		const spread = Math.PI * 1.2;
		const baseAngle = -Math.PI / 2;
		const step = titles.length === 1 ? 0 : spread / ( titles.length - 1 );
		const start = baseAngle - spread / 2;
		const orbitR = 56 + Math.min( 16, titles.length * 2 );
		titles.forEach( ( title, i ) => {
			const angle = titles.length === 1 ? baseAngle : start + step * i;
			fakePosts.push(
				buildPostChip(
					title,
					'tag',
					tag.id,
					accent,
					angle,
					orbitR + ( i % 2 ) * 6,
					ox,
					oy,
					now,
				),
			);
		} );
	};

	/** Category hover: posts bloom out of the node center, fanning around it. */
	const spawnFakePostsFromCategory = ( node: DemoNode ): void => {
		clearFakePosts();
		const titles = POSTS_BY_CATEGORY[ node.id ];
		if ( ! titles || titles.length === 0 ) {
			return;
		}
		const now = performance.now();
		const ox = node.gfx.x;
		const oy = node.gfx.y;
		const spread = Math.PI * 1.6;
		const start = -Math.PI / 2 - spread / 2;
		const step = titles.length === 1 ? 0 : spread / ( titles.length - 1 );
		titles.forEach( ( title, i ) => {
			const angle = titles.length === 1 ? -Math.PI / 2 : start + step * i;
			fakePosts.push(
				buildPostChip(
					title,
					'node',
					node.id,
					node.color,
					angle,
					78 + ( i % 3 ) * 8,
					ox,
					oy,
					now,
				),
			);
		} );
	};

	let dragging: DemoNode | null = null;
	let pointerStart: PixiPoint = { x: 0, y: 0 };
	let nodeStart: PixiPoint = { x: 0, y: 0 };
	let hoverDrop: DemoNode | null = null;
	let dragTag: TagChip | null = null;
	let tagDragStart: PixiPoint = { x: 0, y: 0 };
	let tagStart: PixiPoint = { x: 0, y: 0 };

	nodes.forEach( ( n ) => {
		n.gfx.on( 'pointerdown', ( raw ) => {
			const e = raw as PointerEvent & { global: PixiPoint };
			dragging = n;
			n.dragging = true;
			pointerStart = { x: e.global.x, y: e.global.y };
			nodeStart = { x: n.x, y: n.y };
			n.gfx.cursor = 'grabbing';
			n.gfx.zIndex = 1000;
			drawNode( n, true, false );
		} );
		n.gfx.on( 'pointerover', () => {
			if ( dragging || dragTag ) {
				return;
			}
			drawNode( n, true, false );
			// Same wow-effect on category nodes as on tag chips —
			// hovering blooms a small constellation of fake posts
			// out of the disc center. Click does nothing; this is
			// pure preview.
			spawnFakePostsFromCategory( n );
		} );
		n.gfx.on( 'pointerout', () => {
			if ( dragging !== n ) {
				drawNode( n, false, hoverDrop === n );
			}
			clearFakePosts();
		} );
	} );

	// Tag chip interactions: drag-to-float (no reparenting) and
	// hover-deploy of fake posts around the relevant categories.
	tags.forEach( ( t ) => {
		t.container.on( 'pointerdown', ( raw ) => {
			const e = raw as PointerEvent & { global: PixiPoint };
			dragTag = t;
			t.dragging = true;
			tagDragStart = { x: e.global.x, y: e.global.y };
			tagStart = { x: t.x, y: t.y };
			t.container.cursor = 'grabbing';
			t.container.zIndex = 5000;
		} );
		t.container.on( 'pointerover', () => {
			if ( dragTag || dragging ) {
				return;
			}
			t.hover = true;
			paintTagChip( t );
			spawnFakePostsFromTag( t );
		} );
		t.container.on( 'pointerout', () => {
			t.hover = false;
			paintTagChip( t );
			clearFakePosts();
		} );
	} );

	const onMove = ( e: PointerEvent ): void => {
		const rect = app.canvas.getBoundingClientRect();
		const px = e.clientX - rect.left;
		const py = e.clientY - rect.top;
		if ( dragTag ) {
			dragTag.x = tagStart.x + ( px - tagDragStart.x );
			dragTag.y = tagStart.y + ( py - tagDragStart.y );
			dragTag.container.x = dragTag.x;
			dragTag.container.y = dragTag.y;
			return;
		}
		if ( ! dragging ) {
			return;
		}
		const dx = px - pointerStart.x;
		const dy = py - pointerStart.y;
		dragging.x = nodeStart.x + dx;
		dragging.y = nodeStart.y + dy;

		// Hit-test against other nodes for a drop target.
		let hit: DemoNode | null = null;
		nodes.forEach( ( other ) => {
			if ( other === dragging ) {
				return;
			}
			if ( isDescendant( nodes, other.id, dragging!.id ) ) {
				return;
			}
			const ddx = other.x - dragging!.x;
			const ddy = other.y - dragging!.y;
			if ( Math.hypot( ddx, ddy ) < other.radius + dragging!.radius * 0.6 ) {
				hit = other;
			}
		} );
		if ( hit !== hoverDrop ) {
			if ( hoverDrop ) {
				drawNode( hoverDrop, false, false );
			}
			hoverDrop = hit;
			if ( hoverDrop ) {
				drawNode( hoverDrop, false, true );
			}
		}
		drawNode( dragging, true, false );
	};

	const onUp = (): void => {
		if ( dragTag ) {
			dragTag.container.cursor = 'grab';
			dragTag.container.zIndex = 0;
			dragTag.dragging = false;
			// Tags don't reparent — just drift back to their layout
			// anchor under the existing ease-toward-target loop.
			dragTag = null;
			return;
		}
		if ( ! dragging ) {
			return;
		}
		const drop = hoverDrop;
		if ( drop && drop.id !== dragging.parent ) {
			dragging.parent = drop.id;
			layoutTree( nodes, stageW, stageH );
		}
		dragging.gfx.cursor = 'grab';
		dragging.gfx.zIndex = 0;
		dragging.dragging = false;
		const dragged = dragging;
		dragging = null;
		if ( hoverDrop ) {
			drawNode( hoverDrop, false, false );
			hoverDrop = null;
		}
		drawNode( dragged, false, false );
	};

	app.canvas.addEventListener( 'pointermove', onMove );
	window.addEventListener( 'pointerup', onUp );
	window.addEventListener( 'pointercancel', onUp );

	// --- Animation loop ---------------------------------------------
	// Two effects per tick:
	//
	// 1. **Ease**   — every non-dragged node/tag eases toward its
	//    layout target (tx, ty), so reparenting and respawn animate
	//    organically.
	// 2. **Float**  — on top of the eased position we add a small
	//    sinusoidal offset (per-node phase + frequency) so the whole
	//    canvas drifts gently. The user reads "alive, interactive"
	//    without us shouting "drag me!" with arrows.
	const tick = (): void => {
		const now = performance.now();

		// --- Force-directed step ----------------------------------
		// The radial layout (`tx`, `ty`) seeds positions, but with
		// 16 nodes across a tree this dense, fans from neighbouring
		// roots overlap. So instead of easing toward those targets
		// directly we run a tiny physics step:
		//
		//   - **Repulsion** between every pair of nodes pushes
		//     overlapping discs apart (Coulomb-style 1/d² force).
		//   - **Springs** along parent→child edges hold the tree
		//     together at a fixed rest length.
		//   - **Anchor** is a gentle pull toward each node's radial
		//     `tx`, `ty` — without it two disconnected subtrees
		//     would drift apart forever; with it the simulation
		//     settles around the radial layout but with overlap
		//     resolved.
		//
		// Velocities damp each step so the system reaches a calm
		// steady state quickly. The float oscillation in the draw
		// pass is layered ON TOP, so the canvas still bobs after
		// settle.
		const REPULSION_K = 6500;
		const SPRING_K = 0.05;
		const SPRING_LEN = 110;
		const ANCHOR_K = 0.012;
		const DAMPING = 0.82;
		const MAX_V = 8;

		const list = Array.from( nodes.values() );
		const fxArr: number[] = new Array( list.length ).fill( 0 );
		const fyArr: number[] = new Array( list.length ).fill( 0 );

		// IMPORTANT: when a node is being dragged we must completely
		// remove it from BOTH sides of the simulation. Otherwise its
		// repulsion field pushes potential drop targets away from
		// the cursor — making it nearly impossible to land a drop —
		// and its springs tug parents/children around as the user
		// flings it across the canvas. Drag time is "this node is
		// out of the world", physics-wise.
		for ( let i = 0; i < list.length; i++ ) {
			const a = list[ i ];
			if ( a === dragging ) {
				continue;
			}
			for ( let j = i + 1; j < list.length; j++ ) {
				const b = list[ j ];
				if ( b === dragging ) {
					continue;
				}
				const dx = b.x - a.x;
				const dy = b.y - a.y;
				const d2 = dx * dx + dy * dy + 0.01;
				const d = Math.sqrt( d2 );
				const minD = a.radius + b.radius;
				// Soft cutoff at 4× the touching distance — past that
				// the pair has no business influencing each other.
				if ( d > minD * 4 ) {
					continue;
				}
				const f = REPULSION_K / d2;
				const fx = ( dx / d ) * f;
				const fy = ( dy / d ) * f;
				fxArr[ i ] -= fx;
				fyArr[ i ] -= fy;
				fxArr[ j ] += fx;
				fyArr[ j ] += fy;
			}
		}

		list.forEach( ( c, idx ) => {
			if ( ! c.parent || c.parent === ROOT_ID ) {
				return;
			}
			// Skip springs touching the dragged node — see comment
			// above the repulsion loop.
			if ( c === dragging ) {
				return;
			}
			const parent = nodes.get( c.parent );
			if ( ! parent || parent === dragging ) {
				return;
			}
			const pIdx = list.indexOf( parent );
			const dx = parent.x - c.x;
			const dy = parent.y - c.y;
			const d = Math.max( 0.01, Math.sqrt( dx * dx + dy * dy ) );
			const diff = d - SPRING_LEN;
			const sx = ( dx / d ) * diff * SPRING_K;
			const sy = ( dy / d ) * diff * SPRING_K;
			fxArr[ idx ] += sx;
			fyArr[ idx ] += sy;
			if ( pIdx >= 0 ) {
				fxArr[ pIdx ] -= sx;
				fyArr[ pIdx ] -= sy;
			}
		} );

		list.forEach( ( n, idx ) => {
			fxArr[ idx ] += ( n.tx - n.x ) * ANCHOR_K;
			fyArr[ idx ] += ( n.ty - n.y ) * ANCHOR_K;
		} );

		list.forEach( ( n, idx ) => {
			if ( n === dragging ) {
				n.vx = 0;
				n.vy = 0;
				return;
			}
			n.vx = ( n.vx + fxArr[ idx ] ) * DAMPING;
			n.vy = ( n.vy + fyArr[ idx ] ) * DAMPING;
			// Cap velocity so a transient force spike during
			// reparent doesn't fling a node off-canvas.
			if ( n.vx > MAX_V ) {
				n.vx = MAX_V;
			} else if ( n.vx < -MAX_V ) {
				n.vx = -MAX_V;
			}
			if ( n.vy > MAX_V ) {
				n.vy = MAX_V;
			} else if ( n.vy < -MAX_V ) {
				n.vy = -MAX_V;
			}
			n.x += n.vx;
			n.y += n.vy;
		} );
		drawEdges();
		nodes.forEach( ( n ) => {
			const fx =
				n === dragging
					? n.x
					: n.x + Math.sin( now * n.freqX + n.phaseX ) * n.ampX;
			const fy =
				n === dragging
					? n.y
					: n.y + Math.sin( now * n.freqY + n.phaseY ) * n.ampY;
			drawNode( n, false, hoverDrop === n );
			n.gfx.x = fx;
			n.gfx.y = fy;
		} );

		tags.forEach( ( t ) => {
			if ( t === dragTag ) {
				return;
			}
			t.x += ( t.tx - t.x ) * 0.16;
			t.y += ( t.ty - t.y ) * 0.16;
			const fx = t.x + Math.sin( now * t.freqX + t.phaseX ) * t.ampX;
			const fy = t.y + Math.sin( now * t.freqY + t.phaseY ) * t.ampY * 0.6;
			t.container.x = fx;
			t.container.y = fy;
		} );

		// Fake-post chips fade in over 220 ms, ease toward their orbit
		// position around the anchor node, and gently bob with their
		// own phase so they feel like spawned satellites instead of
		// pasted stickers.
		fakePosts.forEach( ( p, idx ) => {
			// Live anchor lookup — chips track the float/drag of
			// whatever spawned them. Tag chips bob, nodes drift; the
			// orbit follows.
			let anchorX = 0;
			let anchorY = 0;
			if ( p.anchorKind === 'tag' ) {
				const t = tags.find( ( tg ) => tg.id === p.anchorId );
				if ( ! t ) {
					return;
				}
				anchorX = t.container.x;
				anchorY = t.container.y;
			} else {
				const node = nodes.get( p.anchorId );
				if ( ! node ) {
					return;
				}
				anchorX = node.gfx.x;
				anchorY = node.gfx.y;
			}
			const elapsed = now - p.spawnedAt;
			// Slightly slower fade-in (320 ms) than before — gives the
			// chip time to traverse from the source point to its orbit
			// slot, so the eye reads the trajectory instead of a pop.
			const t = Math.min( 1, elapsed / 320 );
			p.container.alpha = t;
			const wobble = Math.sin( now * 0.0015 + idx ) * 4;
			const tx = anchorX + Math.cos( p.angle ) * ( p.orbit + wobble );
			const ty = anchorY + Math.sin( p.angle ) * ( p.orbit + wobble );
			// Lower easing constant + container starts AT origin point
			// produces the visible "fly out from source" arc.
			p.container.x += ( tx - p.container.x ) * 0.16;
			p.container.y += ( ty - p.container.y ) * 0.16;

			// Lay out the bg pill around the text (computed each
			// frame because text width is laid out async by Pixi the
			// first paint).
			const padX = 7;
			const padY = 3;
			const textW = p.text.width;
			const textH = p.text.height;
			const w = textW + padX * 2;
			const h = textH + padY * 2;
			p.text.x = -w / 2 + padX;
			p.text.y = -h / 2 + padY;
			p.bg.clear();
			p.bg.roundRect( -w / 2, -h / 2, w, h, h / 2 );
			p.bg.fill( { color: 0xffffff, alpha: 0.95 } );
			p.bg.stroke( {
				color: p.accentColor,
				width: 1.2,
				alpha: 0.85,
			} );
		} );

		// --- Auto-fit ---------------------------------------------
		// Compute the bounding box of every node + tag in world
		// space, then ease the world container's translate + scale
		// so the box fits inside the canvas with a margin. The
		// force simulation can push nodes anywhere; this makes sure
		// they always remain visible.
		//
		// Cap scale at 1 — never zoom IN past natural size — and at
		// a sensible minimum to avoid flicker on the first frame
		// when widths haven't been laid out yet.
		const FIT_MARGIN = 24;
		const FIT_EASE = 0.08;
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		nodes.forEach( ( n ) => {
			// Use the float-modulated draw position so nodes that
			// are bobbing outward are also accounted for.
			const dx = n.gfx.x;
			const dy = n.gfx.y;
			const r = n.radius + 8;
			if ( dx - r < minX ) {
				minX = dx - r;
			}
			if ( dy - r < minY ) {
				minY = dy - r;
			}
			if ( dx + r > maxX ) {
				maxX = dx + r;
			}
			if ( dy + r > maxY ) {
				maxY = dy + r;
			}
		} );
		tags.forEach( ( tg ) => {
			const dx = tg.container.x;
			const dy = tg.container.y;
			const w = tg.width / 2 + 4;
			const h = tg.height / 2 + 4;
			if ( dx - w < minX ) {
				minX = dx - w;
			}
			if ( dy - h < minY ) {
				minY = dy - h;
			}
			if ( dx + w > maxX ) {
				maxX = dx + w;
			}
			if ( dy + h > maxY ) {
				maxY = dy + h;
			}
		} );
		const bw = maxX - minX;
		const bh = maxY - minY;
		if ( bw > 0 && bh > 0 && Number.isFinite( bw ) && Number.isFinite( bh ) ) {
			const sx = ( stageW - FIT_MARGIN * 2 ) / bw;
			const sy = ( stageH - FIT_MARGIN * 2 ) / bh;
			const targetScale = Math.max( 0.55, Math.min( 1, sx, sy ) );
			const cx = ( minX + maxX ) / 2;
			const cy = ( minY + maxY ) / 2;
			const targetX = stageW / 2 - cx * targetScale;
			const targetY = stageH / 2 - cy * targetScale;
			world.x += ( targetX - world.x ) * FIT_EASE;
			world.y += ( targetY - world.y ) * FIT_EASE;
			const curScale = world.scale.x;
			world.scale.set( curScale + ( targetScale - curScale ) * FIT_EASE );
		}
	};
	app.ticker.add( tick );

	// --- Resize ------------------------------------------------------
	const ro = new ResizeObserver( () => {
		stageW = stage.clientWidth || stageW;
		stageH = stage.clientHeight || stageH;
		layoutTree( nodes, stageW, stageH );
		layoutTags( tags, stageW, stageH );
	} );
	ro.observe( stage );

	return (): void => {
		ro.disconnect();
		app.ticker.remove( tick );
		app.canvas.removeEventListener( 'pointermove', onMove );
		window.removeEventListener( 'pointerup', onUp );
		window.removeEventListener( 'pointercancel', onUp );
		clearFakePosts();
		try {
			// `{ removeView: true }`, NEVER `true`: a literal `true` runs
			// `releaseGlobalResources()`, wiping Pixi's page-global pools
			// out from under every other live Application on the page
			// (canvas wallpaper, previews, content graph).
			app.destroy( { removeView: true }, { children: true } );
		} catch {
			/* noop */
		}
	};
}
