/**
 * `<os-tribute-heart>` — the heart in Station Home's "Thank you, Eric".
 *
 * At rest the element is just the Dashicons heart it wraps. When the
 * link is hovered (or focused from the keyboard) the glyph is copied
 * pixel for pixel onto a canvas laid exactly over it, and the real
 * glyph is hidden, so nothing visibly changes on that frame. Those
 * same pixels then lift off, arc across the line and open out into a
 * heart drawn around the name, staying heart shaped all the way. The
 * words slide left into the place the glyph left, and the name steps
 * right so the heart clears the words before it.
 * While the pointer stays, the pixels keep travelling around the
 * outline and the heart beats. On leave they fly back to the exact
 * pixel they came from and the glyph returns.
 *
 * The canvas lives inside this element so the App Framework's morph,
 * told by `os-preserve` to leave the element alone, never removes it
 * mid-flight. It is positioned against the link, which is the nearest
 * positioned ancestor.
 *
 * Reduced motion keeps the plain glyph.
 *
 * Built as its own bundle (`assets/js/apps/station-home-tribute[.min].js`),
 * a companion script of the Station Home window.
 */

import { createHeartOutline, fitHeartAround, mapToOutline, type HeartOutline, type Vec } from './heart';

const TAG = 'os-tribute-heart';

/** Canvas bleed around the link, in CSS pixels. */
const BLEED = 72;
const ENTER_MS = 1400;
const LEAVE_MS = 950;
/** The largest head start one pixel gets over another; small, so the shape holds. */
const STAGGER = 0.06;
/** Stroke width of the big heart, in CSS pixels. */
const STROKE = 1.8;
/** Space between the name and the heart, in CSS pixels. */
const NAME_PAD_X = 8;
const NAME_PAD_Y = 4;
/** Space kept between the heart and the words before the name, in CSS pixels. */
const NAME_GAP = 6;
/**
 * How far the heart sits above the fitted centre, in CSS pixels. The
 * name's line box carries more space under the letters than over
 * them, so a heart fitted to the box reads low.
 */
const HEART_LIFT = 3;

type Rgba = [ number, number, number, number ];

interface Pixel {
	/** Offset from the glyph's centre, CSS pixels. */
	fx: number;
	fy: number;
	/** Coverage, 0–1. */
	alpha: number;
	u: number;
	band: number;
	delay: number;
	seed: number;
}

let sharedOutline: HeartOutline | null = null;

function outline(): HeartOutline {
	if ( ! sharedOutline ) {
		sharedOutline = createHeartOutline();
	}
	return sharedOutline;
}

function clamp01( v: number ): number {
	return Math.min( 1, Math.max( 0, v ) );
}

function easeInOutCubic( t: number ): number {
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow( -2 * t + 2, 3 ) / 2;
}

function easeOutBack( t: number ): number {
	const c1 = 1.4;
	const c3 = c1 + 1;
	return 1 + c3 * Math.pow( t - 1, 3 ) + c1 * Math.pow( t - 1, 2 );
}

function easeInOutSine( t: number ): number {
	return -( Math.cos( Math.PI * t ) - 1 ) / 2;
}

function smoothstep( a: number, b: number, v: number ): number {
	const t = clamp01( ( v - a ) / ( b - a ) );
	return t * t * ( 3 - 2 * t );
}

/** A deterministic 0–1 value per pixel. */
function hash( i: number ): number {
	const s = Math.sin( i * 12.9898 + 78.233 ) * 43758.5453;
	return s - Math.floor( s );
}

/** Lub-dub, 0–1, once every 1.4 seconds. */
function heartbeat( seconds: number ): number {
	const x = seconds % 1.4;
	const pulse = ( mu: number, sigma: number ) => Math.exp( -Math.pow( ( x - mu ) / sigma, 2 ) );
	return Math.min( 1, pulse( 0.08, 0.05 ) + 0.6 * pulse( 0.34, 0.06 ) );
}

/** Any CSS colour, as RGBA bytes plus 0–1 alpha. */
function parseColor( value: string, fallback: Rgba ): Rgba {
	const probe = document.createElement( 'canvas' ).getContext( '2d' );
	if ( ! probe || '' === value.trim() ) {
		return fallback;
	}
	probe.fillStyle = '#010203';
	probe.fillStyle = value.trim();
	const normal = String( probe.fillStyle );
	if ( normal.startsWith( '#' ) ) {
		if ( '#010203' === normal && '#010203' !== value.trim() ) {
			return fallback;
		}
		const byte = ( at: number ) => parseInt( normal.slice( at, at + 2 ), 16 );
		return [ byte( 1 ), byte( 3 ), byte( 5 ), 1 ];
	}
	const parts = normal.match( /[\d.]+/g );
	if ( ! parts || parts.length < 3 ) {
		return fallback;
	}
	return [ +parts[ 0 ], +parts[ 1 ], +parts[ 2 ], parts.length > 3 ? +parts[ 3 ] : 1 ];
}

/** The glyph a pseudo-element's `content` paints. */
function pseudoContent( value: string ): string {
	const v = value.trim();
	if ( v.length >= 2 && ( v[ 0 ] === '"' || v[ 0 ] === "'" ) && v[ v.length - 1 ] === v[ 0 ] ) {
		return v.slice( 1, -1 );
	}
	return 'none' === v || 'normal' === v ? '' : v;
}

export class OsTributeHeart extends HTMLElement {
	private link: HTMLElement | null = null;
	private canvas: HTMLCanvasElement | null = null;
	private ctx: CanvasRenderingContext2D | null = null;
	private pixels: Pixel[] = [];
	private positions = new Float32Array( 0 );
	private dpr = 1;
	/** Glyph centre and heart centre, relative to the canvas, CSS pixels. */
	private from: Vec = { x: 0, y: 0 };
	private to: Vec = { x: 0, y: 0 };
	/** Big heart width, and its ratio to the glyph. */
	private heartWidth = 0;
	private glyphWidth = 1;
	private ratio = 1;
	/** Canvas origin in the viewport, CSS pixels. */
	private origin: Vec = { x: 0, y: 0 };
	private rest: Rgba = [ 102, 99, 107, 1 ];
	private glow: Rgba = [ 255, 90, 95, 1 ];
	private progress = 0;
	private goal = 0;
	private clock = 0;
	private last = 0;
	private frame = 0;
	private resize: ResizeObserver | null = null;
	/**
	 * The words, which slide left into the glyph's place, and the name
	 * inside them, which steps right to make room for the heart: how
	 * far in full, and how far right now.
	 */
	private words: HTMLElement | null = null;
	private wordsShift = 0;
	private wordsOffset = 0;
	private name: HTMLElement | null = null;
	private nameShift = 0;
	private nameOffset = 0;

	connectedCallback(): void {
		this.link = this.closest( 'a' );
		if ( ! this.link ) {
			return;
		}
		this.link.addEventListener( 'pointerenter', this.onEnter );
		this.link.addEventListener( 'pointerleave', this.onLeave );
		this.link.addEventListener( 'focus', this.onFocus );
		this.link.addEventListener( 'blur', this.onBlur );
	}

	disconnectedCallback(): void {
		if ( this.link ) {
			this.link.removeEventListener( 'pointerenter', this.onEnter );
			this.link.removeEventListener( 'pointerleave', this.onLeave );
			this.link.removeEventListener( 'focus', this.onFocus );
			this.link.removeEventListener( 'blur', this.onBlur );
		}
		this.stop();
		this.link = null;
	}

	private onEnter = (): void => {
		this.setGoal( 1 );
	};

	private onLeave = (): void => {
		if ( ! this.link?.matches( ':focus-visible' ) ) {
			this.setGoal( 0 );
		}
	};

	private onFocus = (): void => {
		if ( this.link?.matches( ':focus-visible' ) ) {
			this.setGoal( 1 );
		}
	};

	private onBlur = (): void => {
		if ( ! this.link?.matches( ':hover' ) ) {
			this.setGoal( 0 );
		}
	};

	private setGoal( goal: number ): void {
		if ( window.matchMedia?.( '( prefers-reduced-motion: reduce )' ).matches ) {
			return;
		}
		if ( 1 === goal && 0 === this.progress && ! this.frame && ! this.prepare() ) {
			return;
		}
		this.goal = goal;
		if ( ! this.frame && ( this.progress > 0 || goal > 0 ) ) {
			this.last = performance.now();
			this.frame = requestAnimationFrame( this.tick );
		}
	}

	/**
	 * Lay the canvas over the link and copy the glyph into pixels.
	 * Returns false when there is nothing to animate.
	 */
	private prepare(): boolean {
		const glyph = this.querySelector< HTMLElement >( '.dashicons' );
		if ( ! this.link || ! glyph || ! this.place() ) {
			return false;
		}
		const style = getComputedStyle( this.link );
		this.rest = parseColor( style.getPropertyValue( '--os-tribute-heart-rest' ), this.rest );
		this.glow = parseColor( style.getPropertyValue( '--os-tribute-heart-glow' ), this.glow );
		return this.capture( glyph );
	}

	/** Size and align the canvas, and measure where the heart goes. */
	private place(): boolean {
		const link = this.link;
		const name = link?.querySelector< HTMLElement >( '[data-os-tribute-name]' );
		const glyph = this.querySelector< HTMLElement >( '.dashicons' );
		if ( ! link || ! name || ! glyph ) {
			return false;
		}
		const box = link.getBoundingClientRect();
		if ( box.width <= 0 || box.height <= 0 ) {
			return false;
		}
		this.dpr = window.devicePixelRatio || 1;
		const dpr = this.dpr;

		if ( ! this.canvas ) {
			this.canvas = document.createElement( 'canvas' );
			this.canvas.className = 'os-tribute-heart__canvas';
			this.canvas.setAttribute( 'aria-hidden', 'true' );
			this.ctx = this.canvas.getContext( '2d' );
			this.appendChild( this.canvas );
		}
		if ( ! this.ctx ) {
			return false;
		}

		// Start the canvas on a whole device pixel, so a canvas pixel
		// is a screen pixel and the copy lands exactly on the glyph.
		const left = Math.round( ( box.left - BLEED ) * dpr ) / dpr;
		const top = Math.round( ( box.top - BLEED ) * dpr ) / dpr;
		const width = Math.ceil( ( box.width + BLEED * 2 ) * dpr );
		const height = Math.ceil( ( box.height + BLEED * 2 ) * dpr );
		this.canvas.style.left = `${ left - box.left }px`;
		this.canvas.style.top = `${ top - box.top }px`;
		this.canvas.style.width = `${ width / dpr }px`;
		this.canvas.style.height = `${ height / dpr }px`;
		if ( this.canvas.width !== width || this.canvas.height !== height ) {
			this.canvas.width = width;
			this.canvas.height = height;
		}
		this.origin = { x: left, y: top };

		// Everything measured where it rests, not where it has moved to.
		this.name = name;
		this.words = name.parentElement;
		const n = name.getBoundingClientRect();
		const nameLeft = n.left - this.nameOffset - this.wordsOffset;

		// With the glyph gone, the words take its place.
		this.wordsShift = 0;
		if ( this.words && this.words !== link ) {
			this.wordsShift = Math.min( 0, glyph.getBoundingClientRect().left - ( this.words.getBoundingClientRect().left - this.wordsOffset ) );
		}
		const fit = fitHeartAround( outline(), n.width + NAME_PAD_X * 2, n.height + NAME_PAD_Y * 2 );
		this.heartWidth = fit.width;
		this.ratio = this.heartWidth / this.glyphWidth;

		// The heart is wider than the name; the name steps right until
		// the heart clears the words before it ("Thank you,").
		this.nameShift = 0;
		const before = name.previousSibling;
		const words = before && Node.TEXT_NODE === before.nodeType ? ( before.textContent ?? '' ).trimEnd() : '';
		if ( before && '' !== words ) {
			const range = document.createRange();
			range.setStart( before, 0 );
			range.setEnd( before, words.length );
			const heartLeft = nameLeft + n.width / 2 - fit.width / 2;
			const wordsRight = range.getBoundingClientRect().right - this.wordsOffset;
			this.nameShift = Math.max( 0, wordsRight + NAME_GAP - heartLeft );
		}

		this.to = {
			x: nameLeft + n.width / 2 + this.nameShift + this.wordsShift - left,
			y: n.top + n.height / 2 - fit.offsetY - HEART_LIFT - top,
		};
		return true;
	}

	/** Rasterise the glyph exactly as the page paints it, and keep its pixels. */
	private capture( glyph: HTMLElement ): boolean {
		const dpr = this.dpr;
		const { x: left, y: top } = this.origin;
		const before = getComputedStyle( glyph, '::before' );
		const char = pseudoContent( before.content );
		if ( '' === char ) {
			return false;
		}
		const rect = glyph.getBoundingClientRect();
		const font = `${ before.fontStyle } ${ before.fontWeight } ${ before.fontSize } ${ before.fontFamily }`;
		const fontSize = parseFloat( before.fontSize ) || rect.height;
		const lineHeight = parseFloat( before.lineHeight ) || fontSize;

		// Room for a glyph that overhangs its box.
		const margin = Math.ceil( fontSize * 0.5 * dpr );
		const x0 = Math.floor( ( rect.left - left ) * dpr ) - margin;
		const y0 = Math.floor( ( rect.top - top ) * dpr ) - margin;
		const w = Math.ceil( rect.width * dpr ) + margin * 2;
		const h = Math.ceil( rect.height * dpr ) + margin * 2;

		const scratch = document.createElement( 'canvas' );
		scratch.width = w;
		scratch.height = h;
		const sctx = scratch.getContext( '2d', { willReadFrequently: true } );
		if ( ! sctx ) {
			return false;
		}
		sctx.font = font;
		const metrics = sctx.measureText( char );
		const ascent = metrics.fontBoundingBoxAscent ?? fontSize * 0.8;
		const descent = metrics.fontBoundingBoxDescent ?? fontSize * 0.2;
		// The inline box of `::before`: centred in its line, centred in the icon box.
		const baseline = rect.top + ( lineHeight - ( ascent + descent ) ) / 2 + ascent;
		const start = rect.left + ( rect.width - metrics.width ) / 2;

		sctx.setTransform( dpr, 0, 0, dpr, -x0, -y0 );
		sctx.textBaseline = 'alphabetic';
		sctx.fillStyle = '#fff';
		sctx.fillText( char, start - left, baseline - top );

		const data = sctx.getImageData( 0, 0, w, h ).data;
		const raw: { x: number; y: number; a: number }[] = [];
		let minX = Infinity;
		let maxX = -Infinity;
		let minY = Infinity;
		let maxY = -Infinity;
		for ( let row = 0; row < h; row++ ) {
			for ( let col = 0; col < w; col++ ) {
				const a = data[ ( row * w + col ) * 4 + 3 ];
				if ( a < 3 ) {
					continue;
				}
				const x = x0 + col;
				const y = y0 + row;
				raw.push( { x, y, a: a / 255 } );
				minX = Math.min( minX, x );
				maxX = Math.max( maxX, x + 1 );
				minY = Math.min( minY, y );
				maxY = Math.max( maxY, y + 1 );
			}
		}
		if ( 0 === raw.length ) {
			return false;
		}

		this.from = { x: ( minX + maxX ) / 2 / dpr, y: ( minY + maxY ) / 2 / dpr };
		const glyphWidth = ( maxX - minX ) / dpr;
		this.glyphWidth = glyphWidth;
		this.ratio = this.heartWidth / glyphWidth;

		const offsets = raw.map( ( p ) => ( { x: ( p.x + 0.5 ) / dpr - this.from.x, y: ( p.y + 0.5 ) / dpr - this.from.y } ) );
		const slots = mapToOutline( outline(), offsets.map( ( o ) => ( { x: o.x / glyphWidth, y: o.y / glyphWidth } ) ) );
		this.pixels = offsets.map( ( o, i ) => ( {
			fx: o.x,
			fy: o.y,
			alpha: raw[ i ].a,
			u: slots[ i ].u,
			band: slots[ i ].band,
			// Outer pixels leave first and land last, like a skin peeling off.
			delay: STAGGER * ( 0.75 * ( 1 - ( slots[ i ].band + 1 ) / 2 ) + 0.25 * hash( i ) ),
			seed: hash( i + 1000 ),
		} ) );
		this.positions = new Float32Array( this.pixels.length * 2 );
		return true;
	}

	private tick = ( now: number ): void => {
		const dt = Math.min( 64, now - this.last );
		this.last = now;
		this.clock += dt / 1000;
		const step = dt / ( this.goal > this.progress ? ENTER_MS : LEAVE_MS );
		this.progress = this.goal > this.progress ? Math.min( this.goal, this.progress + step ) : Math.max( this.goal, this.progress - step );

		if ( 0 === this.progress && 0 === this.goal ) {
			this.stop();
			return;
		}
		if ( ! this.resize && 'function' === typeof ResizeObserver && this.link ) {
			this.resize = new ResizeObserver( () => this.place() );
			this.resize.observe( this.link );
		}
		this.draw();
		// Swap on the same frame as the first paint of the copy.
		this.setAttribute( 'active', '' );
		this.frame = requestAnimationFrame( this.tick );
	};

	private stop(): void {
		if ( this.frame ) {
			cancelAnimationFrame( this.frame );
			this.frame = 0;
		}
		this.resize?.disconnect();
		this.resize = null;
		this.progress = 0;
		this.goal = 0;
		this.ctx?.clearRect( 0, 0, this.canvas?.width ?? 0, this.canvas?.height ?? 0 );
		this.removeAttribute( 'active' );
		this.moveWords( 0, 0 );
	}

	/** Slide the words and, within them, the name, by CSS pixels. */
	private moveWords( words: number, name: number ): void {
		const slide = ( el: HTMLElement | null, by: number ) => {
			if ( el ) {
				el.style.transform = Math.abs( by ) > 0.01 ? `translateX(${ by.toFixed( 2 ) }px)` : '';
			}
		};
		this.wordsOffset = words;
		this.nameOffset = name;
		slide( this.words, words );
		slide( this.name, name );
	}

	private draw(): void {
		const ctx = this.ctx;
		const canvas = this.canvas;
		if ( ! ctx || ! canvas ) {
			return;
		}
		const shape = outline();
		const dpr = this.dpr;
		const p = this.progress;
		const t = this.clock;
		const settled = smoothstep( 0.82, 1, p );
		const beat = 1 + 0.075 * heartbeat( t ) * settled;
		const flow = t * 0.045;
		// Dots big enough that the pixels, however few, read as one line.
		const perimeter = this.heartWidth * 3.2 * dpr;
		const dotEnd = Math.min( 3, Math.max( 1.5, ( perimeter / Math.max( 1, this.pixels.length ) ) * 1.05 ) );

		// The arc the heart flies along: up and over.
		const travel = Math.hypot( this.to.x - this.from.x, this.to.y - this.from.y );
		const control = {
			x: ( this.from.x + this.to.x ) / 2,
			y: Math.min( this.from.y, this.to.y ) - Math.max( 14, travel * 0.32 ),
		};

		ctx.setTransform( 1, 0, 0, 1, 0, 0 );
		ctx.clearRect( 0, 0, canvas.width, canvas.height );

		const [ rr, rg, rb, ra ] = this.rest;
		const [ gr, gg, gb ] = this.glow;
		const colors: string[] = new Array( this.pixels.length );
		const sizes = new Float32Array( this.pixels.length );
		const glows = new Float32Array( this.pixels.length );

		// The heart as a whole: one clock for the flight, the growth
		// and the tilt, so every pixel agrees on where the heart is.
		const e = easeInOutCubic( p );
		const lift = Math.sin( Math.PI * e );
		const inv = 1 - e;
		const cx = inv * inv * this.from.x + 2 * inv * e * control.x + e * e * this.to.x;
		const cy = inv * inv * this.from.y + 2 * inv * e * control.y + e * e * this.to.y;
		const scale = 1 + ( this.ratio - 1 ) * easeOutBack( clamp01( ( p - 0.12 ) / 0.88 ) );
		const tilt = 0.24 * lift;
		const cos = Math.cos( tilt );
		const sin = Math.sin( tilt );
		const jitter = 0.8 * lift;

		// As the glyph lifts off, the words close the gap it leaves;
		// the name steps aside while the heart is in the air, so it is
		// ready when the heart lands round it.
		this.moveWords(
			this.wordsShift * easeInOutCubic( clamp01( ( p - 0.04 ) / 0.5 ) ),
			this.nameShift * easeInOutCubic( clamp01( ( p - 0.1 ) / 0.55 ) ),
		);

		this.pixels.forEach( ( px, i ) => {
			// Each pixel's own clock, a touch ahead or behind, for the
			// fill opening into an outline and for its colour.
			const q = clamp01( ( p - px.delay ) / ( 1 - STAGGER ) );
			// Become a small outline first, then grow: a handful of
			// pixels reads as a heart only as an outline.
			const morph = easeInOutSine( clamp01( q / 0.4 ) );

			// Where this pixel sits on the big heart, flowing round it.
			const u = px.u + flow;
			const o = shape.at( u );
			const n = shape.normal( u );
			const breathe = 0.35 * Math.sin( t * 3.1 + px.seed * Math.PI * 2 ) * settled;
			const across = px.band * ( STROKE / 2 ) + breathe;
			const ox = ( o.x * this.heartWidth + n.x * across ) * beat;
			const oy = ( o.y * this.heartWidth + n.y * across ) * beat;

			// Filled glyph → outline, in glyph scale, then grown and tilted.
			const fx = ( px.fx + ( ox / this.ratio - px.fx ) * morph ) * scale;
			const fy = ( px.fy + ( oy / this.ratio - px.fy ) * morph ) * scale;
			const lx = fx * cos - fy * sin + ( hash( i * 3 + 1 ) - 0.5 ) * jitter;
			const ly = fx * sin + fy * cos + ( hash( i * 7 + 2 ) - 0.5 ) * jitter;

			// Still home: snap, so the copy is the glyph's own pixels.
			const home = p < 0.02;
			this.positions[ i * 2 ] = home ? Math.round( ( cx + lx ) * dpr - 0.5 ) + 0.5 : ( cx + lx ) * dpr;
			this.positions[ i * 2 + 1 ] = home ? Math.round( ( cy + ly ) * dpr - 0.5 ) + 0.5 : ( cy + ly ) * dpr;

			// Colour: the resting grey warms to the heart colour, and a
			// spark runs round the outline once it has settled.
			const warm = smoothstep( 0, 0.55, q );
			const spark = Math.pow( 0.5 + 0.5 * Math.cos( Math.PI * 2 * ( px.u - t * 0.55 ) ), 12 ) * settled;
			let r = rr + ( gr - rr ) * warm;
			let g = rg + ( gg - rg ) * warm;
			let b = rb + ( gb - rb ) * warm;
			r += ( 255 - r ) * spark * 0.85;
			g += ( 255 - g ) * spark * 0.85;
			b += ( 255 - b ) * spark * 0.85;
			const a = ( px.alpha + ( 0.55 + 0.45 * px.alpha - px.alpha ) * morph ) * ( ra + ( 1 - ra ) * warm );
			colors[ i ] = `rgba(${ Math.round( r ) },${ Math.round( g ) },${ Math.round( b ) },${ a.toFixed( 3 ) })`;
			sizes[ i ] = 1 + ( dotEnd - 1 ) * morph;
			glows[ i ] = warm * a * ( 0.11 + 0.25 * spark );
		} );

		// A soft bloom under the pixels.
		ctx.globalCompositeOperation = 'lighter';
		for ( let i = 0; i < this.pixels.length; i++ ) {
			if ( glows[ i ] <= 0.002 ) {
				continue;
			}
			const s = sizes[ i ] * 3.2;
			ctx.fillStyle = `rgba(${ gr },${ gg },${ gb },${ glows[ i ].toFixed( 3 ) })`;
			ctx.fillRect( this.positions[ i * 2 ] - s / 2, this.positions[ i * 2 + 1 ] - s / 2, s, s );
		}
		ctx.globalCompositeOperation = 'source-over';
		for ( let i = 0; i < this.pixels.length; i++ ) {
			const s = sizes[ i ];
			ctx.fillStyle = colors[ i ];
			ctx.fillRect( this.positions[ i * 2 ] - s / 2, this.positions[ i * 2 + 1 ] - s / 2, s, s );
		}
	}
}

if ( ! customElements.get( TAG ) ) {
	customElements.define( TAG, OsTributeHeart );
}
