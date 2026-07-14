/**
 * Desktop Mode — Wapuu widget: comic speech balloons (HTML overlay).
 *
 * Balloons are plain DOM positioned above the canvas — NOT drawn in
 * PixiJS — so a balloon can host real interactive content (the `ask`
 * text box), and so fading a single element's `opacity` composites the
 * whole thing (shape + text) as ONE group with no per-layer
 * alpha-summing.
 *
 * Each balloon's SHAPE is an inline `<svg>` sized to the measured
 * content, with the message layered on top as HTML. Drawing the bubble
 * and its tail as ONE path gives a clean, integrated comic outline.
 * Styles:
 *   - `speak` — rounded bubble + a tapered, curved off-centre tail
 *   - `yell`  — an irregular spiky burst over an offset accent burst
 *   - `think` — a proper scalloped cloud + trailing thought-dots
 *
 * The element is anchored by its TAIL TIP (returned from {@link
 * fitBalloon}); the engine pins that tip to Wapuu's head, so the body
 * floats up and to the side.
 *
 * @since 0.19.0
 */

import { __ } from '../../i18n';

/** Balloon style. */
export type BalloonType = 'speak' | 'yell' | 'think';

const STROKE = '#2b2b33';
const STROKE_W = 2.5;
const ACCENT = '#ffb24d'; // the soft orange behind the yell burst

/**
 * Unique-per-balloon gradient id (only one balloon lives at a time,
 * but unique ids keep the DOM honest during the cross-fade window).
 */
let gradientSeq = 0;

/** Which edge of a speak bubble the tail grows from. */
export type TailSide = 'bottom' | 'right';

/**
 * Mirror flags for edge-aware placement. The engine flips a balloon to
 * whichever side of Wapuu actually has room: `mirrorX` swaps which
 * horizontal edge the tail grows from, `mirrorY` hangs the balloon
 * BELOW its anchor (tail pointing up). Only the DRAWING mirrors — the
 * HTML content stays unflipped and readable.
 */
export interface BalloonMirror {
	mirrorX?: boolean;
	mirrorY?: boolean;
}

/** A built shape: SVG markup, element size, where the content + tip go. */
interface Shape {
	width: number;
	height: number;
	contentX: number;
	contentY: number;
	tipX: number;
	tipY: number;
	/** Shape markup, pre-`<svg>` wrap ({@link build} may mirror it first). */
	inner: string;
	/** Gradient id the markup references ({@link svgWrap} defines it). */
	gid: string;
	/** Width of the bubble BODY (excludes a right-side tail). */
	bodyWidth?: number;
}

/** A shape wrapped into its final `<svg>` markup. */
interface FittedShape extends Shape {
	svg: string;
}

const f = ( n: number ): string => n.toFixed( 1 );

/**
 * Wrap shape markup in an `<svg>` with a soft top-lit gradient fill
 * (`url(#…)` referenced by the shapes) — flat white reads clinical;
 * a faint falloff reads like paper.
 */
function svgWrap(
	w: number,
	h: number,
	inner: string,
	gid: string,
	flipGradient = false,
): string {
	// `preserveAspectRatio="none"` + the stylesheet's `width/height:
	// 100%` make the SVG stretch with the element box, so a CSS
	// transition on the element's size animates the bubble smoothly
	// (the chat balloon grows when a message lands). The gradient uses
	// userSpaceOnUse so EVERY path in the svg (e.g. the chat bubble and
	// its separately-drawn tail) samples the same vertical ramp — a
	// per-path bounding-box gradient would visibly seam at the tail.
	// When the markup sits inside a vertical-mirror <g> (see build),
	// userSpaceOnUse coords resolve in that FLIPPED space — swap the
	// ramp ends so the balloon stays lit from the visual top.
	const y1 = flipGradient ? f( h ) : '0';
	const y2 = flipGradient ? '0' : f( h );
	return (
		`<svg viewBox="0 0 ${ f( w ) } ${ f( h ) }" width="${ f( w ) }" height="${ f( h ) }" preserveAspectRatio="none">` +
		`<defs><linearGradient id="${ gid }" gradientUnits="userSpaceOnUse" x1="0" y1="${ y1 }" x2="0" y2="${ y2 }">` +
		'<stop offset="0" stop-color="#ffffff"/>' +
		'<stop offset="1" stop-color="#edf0f6"/>' +
		'</linearGradient></defs>' +
		inner +
		'</svg>'
	);
}

/** Shared presentation attributes for the main (white) shapes. */
function inkAttrs( gid: string ): string {
	return `fill="url(#${ gid })" stroke="${ STROKE }" stroke-width="${ STROKE_W }" stroke-linejoin="round" stroke-linecap="round"`;
}

/**
 * The chat bubble: a rounded rect whose right edge gets the tail horn
 * SPLICED INTO IT each frame by {@link updateChatTail} — bubble and
 * horn are ONE closed path with one fill and one stroke, so there are
 * no seams, no stroke end-caps, no patch artifacts at any aim angle.
 * The initial `d` is the plain rect; the engine re-aims immediately.
 */
function shapeSpeakRight( cw: number, ch: number ): Shape {
	const gid = `wapuu-grad-${ ++gradientSeq }`;
	const padX = 24;
	const padY = 18;
	const bw = cw + padX * 2;
	const bh = ch + padY * 2;
	const r = Math.min( 24, bh / 2.5 );

	const body = `<path class="wapuu-balloon__bubble" d="${ chatBubblePath(
		bw,
		bh,
		r,
		null,
	) }" ${ inkAttrs( gid ) }/>`;

	return {
		width: bw,
		height: bh,
		contentX: padX,
		contentY: padY,
		// Virtual anchor for placement: just off the bottom-right, so the
		// engine's "pin tip near the mouth" math keeps the bubble beside
		// Wapuu. The VISIBLE tail is aimed independently per frame.
		tipX: bw + 46,
		tipY: bh * 0.95,
		bodyWidth: bw,
		inner: body,
		gid,
	};
}

/** The horn geometry spliced into the bubble's right edge. */
interface ChatHorn {
	/** Attach-span top / bottom on the right edge. */
	a1y: number;
	a2y: number;
	/** Upper / lower edge control points and the tip. */
	k1x: number;
	k1y: number;
	k2x: number;
	k2y: number;
	tipX: number;
	tipY: number;
}

/**
 * Build the chat bubble's full path: a rounded rect with the tail horn
 * spliced into the right edge (or the plain rect when `horn` is null).
 */
function chatBubblePath(
	bw: number,
	bh: number,
	r: number,
	horn: ChatHorn | null,
): string {
	const right = horn
		? [
			`V ${ f( horn.a1y ) }`,
			`Q ${ f( horn.k1x ) } ${ f( horn.k1y ) } ${ f( horn.tipX ) } ${ f(
				horn.tipY,
			) }`,
			`Q ${ f( horn.k2x ) } ${ f( horn.k2y ) } ${ f( bw ) } ${ f(
				horn.a2y,
			) }`,
			`V ${ f( bh - r ) }`,
		]
		: [ `V ${ f( bh - r ) }` ];
	return [
		`M ${ f( r ) } 0`,
		`H ${ f( bw - r ) }`,
		`Q ${ f( bw ) } 0 ${ f( bw ) } ${ f( r ) }`,
		...right,
		`Q ${ f( bw ) } ${ f( bh ) } ${ f( bw - r ) } ${ f( bh ) }`,
		`H ${ f( r ) }`,
		`Q 0 ${ f( bh ) } 0 ${ f( bh - r ) }`,
		`V ${ f( r ) }`,
		`Q 0 0 ${ f( r ) } 0`,
		'Z',
	].join( ' ' );
}

/**
 * Re-aim the chat bubble's tail at a target point (Wapuu's mouth) given
 * in element-local coordinates. Called by the engine every frame —
 * cheap (one `d` string). The horn attaches on the bubble's right edge
 * at the height nearest the target (kept off the rounded corners),
 * bows with a CONVEX upper shoulder, and tapers to a point pulled just
 * short of the target.
 *
 * @param el The chat balloon element (after {@link fitBalloon}).
 * @param tx Target x, element-local px.
 * @param ty Target y, element-local px.
 */
export function updateChatTail( el: HTMLElement, tx: number, ty: number ): void {
	const bubble = el.querySelector< SVGPathElement >( '.wapuu-balloon__bubble' );
	if ( ! bubble ) {
		return;
	}
	const bw = parseFloat( el.dataset.wapuuBw || '0' );
	const bh = parseFloat( el.dataset.wapuuBh || '0' );
	if ( ! bw || ! bh ) {
		return;
	}
	const r = Math.min( 24, bh / 2.5 );
	// A mirrored bubble's path lives in flipped drawing space (see
	// build) — convert the element-local target into that space; the
	// spliced horn then mirrors back out visually on the correct edge.
	const ax = el.dataset.wapuuMirrorX === '1' ? bw - tx : tx;
	// Attach span on the STRAIGHT part of the right edge — clear of both
	// rounded corners so the splice never collides with a corner arc.
	const half = Math.min( 15, ( bh - 2 * r - 8 ) / 2 );
	const cy = Math.max( r + half + 4, Math.min( bh - r - half - 4, ty ) );
	// Tip: a SHORT horn that gestures toward the target. Its length is
	// capped absolutely (it never stretches all the way to the mouth) —
	// long horns read awkwardly and invade Wapuu's render.
	const vx = ax - bw;
	const vy = ty - cy;
	const len = Math.hypot( vx, vy ) || 1;
	const hornLen = Math.max( 18, Math.min( 44, len - 30 ) );
	// The tip sits a few px LEFT + DOWN of the pure aim line — tucks the
	// point under the bubble's corner instead of jutting straight out.
	const tipX = bw + ( vx / len ) * hornLen - 6;
	const tipY = cy + ( vy / len ) * hornLen + 6;
	// Both control points on the LOWER side of the chord: the horn
	// leaves the bubble heading DOWN, then flattens out as it approaches
	// the tip — an upward-opening curve (the opposite of a sagging
	// knob). The LOWER edge — the one on the outside of this bend — must
	// bow HARDER than the upper, or the two edges cross into a twisted
	// sliver near the tip (the upper edge would dip below the lower).
	const px = -vy / len;
	const py = vx / len;
	// Bow + midpoint scale with the HORN, not the full distance to the
	// target — controls must sit between attach and tip.
	const sag = Math.min( 26, hornLen * 0.55 );
	const midX = bw + ( vx / len ) * hornLen * 0.5;
	const midY = cy + ( vy / len ) * hornLen * 0.5;

	bubble.setAttribute(
		'd',
		chatBubblePath( bw, bh, r, {
			a1y: cy - half,
			a2y: cy + half,
			// Pronounced bow on BOTH edges (the lower, outside-of-bend
			// edge always harder than the upper so they never cross).
			k1x: midX + px * sag * 0.55,
			k1y: midY + py * sag * 0.55,
			k2x: midX + px * sag * 1.25,
			k2y: midY + py * sag * 1.25,
			tipX,
			tipY,
		} ),
	);
}

/** Rounded bubble + a tapered, curved bottom tail (the classic `say`). */
function shapeSpeak( cw: number, ch: number ): Shape {
	const gid = `wapuu-grad-${ ++gradientSeq }`;
	const padX = 28;
	const padY = 22;
	const bw = cw + padX * 2;
	const bh = ch + padY * 2;
	const tailH = 52;
	const w = bw;
	const h = bh + tailH;
	const r = Math.min( 24, bh / 2.5 );
	// Tail on the bubble's bottom-RIGHT, sweeping down-right to a fine
	// point. Both edges bend through the SAME side of the chord so the
	// horn has one consistent convexity; the inner edge bends harder,
	// which is what tapers it like a brushstroke.
	const baseInner = bw * 0.58;
	const baseOuter = bw * 0.78;
	const tipX = bw * 0.94;
	const tipY = h;
	const kOutX = bw * 0.9;
	const kOutY = bh + tailH * 0.55;
	const kInX = bw * 0.78;
	const kInY = bh + tailH * 0.62;

	const d = [
		`M ${ f( r ) } 0`,
		`H ${ f( bw - r ) }`,
		`Q ${ f( bw ) } 0 ${ f( bw ) } ${ f( r ) }`,
		`V ${ f( bh - r ) }`,
		`Q ${ f( bw ) } ${ f( bh ) } ${ f( bw - r ) } ${ f( bh ) }`,
		`H ${ f( baseOuter ) }`,
		`Q ${ f( kOutX ) } ${ f( kOutY ) } ${ f( tipX ) } ${ f( tipY ) }`,
		`Q ${ f( kInX ) } ${ f( kInY ) } ${ f( baseInner ) } ${ f( bh ) }`,
		`H ${ f( r ) }`,
		`Q 0 ${ f( bh ) } 0 ${ f( bh - r ) }`,
		`V ${ f( r ) }`,
		`Q 0 0 ${ f( r ) } 0`,
		'Z',
	].join( ' ' );

	return {
		width: w,
		height: h,
		contentX: padX,
		contentY: padY,
		tipX,
		tipY,
		inner: `<path d="${ d }" ${ inkAttrs( gid ) }/>`,
		gid,
	};
}

/**
 * One ring of an irregular comic burst. Spike lengths vary with a
 * deterministic pseudo-random pattern so it reads hand-drawn, not
 * gear-like.
 */
function burstPoints(
	cx: number,
	cy: number,
	rx: number,
	ry: number,
	spikes: number,
	jitterSeed: number,
): string {
	const pts: string[] = [];
	for ( let i = 0; i < spikes * 2; i++ ) {
		const a = ( i / ( spikes * 2 ) ) * Math.PI * 2 - Math.PI / 2;
		// Deterministic per-spike wobble (±9 %), seeded so the back and
		// front bursts wobble differently.
		const wob = 0.09 * Math.sin( ( i + jitterSeed ) * 2.7 );
		const er = i % 2 === 0 ? 1.22 + wob : 0.8 - wob * 0.5;
		pts.push(
			`${ f( cx + Math.cos( a ) * rx * er ) },${ f( cy + Math.sin( a ) * ry * er ) }`,
		);
	}
	return pts.join( ' ' );
}

/** Spiky burst — irregular white burst over an offset accent burst. */
function shapeYell( cw: number, ch: number ): Shape {
	const gid = `wapuu-grad-${ ++gradientSeq }`;
	const padX = 34;
	const padY = 30;
	const bw = cw + padX * 2;
	const bh = ch + padY * 2;
	const cx = bw / 2;
	const cy = bh / 2;
	const rx = bw / 2;
	const ry = bh / 2;
	const h = cy + ry * 1.34;
	// The accent burst peeks out behind, nudged down-left and slightly
	// rotated (via a different jitter seed) — the classic comic double
	// burst. Group opacity (CSS) keeps the overlap fade-safe.
	const back = `<polygon points="${ burstPoints( cx - 5, cy + 5, rx * 1.02, ry * 1.02, 12, 4 ) }" fill="${ ACCENT }" stroke="${ STROKE }" stroke-width="${ STROKE_W }" stroke-linejoin="round"/>`;
	const front = `<polygon points="${ burstPoints( cx, cy, rx, ry, 12, 0 ) }" ${ inkAttrs( gid ) }/>`;
	return {
		width: bw,
		height: h,
		contentX: padX,
		contentY: padY,
		tipX: cx,
		tipY: h,
		inner: back + front,
		gid,
	};
}

/**
 * A proper scalloped cloud: walk an ellipse in `bumps` segments and
 * bow each segment OUTWARD through a control point — real puffy arcs,
 * not a cosine wobble.
 */
function cloudPath( cx: number, cy: number, rx: number, ry: number, bumps: number ): string {
	const pt = ( a: number, k: number ): [ number, number ] => [
		cx + Math.cos( a ) * rx * k,
		cy + Math.sin( a ) * ry * k,
	];
	const start = pt( -Math.PI / 2, 1 );
	let d = `M ${ f( start[ 0 ] ) } ${ f( start[ 1 ] ) }`;
	for ( let i = 0; i < bumps; i++ ) {
		const a1 = -Math.PI / 2 + ( i / bumps ) * Math.PI * 2;
		const a2 = -Math.PI / 2 + ( ( i + 1 ) / bumps ) * Math.PI * 2;
		const mid = ( a1 + a2 ) / 2;
		const c = pt( mid, 1.38 ); // outward bow → a puffy lobe
		const end = pt( a2, 1 );
		d += ` Q ${ f( c[ 0 ] ) } ${ f( c[ 1 ] ) } ${ f( end[ 0 ] ) } ${ f( end[ 1 ] ) }`;
	}
	return d + ' Z';
}

/** Scalloped cloud + two trailing thought-dots; tip at the lowest dot. */
function shapeThink( cw: number, ch: number ): Shape {
	const gid = `wapuu-grad-${ ++gradientSeq }`;
	const padX = 34;
	const padY = 30;
	const bw = cw + padX * 2;
	const bh = ch + padY * 2;
	const dotRegion = 52;
	const w = bw;
	const h = bh + dotRegion;
	const cloud = `<path d="${ cloudPath( bw / 2, bh / 2, bw / 2 - 10, bh / 2 - 8, 11 ) }" ${ inkAttrs( gid ) }/>`;
	// Dots trail to the bottom-right, shrinking toward Wapuu.
	const dot1 = `<ellipse cx="${ f( bw * 0.64 ) }" cy="${ f( bh + 10 ) }" rx="11" ry="9" ${ inkAttrs( gid ) }/>`;
	const dot2 = `<circle cx="${ f( bw * 0.72 ) }" cy="${ f( bh + 32 ) }" r="6" ${ inkAttrs( gid ) }/>`;
	return {
		width: w,
		height: h,
		contentX: padX,
		contentY: padY,
		tipX: bw * 0.72,
		tipY: bh + 38,
		inner: cloud + dot1 + dot2,
		gid,
	};
}

function build(
	type: BalloonType,
	cw: number,
	ch: number,
	tailSide: TailSide,
	mirror: BalloonMirror = {},
): FittedShape {
	let s: Shape;
	if ( type === 'yell' ) {
		s = shapeYell( cw, ch );
	} else if ( type === 'think' ) {
		s = shapeThink( cw, ch );
	} else {
		s = tailSide === 'right' ? shapeSpeakRight( cw, ch ) : shapeSpeak( cw, ch );
	}
	const mx = !! mirror.mirrorX;
	const my = !! mirror.mirrorY;
	let inner = s.inner;
	if ( mx || my ) {
		// Mirror the DRAWING wholesale with one <g> transform, so every
		// shape builder stays mirror-agnostic. The HTML content is laid
		// over it unmirrored (text must stay readable) — its box and the
		// tail tip are reflected numerically instead.
		inner =
			`<g transform="translate(${ mx ? f( s.width ) : 0 } ${
				my ? f( s.height ) : 0
			}) scale(${ mx ? -1 : 1 } ${ my ? -1 : 1 })">` +
			inner +
			'</g>';
		if ( mx ) {
			s.tipX = s.width - s.tipX;
			s.contentX = s.width - s.contentX - cw;
		}
		if ( my ) {
			s.tipY = s.height - s.tipY;
			s.contentY = s.height - s.contentY - ch;
		}
	}
	return { ...s, inner, svg: svgWrap( s.width, s.height, inner, s.gid, my ) };
}

/**
 * Short messages — an emoji, "!?", a word or two — render large and
 * proud instead of floating tiny in the white box.
 */
function isShortMessage( text: string ): boolean {
	return Array.from( text.trim() ).length <= 3;
}

/**
 * Create a balloon element with its message. The SVG shape is added by
 * {@link fitBalloon} once the element is in the DOM (so the content is
 * measurable). The message is inserted as text, never HTML.
 *
 * @param type Balloon style.
 * @param text Message text / emoji.
 */
export function createBalloon( type: BalloonType, text: string ): HTMLElement {
	const el = document.createElement( 'div' );
	el.className = `wapuu-balloon wapuu-balloon--${ type }`;
	const content = document.createElement( 'div' );
	content.className = 'wapuu-balloon__content';
	if ( isShortMessage( text ) ) {
		content.classList.add( 'wapuu-balloon__content--big' );
	}
	content.textContent = text;
	el.appendChild( content );
	return el;
}

/**
 * One tool call on an assistant message — OpenAI chat format.
 *
 * @public
 */
export interface WapuuChatToolCall {
	id?: string;
	type?: 'function';
	function: { name: string; arguments?: string };
}

/**
 * One chat message — OpenAI chat format (`role` + `content`, with
 * `tool_calls` on assistant messages and `role: 'tool'` results).
 *
 * @public
 */
export interface WapuuChatMessage {
	role: 'user' | 'assistant' | 'system' | 'tool';
	content?: string | null;
	name?: string;
	tool_calls?: WapuuChatToolCall[];
	tool_call_id?: string;
}

/** The pieces of an `ask` balloon the engine wires events onto. */
export interface AskBalloon {
	el: HTMLElement;
	input: HTMLInputElement;
	send: HTMLButtonElement;
	/** The scrollable message thread above the input row. */
	thread: HTMLElement;
}

/**
 * A live, persistent chat balloon — the handle returned by
 * `wp.desktop.wapuu.chat(…)`. The caller drives the conversation:
 * each user message arrives via the `onSend` callback, and the caller
 * pushes responses back with `append` / `appendMany`. Stays open until
 * `close()` (or until another balloon replaces it).
 *
 * @public
 */
export interface WapuuChatSession {
	/** Append a message (assistant / tool / system / user) to the thread. */
	append( msg: WapuuChatMessage ): void;
	/** Append several messages at once. */
	appendMany( messages: WapuuChatMessage[] ): void;
	/** Toggle a "typing…" indicator (the assistant is composing). */
	setTyping( on: boolean ): void;
	/** Empty the thread (the balloon stays open, re-fit around it). */
	clear(): void;
	/** Close the chat (fades out). */
	close(): void;
}

/** A "typing…" chip — three bouncing dots, assistant-styled. */
export function createTypingIndicator(): HTMLElement {
	const el = document.createElement( 'div' );
	el.className =
		'wapuu-chat__msg wapuu-chat__msg--assistant wapuu-chat__typing';
	el.setAttribute( 'aria-label', __( 'Typing' ) );
	el.innerHTML = '<span></span><span></span><span></span>';
	return el;
}

/** Compact one-line preview of a tool call's JSON arguments. */
function toolArgsPreview( args?: string ): string {
	const oneLine = ( args || '' ).replace( /\s+/g, ' ' ).trim();
	return oneLine.length > 48 ? oneLine.slice( 0, 47 ) + '…' : oneLine;
}

/** Build the chip elements for one chat message (content first, then tool calls). */
function buildChatChips( msg: WapuuChatMessage ): HTMLElement[] {
	const chips: HTMLElement[] = [];
	const content = ( msg.content || '' ).trim();
	if ( content ) {
		const chip = document.createElement( 'div' );
		chip.className = `wapuu-chat__msg wapuu-chat__msg--${ msg.role }`;
		chip.textContent = content;
		chips.push( chip );
	}
	for ( const call of msg.tool_calls || [] ) {
		const chip = document.createElement( 'div' );
		chip.className = 'wapuu-chat__msg wapuu-chat__msg--tool-call';
		const name = document.createElement( 'span' );
		name.className = 'wapuu-chat__tool-name';
		name.textContent = `⚙ ${ call.function?.name || 'tool' }`;
		chip.appendChild( name );
		const args = toolArgsPreview( call.function?.arguments );
		if ( args ) {
			chip.appendChild( document.createTextNode( ` ${ args }` ) );
		}
		chips.push( chip );
	}
	return chips;
}

/**
 * Append a chat message to an ask balloon's thread (and scroll it into
 * view). The engine uses this for the user's submitted reply; callers
 * could reuse it for streaming threads later.
 *
 * @param ask The balloon from {@link createAskBalloon}.
 * @param msg The message to append (OpenAI chat format).
 */
export function appendChatMessage( ask: AskBalloon, msg: WapuuChatMessage ): void {
	for ( const chip of buildChatChips( msg ) ) {
		ask.thread.appendChild( chip );
	}
	refreshChatThread( ask );
}

/**
 * Re-sync the thread's scroll state: pin it to the newest message and
 * toggle the "this pane scrolls" affordance (edge fade + visible
 * scrollbar via the `--scrollable` class) when content overflows.
 * Layout-dependent, so the engine calls it again after the balloon is
 * actually in the DOM / re-fit.
 *
 * @param ask The balloon from {@link createAskBalloon}.
 */
export function refreshChatThread( ask: AskBalloon ): void {
	const t = ask.thread;
	t.scrollTop = t.scrollHeight;
	t.classList.toggle(
		'wapuu-chat__thread--scrollable',
		t.scrollHeight > t.clientHeight + 1,
	);
}

/** The send button's paper-plane glyph (and its sent-state check). */
const SEND_ICON =
	'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 3 10.5 13.5"/><path d="M21 3l-6.8 18-3.7-7.5L3 9.8Z"/></svg>';
const SENT_ICON =
	'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12.5 9.5 18 20 6.5"/></svg>';

/** Flip an ask balloon's send button into its "sent" state. */
export function markAskSent( ask: AskBalloon ): void {
	ask.el.classList.add( 'wapuu-balloon--sent' );
	ask.send.innerHTML = SENT_ICON;
	ask.send.disabled = true;
}

/**
 * Create a `speak`-shaped balloon structured as a mini chat: a
 * scrollable message thread (OpenAI-format messages, incl. tool
 * calls) over an input row. The engine shapes it with {@link
 * fitBalloon} (as `speak`) and wires submit/cancel.
 *
 * @param prompt      Question — appended to the thread as a final
 *                    assistant message (may be empty).
 * @param placeholder Field placeholder.
 * @param messages    Optional seed thread, OpenAI chat format.
 */
export function createAskBalloon(
	prompt: string,
	placeholder: string,
	messages: WapuuChatMessage[] = [],
): AskBalloon {
	const el = document.createElement( 'div' );
	el.className = 'wapuu-balloon wapuu-balloon--speak wapuu-balloon--ask';

	// The bubble holds ONLY the thread; the input bar is a separate
	// floating pill BELOW the bubble (a child of the root, outside the
	// SVG shape), so the field stays clear of the tail and the bubble
	// can re-fit around the thread independently.
	const content = document.createElement( 'div' );
	content.className = 'wapuu-balloon__content';
	const thread = document.createElement( 'div' );
	thread.className = 'wapuu-chat__thread';
	content.appendChild( thread );
	el.appendChild( content );

	const row = document.createElement( 'div' );
	row.className = 'wapuu-chat__row';

	const input = document.createElement( 'input' );
	input.className = 'wapuu-balloon__input';
	input.type = 'text';
	input.placeholder = placeholder;

	const send = document.createElement( 'button' );
	send.className = 'wapuu-balloon__send';
	send.type = 'button';
	send.setAttribute( 'aria-label', __( 'Send' ) );
	send.innerHTML = SEND_ICON;

	row.appendChild( input );
	row.appendChild( send );
	el.appendChild( row );

	const ask: AskBalloon = { el, input, send, thread };
	for ( const msg of messages ) {
		appendChatMessage( ask, msg );
	}
	if ( prompt ) {
		appendChatMessage( ask, { role: 'assistant', content: prompt } );
	}
	return ask;
}

/**
 * Measure the (already-in-DOM) balloon's content, generate the SVG
 * shape sized to it, lay the content over the shape, and set the
 * element's transform-origin to the tail tip. Returns the tip offset
 * (in element px) so the engine can pin it to Wapuu's head.
 *
 * @param el       The balloon element from {@link createBalloon}.
 * @param type     Balloon style.
 * @param tailSide Which edge a speak tail grows from (default bottom).
 * @param mirror   Edge-aware flips (see {@link BalloonMirror}).
 */
export function fitBalloon(
	el: HTMLElement,
	type: BalloonType,
	tailSide: TailSide = 'bottom',
	mirror: BalloonMirror = {},
): { x: number; y: number } {
	const content = el.querySelector< HTMLElement >( '.wapuu-balloon__content' );
	if ( ! content ) {
		return { x: 0, y: 0 };
	}
	// Idempotent: a chat balloon re-fits after a message is appended so
	// the bubble grows around the thread — drop the previous shape.
	el.querySelector( '.wapuu-balloon__shape' )?.remove();
	const shape = build(
		type,
		content.offsetWidth,
		content.offsetHeight,
		tailSide,
		mirror,
	);
	// Flag for the tail aimer: updateChatTail converts its element-local
	// target into the mirrored drawing space.
	el.dataset.wapuuMirrorX = mirror.mirrorX ? '1' : '0';
	// The bubble body width (sans tail) — the ask input bar matches it.
	el.style.setProperty(
		'--wapuu-bubble-w',
		`${ f( shape.bodyWidth ?? shape.width ) }px`,
	);
	// Bubble dims for the dynamic tail aimer (see updateChatTail).
	el.dataset.wapuuBw = f( shape.bodyWidth ?? shape.width );
	el.dataset.wapuuBh = f( shape.height );

	el.style.width = `${ f( shape.width ) }px`;
	el.style.height = `${ f( shape.height ) }px`;
	el.style.transformOrigin = `${ f( shape.tipX ) }px ${ f( shape.tipY ) }px`;

	const shapeEl = document.createElement( 'div' );
	shapeEl.className = 'wapuu-balloon__shape';
	// Our own generated markup — no user data in the SVG (the message is
	// the separate, text-only content node).
	shapeEl.innerHTML = shape.svg;
	el.insertBefore( shapeEl, content );

	content.style.position = 'absolute';
	content.style.left = `${ f( shape.contentX ) }px`;
	content.style.top = `${ f( shape.contentY ) }px`;

	return { x: shape.tipX, y: shape.tipY };
}
