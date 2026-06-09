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
import { WAPUU_PARTS } from './parts';
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
}

// Rig geometry constants (raster resolution `R`, on-stage scale `S`,
// art centre `CX`/`CY`). The source art is authored in a 60×66 viewBox.
const R = 14;
const S = 6;
const CX = 30;
const CY = 33;
const NS = 'http://www.w3.org/2000/svg';
const TW = 60 * R;
const TH = 66 * R;

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
		const svg = `<svg xmlns="${ NS }" width="${ TW }" height="${ TH }" viewBox="0 0 60 66">${ inner }</svg>`;
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

	// ===== static back layers: WordPress ball + feet/paw =====
	bodyBone.addChild(
		artSprite(
			await rasterize( [ 'WordPress-blue2', 'WordPress-blue1', 'WordPress-logo' ] ),
		),
	);
	bodyBone.addChild(
		artSprite( await rasterize( [ 'sole-left', 'sole-right', 'hand-right' ] ) ),
	);

	// ===== animated limb bones (behind the body) =====
	// Source `ear-left` is the big floppy ear on the screen-RIGHT; source
	// `ear-right` is the small ear on the screen-LEFT. The pet engine's
	// earL/earR follow that screen-side naming.
	const earR = bone( await rasterize( [ 'ear-left' ] ), 43, 9 );
	const earL = bone( await rasterize( [ 'ear-right' ] ), 13.5, 14 );
	const tail = bone( await rasterize( [ 'tail' ] ), 42, 48 );
	bodyBone.addChild( earR, earL, tail );

	// ===== body + nose (paints OVER the limbs, hiding their bases) =====
	bodyBone.addChild( artSprite( await rasterize( [ 'left-body', 'nose' ] ) ) );

	// ===== eyes (blink + look), on top =====
	const eyeL = bone( await rasterize( [ 'eye-left' ] ), 17.75, 10.17 );
	const eyeR = bone( await rasterize( [ 'eye-right' ] ), 30.06, 7.22 );
	bodyBone.addChild( eyeL, eyeR );

	const parts: WapuuParts = {
		root,
		body: bodyBone,
		tail,
		earL,
		earR,
		eyeL,
		eyeR,
	};

	return { root, parts };
}
