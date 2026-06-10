/**
 * Desktop Mode — Wapuu widget: rig builder.
 *
 * Builds the Wapuu PixiJS rig from the source artwork ({@link
 * WAPUU_PARTS}, generated from `assets/wapuu-original.svg`). Each part
 * carries its OWN baked black stroke (`paint-order: stroke`), so —
 * unlike the original demo art, which had a single merged outline path
 * for the whole body — a moving limb carries its own outline and the
 * rig needs no outline-clipping. We just rasterise each `<path>` (with
 * its stroke) to a texture, composite the static pieces, and pin the
 * animated pieces (tail, ears, eyes) onto their own bones.
 *
 * Source z-order (first = back): blue2, blue1, logo, sole-left,
 *   sole-right, hand-right, ear-left, ear-right, tail, left-body, nose,
 *   eye-left, eye-right. The body (`left-body`) paints OVER the limbs,
 *   so each limb's attachment point is hidden behind the body and only
 *   the protruding part shows as it moves.
 *
 * @since 0.19.0
 */

import type { Container, Sprite, Texture } from 'pixi.js';
import { WAPUU_PARTS, WAPUU_VIEWBOX } from './parts';
import type { WapuuPart } from './parts';

/** The `pixi.js` module namespace, resolved at runtime from `window.PIXI`. */
type Pixi = typeof import( 'pixi.js' );

/**
 * The animated bones the pet engine drives. Every entry is a PixiJS
 * `Container` so the engine can read/write `position`, `scale`, and
 * `rotation` uniformly.
 */
export interface WapuuParts {
	/** Top-level container — the engine positions this in the stage. */
	root: Container;
	/** Body bone — breathing squash/stretch lives here (holds everything). */
	body: Container;
	/** Orange tail bone — sways. */
	tail: Container;
	/** Small ear (screen-left). */
	earL: Container;
	/** Big floppy ear (screen-right). */
	earR: Container;
	/** Left eye bone (blink + look). */
	eyeL: Container;
	/** Right eye bone (blink + look). */
	eyeR: Container;
	/** The white W logo on the ball — shrinks away to reveal… */
	logo: Container;
	/** …the "?" (same painted-on-the-sphere style). Starts at scale 0. */
	question: Container;
	/**
	 * Wrapper around logo + question, pivoted at the disc centre. The
	 * hover affordance scales THIS, independent of the W⇄? swap tweens
	 * that scale the inner bones.
	 */
	ballButton: Container;
	/** Ball-button hit geometry, in root-local px (pre-baseScale). */
	ball: { x: number; y: number; radius: number };
	/**
	 * Named art-space anchors (root-local px, pre-baseScale). The single
	 * source of truth for "where is X on Wapuu" — the engine multiplies
	 * by its live scale. Centralised here so a redrawn SVG is re-tuned
	 * in one place instead of hunting magic numbers across files.
	 */
	anchors: {
		/** Mouth/nose point the chat tail aims at. */
		mouth: { x: number; y: number };
		/** Top of the head — comic balloons hover above this. */
		headTop: { x: number; y: number };
		/** Side anchor the chat balloon pins beside (left of the head). */
		chatSide: { x: number; y: number };
		/** Tap-to-pet hit circle (covers body, head, ears, crown). */
		bodyHit: { x: number; y: number; radius: number };
	};
}

// Rig geometry constants (raster resolution `R`, on-stage scale `S`,
// art centre `CX`/`CY`). The raster size derives from the art's
// authored viewBox (parts.ts) so a regenerated SVG can't silently
// desync the rasterizer.
const R = 14;
const S = 6;
const CX = 30;
const CY = 33;
const NS = 'http://www.w3.org/2000/svg';
const VW = WAPUU_VIEWBOX[ 2 ];
const VH = WAPUU_VIEWBOX[ 3 ];
const TW = VW * R;
const TH = VH * R;

/** Look up a part by id, throwing if the art is missing it. */
function byId( id: string ): WapuuPart {
	const part = WAPUU_PARTS.find( ( p ) => p.id === id );
	if ( ! part ) {
		throw new Error( `[desktop-mode/wapuu] missing part: ${ id }` );
	}
	return part;
}

/** One `<path>` rendered verbatim — fill + the baked-stroke `style`. */
function pathMarkup( part: WapuuPart ): string {
	return `<path d="${ part.d }" fill="${ part.fill }" style="${ part.style }"/>`;
}

/** Rasterise an inline SVG fragment to an `<img>` at the rig resolution. */
function svgImage( inner: string ): Promise< HTMLImageElement > {
	return new Promise( ( resolve, reject ) => {
		const svg = `<svg xmlns="${ NS }" width="${ TW }" height="${ TH }" viewBox="0 0 ${ VW } ${ VH }">${ inner }</svg>`;
		const img = new Image();
		img.onload = () => resolve( img );
		img.onerror = reject;
		img.src = 'data:image/svg+xml;base64,' + btoa( svg );
	} );
}

/** A fresh offscreen canvas sized to the rig raster. */
function newCanvas(): HTMLCanvasElement {
	const c = document.createElement( 'canvas' );
	c.width = TW;
	c.height = TH;
	return c;
}

/** 2D context for a canvas, throwing if the browser can't provide one. */
function ctx2d( c: HTMLCanvasElement ): CanvasRenderingContext2D {
	const x = c.getContext( '2d' );
	if ( ! x ) {
		throw new Error( '[desktop-mode/wapuu] 2D canvas context unavailable.' );
	}
	return x;
}

/**
 * Pick the largest subpath of a multi-subpath `d` (by rough bbox area)
 * and return it with its centre. For the WordPress-logo part this is
 * the white DISC — the W letterforms are smaller subpaths punched out
 * of it via `evenodd`. Coordinates in a `d` come in x,y pairs, so a
 * pairwise scan of the numbers gives a good-enough bbox.
 */
function largestSubpath( d: string ): { d: string; cx: number; cy: number } {
	const subs = d.split( /(?=[Mm])/ ).filter( ( s ) => /[Mm]/.test( s ) );
	let best: { d: string; cx: number; cy: number; area: number } | null = null;
	for ( const sub of subs ) {
		const nums = ( sub.match( /-?\d*\.?\d+(?:e-?\d+)?/g ) || [] ).map( Number );
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for ( let i = 0; i + 1 < nums.length; i += 2 ) {
			minX = Math.min( minX, nums[ i ] );
			maxX = Math.max( maxX, nums[ i ] );
			minY = Math.min( minY, nums[ i + 1 ] );
			maxY = Math.max( maxY, nums[ i + 1 ] );
		}
		const area = ( maxX - minX ) * ( maxY - minY );
		if ( Number.isFinite( area ) && ( ! best || area > best.area ) ) {
			best = {
				d: sub.trim(),
				cx: ( minX + maxX ) / 2,
				cy: ( minY + maxY ) / 2,
				area,
			};
		}
	}
	if ( ! best ) {
		throw new Error( '[desktop-mode/wapuu] could not split the logo path.' );
	}
	return { d: best.d, cx: best.cx, cy: best.cy };
}

/**
 * Build the Wapuu rig. Returns the root container and the animated
 * bones. Async because every texture is rasterised through an
 * `<img>` data-URI load.
 *
 * @param pixi The `pixi.js` namespace (`window.PIXI`).
 */
export async function buildWapuu(
	pixi: Pixi,
): Promise< { root: Container; parts: WapuuParts } > {
	const root = new pixi.Container();
	const bodyBone = new pixi.Container();
	bodyBone.position.set( 0, -( 50 - CY ) * S );
	root.addChild( bodyBone );

	// Wrap a rasterised canvas in a mipmapped, linearly-sampled texture.
	// The art is rasterised oversized (840×924) and always drawn
	// downscaled (~2–5× minification), so without mipmaps the thin black
	// line-art aliases into hard, jagged "borders". `autoGenerateMipmaps`
	// + linear filtering give smooth, soft edges — the crisp-at-any-size
	// look you'd expect from the source SVG.
	const tex = ( c: HTMLCanvasElement ): Texture =>
		new pixi.Texture( {
			source: new pixi.CanvasSource( {
				resource: c,
				autoGenerateMipmaps: true,
				scaleMode: 'linear',
			} ),
		} );

	function artSprite( t: Texture ): Sprite {
		const sp = new pixi.Sprite( t );
		sp.anchor.set( 0 );
		sp.scale.set( S / R );
		sp.position.set( -CX * S, -CY * S );
		return sp;
	}
	function bone( t: Texture, ax: number, ay: number ): Container {
		const c = new pixi.Container();
		c.addChild( artSprite( t ) );
		const pvx = ( ax - CX ) * S;
		const pvy = ( ay - CY ) * S;
		c.pivot.set( pvx, pvy );
		c.position.set( pvx, pvy );
		return c;
	}
	// Rasterise one or more parts (in the given z-order) into one texture.
	// Co-rasterising overlapping static pieces in a single SVG pass keeps
	// their strokes compositing exactly as the source SVG does.
	async function rasterize( ids: string[] ): Promise< Texture > {
		const inner = ids.map( ( id ) => pathMarkup( byId( id ) ) ).join( '' );
		const c = newCanvas();
		ctx2d( c ).drawImage( await svgImage( inner ), 0, 0, TW, TH );
		return tex( c );
	}

	// "?" texture: the logo's white disc (which carries the art's sphere
	// distortion) with a question mark CARVED out of it (destination-out)
	// so the blue sphere shows through the glyph — exactly how the W
	// letterforms read (they're evenodd holes in that disc). Slightly
	// tilted to match the logo's perspective.
	const logoPart = byId( 'WordPress-logo' );
	const disc = largestSubpath( logoPart.d );
	async function questionTex(): Promise< Texture > {
		const q = ( dx: number, dy: number ): string =>
			`${ ( disc.cx + dx ).toFixed( 2 ) } ${ ( disc.cy + dy ).toFixed( 2 ) }`;
		const questionGlyph =
			`<g transform="rotate(-9 ${ disc.cx.toFixed( 2 ) } ${ disc.cy.toFixed( 2 ) })">` +
			`<path d="M ${ q( -3.4, -3.2 ) } C ${ q( -3.4, -7.2 ) } ${ q(
				-1.6,
				-8.5,
			) } ${ q( 0.2, -8.5 ) } C ${ q( 2.7, -8.5 ) } ${ q( 3.7, -6.5 ) } ${ q(
				3.7,
				-4.8,
			) } C ${ q( 3.7, -2.8 ) } ${ q( 2.3, -1.8 ) } ${ q( 1.0, -0.9 ) } C ${ q(
				0.1,
				-0.2,
			) } ${ q( -0.1, 0.7 ) } ${ q( -0.1, 2.0 ) }" fill="none" stroke="#000" stroke-width="2.7" stroke-linecap="round"/>` +
			`<circle cx="${ ( disc.cx - 0.1 ).toFixed( 2 ) }" cy="${ (
				disc.cy + 5.4
			).toFixed( 2 ) }" r="1.7" fill="#000"/>` +
			'</g>';
		const [ discImg, glyphImg ] = await Promise.all( [
			svgImage( `<path d="${ disc.d }" fill="#FFFFFF"/>` ),
			svgImage( questionGlyph ),
		] );
		const c = newCanvas();
		const x = ctx2d( c );
		x.drawImage( discImg, 0, 0, TW, TH );
		x.globalCompositeOperation = 'destination-out';
		x.drawImage( glyphImg, 0, 0, TW, TH );
		x.globalCompositeOperation = 'source-over';
		return tex( c );
	}

	// Rasterise ALL textures in parallel — each is an independent
	// <img> SVG decode, and serialising them multiplied mount latency
	// by the part count.
	const [
		bluesTex,
		logoTex,
		qTex,
		feetTex,
		earRTex,
		earLTex,
		tailTex,
		bodyTex,
		eyeLTex,
		eyeRTex,
	] = await Promise.all( [
		rasterize( [ 'WordPress-blue2', 'WordPress-blue1' ] ),
		rasterize( [ 'WordPress-logo' ] ),
		questionTex(),
		rasterize( [ 'sole-left', 'sole-right', 'hand-right' ] ),
		rasterize( [ 'ear-left' ] ),
		rasterize( [ 'ear-right' ] ),
		rasterize( [ 'tail' ] ),
		rasterize( [ 'left-body', 'nose' ] ),
		rasterize( [ 'eye-left' ] ),
		rasterize( [ 'eye-right' ] ),
	] );

	// ===== the WordPress ball: blue sphere + a swappable W/"?" =====
	// The blues stay one static layer; the W logo gets its OWN bone so
	// it can shrink away and swap with a "?" (the ball is a help button
	// that opens the chat). Both bones pivot at the logo disc's centre.
	bodyBone.addChild( artSprite( bluesTex ) );
	const logo = bone( logoTex, disc.cx, disc.cy );
	const question = bone( qTex, disc.cx, disc.cy );
	question.scale.set( 0 ); // hidden until the ball is tapped
	// Hover-affordance wrapper, pivoted at the same disc centre.
	const ballButton = new pixi.Container();
	const bpx = ( disc.cx - CX ) * S;
	const bpy = ( disc.cy - CY ) * S;
	ballButton.pivot.set( bpx, bpy );
	ballButton.position.set( bpx, bpy );
	ballButton.addChild( logo, question );
	bodyBone.addChild( ballButton );

	bodyBone.addChild( artSprite( feetTex ) );

	// ===== animated limb bones (behind the body) =====
	// Source `ear-left` is the big floppy ear on the screen-RIGHT; source
	// `ear-right` is the small ear on the screen-LEFT. The pet engine's
	// earL/earR follow that screen-side naming.
	const earR = bone( earRTex, 43, 9 );
	const earL = bone( earLTex, 13.5, 14 );
	const tail = bone( tailTex, 42, 48 );
	bodyBone.addChild( earR, earL, tail );

	// ===== body + nose (paints OVER the limbs, hiding their bases) =====
	bodyBone.addChild( artSprite( bodyTex ) );

	// ===== eyes (blink + look), on top =====
	const eyeL = bone( eyeLTex, 17.75, 10.17 );
	const eyeR = bone( eyeRTex, 30.06, 7.22 );
	bodyBone.addChild( eyeL, eyeR );

	// Ball-button hit circle, root-local px (pre-baseScale): centre +
	// radius derived from the big blue sphere's actual path extents, so
	// the hit zone tracks the art if it's redrawn.
	const blueBox = largestSubpath( byId( 'WordPress-blue2' ).d );
	const blueNums = ( byId( 'WordPress-blue2' ).d.match( /-?\d*\.?\d+/g ) || [] ).map(
		Number,
	);
	let bMinX = Infinity;
	let bMaxX = -Infinity;
	let bMinY = Infinity;
	let bMaxY = -Infinity;
	for ( let i = 0; i + 1 < blueNums.length; i += 2 ) {
		bMinX = Math.min( bMinX, blueNums[ i ] );
		bMaxX = Math.max( bMaxX, blueNums[ i ] );
		bMinY = Math.min( bMinY, blueNums[ i + 1 ] );
		bMaxY = Math.max( bMaxY, blueNums[ i + 1 ] );
	}
	const ball = {
		x: ( blueBox.cx - CX ) * S,
		y: ( blueBox.cy - CY ) * S - ( 50 - CY ) * S,
		radius: ( Math.max( bMaxX - bMinX, bMaxY - bMinY ) / 2 ) * S,
	};

	// Hand-tuned art anchors (root-local px). Tuned against the current
	// SVG; if the art is redrawn, re-tune HERE — nothing else hardcodes
	// Wapuu geometry.
	const anchors = {
		mouth: { x: -48, y: -215 },
		headTop: { x: 0, y: -245 },
		chatSide: { x: -115, y: -175 },
		// Generous circle covering body, head, ears, and crown so any
		// tap on the visible sprite counts as a pet.
		bodyHit: { x: 0, y: -110, radius: 210 },
	};

	const parts: WapuuParts = {
		root,
		body: bodyBone,
		tail,
		earL,
		earR,
		eyeL,
		eyeR,
		logo,
		question,
		ballButton,
		ball,
		anchors,
	};

	return { root, parts };
}
