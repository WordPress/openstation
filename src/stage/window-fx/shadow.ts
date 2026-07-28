/**
 * Desktop Mode — a PixiJS stand-in for a window's CSS drop shadow.
 *
 * **Why this exists.** A capture is taken from `getBoundingClientRect()`,
 * which is the border box — and `box-shadow` paints *outside* it. So the
 * frozen copy of a window has never carried its shadow, and the moment
 * an effect handed the window back the shadow snapped into existence.
 * That is a real difference between the two images, so no amount of
 * timing the swap could hide it.
 *
 * Padding the capture to take the shadow with it was the other option
 * and is worse: the extra margin also picks up whatever was *behind* the
 * window, which then gets drawn stale over the live desktop — invisible
 * over plain wallpaper, a smear when dragging across another window.
 * Drawing the shadow instead costs an approximation of the CSS value and
 * buys a copy that can move, scale and deform with the effect.
 *
 * @since 0.9.8
 */

import type { Container } from 'pixi.js';
import type { StageRect } from './types';

/** One layer of a resolved `box-shadow`. */
export interface ShadowSpec {
	/** `0xRRGGBB`. */
	color: number;
	alpha: number;
	offsetX: number;
	offsetY: number;
	/** CSS blur RADIUS, not a standard deviation. */
	blur: number;
	spread: number;
}

/**
 * Most layers drawn from one `box-shadow`.
 *
 * Every window shadow we ship is two — a wide ambient one and a tight
 * contact one — and the second is what gives the edge its definition,
 * so drawing only the first left a soft grey smudge. The cap is a guard
 * against a theme with a dozen layers costing a dozen blur passes.
 */
const MAX_LAYERS = 4;

/**
 * Parse every layer of a computed `box-shadow`, outermost first.
 *
 * `getComputedStyle` always serialises colour first and lengths in
 * `px`, so this parses the resolved form rather than author syntax — no
 * keywords, no colour names, no omitted units.
 *
 * @param value A computed `box-shadow`, e.g.
 *              `rgba(0, 0, 0, 0.4) 0px 12px 48px 0px, rgba(0, 0, 0, 0.2) 0px 4px 12px 0px`.
 * @return The layers in declaration order. Empty for `none`, unparseable
 *         input, or a shadow made entirely of `inset` layers.
 */
export function parseBoxShadow( value: string ): ShadowSpec[] {
	if ( ! value || 'none' === value.trim() ) {
		return [];
	}

	// Split on commas BETWEEN layers, never the ones inside `rgba(…)`.
	const layers = value.match( /(?:rgba?\([^)]*\)|[^,])+/g ) ?? [];
	const specs: ShadowSpec[] = [];

	for ( const layer of layers ) {
		if ( specs.length >= MAX_LAYERS ) {
			break;
		}
		// `inset` shadows paint inside the box, so they are already in
		// the capture and must not be drawn again.
		if ( /\binset\b/.test( layer ) ) {
			continue;
		}

		const colorMatch = layer.match(
			/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)/,
		);
		if ( ! colorMatch ) {
			continue;
		}

		const lengths = ( layer.replace( colorMatch[ 0 ], '' ).match(
			/-?[\d.]+px/g,
		) ?? [] ).map( parseFloat );
		// Offsets are required; blur and spread default to zero.
		if ( lengths.length < 2 ) {
			continue;
		}

		const [ , r, g, b, a ] = colorMatch;
		const alpha = undefined === a ? 1 : Number( a );
		if ( alpha <= 0 ) {
			continue;
		}

		specs.push( {
			// Pixi wants one packed number, and `0xRRGGBB` is base-256
			// positional notation — arithmetic reads more plainly here
			// than shifts, and cannot overflow into the sign bit.
			color: channel( r ) * 65536 + channel( g ) * 256 + channel( b ),
			alpha,
			offsetX: lengths[ 0 ],
			offsetY: lengths[ 1 ],
			blur: Math.max( 0, lengths[ 2 ] ?? 0 ),
			spread: lengths[ 3 ] ?? 0,
		} );
	}

	return specs;
}

/**
 * Clamp one colour channel to a byte.
 *
 * @param raw A decimal channel from a computed `rgb()` / `rgba()`.
 * @return `0`–`255`.
 */
function channel( raw: string ): number {
	return Math.min( 255, Math.max( 0, Math.round( Number( raw ) ) ) );
}

/**
 * Standard deviation of PixiJS's blur kernel, in tap widths.
 *
 * Not a tuning constant — it falls out of the kernel PixiJS ships. The
 * 5-tap weights are `[0.153388, 0.221461, 0.250301]` (symmetric), and
 * taps are spaced `strength` pixels apart, so
 *
 *   σ² = Σ wᵢ·i² = 2(0.153388·4) + 2(0.221461·1) = 1.670
 *   σ  = 1.292 taps
 *
 * meaning a blur of `strength` pixels per tap produces σ ≈ 1.292 ×
 * strength pixels. CSS, meanwhile, defines its blur radius as **twice**
 * the standard deviation. Converting through both is what
 * {@link blurStrength} does; skipping the kernel half of it made every
 * shadow about 30% too soft.
 */
const KERNEL_SIGMA_TAPS = 1.292;

/**
 * Convert a CSS blur radius into a PixiJS `BlurFilter` strength.
 *
 * @param blur CSS blur radius in pixels.
 * @return The strength producing the same standard deviation.
 */
export function blurStrength( blur: number ): number {
	return blur / 2 / KERNEL_SIGMA_TAPS;
}

/**
 * Read the first corner radius off a computed `border-radius`.
 *
 * One value for all four corners: windows are uniformly rounded, and a
 * shadow is blurred past the point where a per-corner difference of a
 * pixel or two could be seen.
 *
 * @param value A computed `border-radius`.
 * @return Radius in CSS pixels; `0` when absent or percentage-based.
 */
export function parseCornerRadius( value: string ): number {
	const match = ( value || '' ).match( /-?[\d.]+px/ );
	return match ? Math.max( 0, parseFloat( match[ 0 ] ) ) : 0;
}

/** The slice of the Pixi namespace this module needs. */
interface ShadowPixi {
	Container: new () => Container;
	Graphics: new () => {
		roundRect(
			x: number,
			y: number,
			width: number,
			height: number,
			radius: number,
		): unknown;
		fill( style: { color: number; alpha: number } ): unknown;
	};
	BlurFilter: new ( options: { strength: number; quality: number } ) => unknown;
}

/**
 * Build a shadow for a window, in the stand-in sprite's coordinate space
 * (origin at the window's top-left corner).
 *
 * Returned inside a plain `Container` rather than as a bare `Graphics`
 * so callers can move, scale, rotate and fade it without disturbing the
 * blur filter's own bookkeeping.
 *
 * @param pixi    The vendor-loaded Pixi namespace.
 * @param element The real window, read for its computed shadow.
 * @param rect    The window's rectangle, for sizing.
 * @return A display object to place behind the stand-in, or `null` when
 *         the window has no shadow worth drawing.
 */
export function createWindowShadow(
	pixi: unknown,
	element: HTMLElement,
	rect: StageRect,
): Container | null {
	const api = pixi as Partial< ShadowPixi >;
	if (
		typeof api.Container !== 'function' ||
		typeof api.Graphics !== 'function' ||
		typeof api.BlurFilter !== 'function'
	) {
		// A trimmed Pixi build without the graphics or filter packages.
		// A missing shadow is a blemish; a thrown constructor is a dead
		// animation.
		return null;
	}

	let specs: ShadowSpec[];
	let radius: number;
	try {
		const styles = getComputedStyle( element );
		specs = parseBoxShadow( styles.boxShadow );
		radius = parseCornerRadius( styles.borderRadius );
	} catch {
		return null;
	}
	if ( specs.length === 0 ) {
		return null;
	}

	const container = new api.Container();

	/*
	 * Back to front. CSS paints the first-declared shadow ON TOP of the
	 * later ones, and these are opaque-ish quads stacked in a container,
	 * so the order has to be reversed to match.
	 */
	for ( let i = specs.length - 1; i >= 0; i-- ) {
		const spec = specs[ i ];
		const graphics = new api.Graphics();
		graphics.roundRect(
			spec.offsetX - spec.spread,
			spec.offsetY - spec.spread,
			rect.width + spec.spread * 2,
			rect.height + spec.spread * 2,
			Math.max( 0, radius + spec.spread ),
		);
		graphics.fill( { color: spec.color, alpha: spec.alpha } );

		if ( spec.blur > 0 ) {
			// Quality 3 because a shadow is the one thing on screen where
			// banding shows immediately, and this is built once per
			// animation rather than per frame. PixiJS normalises strength
			// across passes, so quality does not change the blur width.
			( graphics as unknown as { filters: unknown[] } ).filters = [
				new api.BlurFilter( {
					strength: blurStrength( spec.blur ),
					quality: 3,
				} ),
			];
		}

		container.addChild( graphics as never );
	}

	container.x = rect.x;
	container.y = rect.y;
	return container;
}
