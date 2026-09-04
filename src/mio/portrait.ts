/**
 * OpenStation — Mio portraits.
 *
 * A Mio at rest, as a standalone SVG string. The live companion is a
 * PixiJS simulation; a portrait is the same creature holding still, so
 * it can be an `<img>`, an avatar, or a file on disk.
 *
 * **Why this exists rather than a screenshot of the real renderer.**
 * Agents wear Mio looks, and an agent's face has to appear in places
 * the shell bundle never reaches: a comment author on the front end, a
 * row in the wp-admin Users list. Those are rendered by PHP. So the
 * portrait had to be describable by maths simple enough to write twice,
 * which ruled out the simulation and ruled in the rest shape.
 *
 * `includes/mio-portrait.php` is the PHP twin. Neither generates the
 * other: both are pinned to `tests/fixtures/mio-portraits.json`, so a
 * drift in either language fails a test rather than shipping two
 * subtly different faces. This side is held to the fixture exactly;
 * the PHP side is held to its structure exactly and its numbers to
 * within a hundredth of a unit, because two languages' floating point
 * does not agree to the last bit and pretending otherwise buys a
 * flaky test rather than a stricter one. Change one, change the other,
 * regenerate the fixture, and read both diffs.
 *
 * **No PixiJS, no DOM.** This module imports `./shape`, `./chroma`,
 * `./config` and `./types` and nothing else, which is what lets the
 * `my-wordpress` bundle draw faces without the simulation.
 *
 * **The output contains no text and no caller-supplied string.** Every
 * value written into the markup is a number this module computed, and
 * every element name is a literal. That is a hard rule, not a style
 * preference: these files are written into uploads and served, so a
 * portrait that could carry an attacker's string would be a stored
 * XSS with a `.svg` extension. `mio-portrait.test.ts` asserts it.
 */

import { chromaRing } from './chroma';
import { MIO_DEFAULTS } from './config';
import { TAU, shapeProfile } from './shape';
import type { MioConfig } from './types';

/**
 * Rim samples used to trace the outline.
 *
 * Not `presetRimPoints()`: that answers a different question, namely
 * how many *mass points* a silhouette needs before the springs can
 * carry it. Nothing is being simulated here, so the only limit is how
 * finely a curve has to be sampled before the eye stops seeing the
 * samples. 72 is past that for every preset at avatar sizes, and the
 * one figure keeps the two renderers trivially comparable.
 */
const RIM_SAMPLES = 72;

/**
 * Colour stops along the gradient.
 *
 * Deliberately far lower than {@link RIM_SAMPLES}: this is colour
 * resolution, not geometric resolution, and a hue ramp needs very few
 * steps before it reads as continuous.
 *
 * **The ramp is laid out linearly, not around the perimeter.** The live
 * renderer colours each rim segment by its own position on the ring;
 * a portrait strokes one path with one linear gradient on a shallow
 * diagonal. That is not a shortcut away from the brand, it is the
 * brand: `branding/mio/mio.svg`, the drawn artwork, is a single path
 * stroked with a single `linearGradient`. Reproducing the
 * circumferential ramp would mean 48 arc subpaths, 48 joins to leave
 * hairline gaps at, and 48 more chances for the two renderers to
 * disagree.
 */
const RING_SAMPLES = 16;

/**
 * Glow shells, from the outermost and faintest inward.
 *
 * A glow is a dilated silhouette, not a fat outline. One wide
 * low-alpha band is a slab with a visible edge however wide it gets;
 * a ramp of concentric strokes on the *same path* falls off. Each
 * entry is `[ extra width as a fraction of the glow reach, alpha ]`.
 */
const GLOW_SHELLS: readonly ( readonly [ number, number ] )[] = [
	[ 1, 0.1 ],
	[ 0.6, 0.14 ],
	[ 0.28, 0.2 ],
];

/** Round to a fixed 2dp so the PHP twin can produce the same bytes. */
function fix( value: number ): string {
	// `toFixed` renders -0 as "-0.00"; normalise it so two renderers
	// that reach zero from opposite sides still agree.
	const rounded = Number( value.toFixed( 2 ) );
	return ( Object.is( rounded, -0 ) ? 0 : rounded ).toFixed( 2 );
}

/** A 24-bit RGB int as `#rrggbb`. */
function hex( rgb: number ): string {
	/* eslint-disable-next-line no-bitwise -- Colours are packed 24-bit
	 * ints throughout Mio; masking is how you read one back out. */
	const rgb24 = rgb & 0xffffff;
	return '#' + rgb24.toString( 16 ).padStart( 6, '0' );
}

/**
 * The rest outline, as a closed cubic path centred on the origin.
 *
 * Sampled from {@link shapeProfile} and joined with the Catmull-Rom to
 * bezier conversion, which is the same smoothing the live renderer
 * applies to its rim. Sampling alone would show as a polygon at these
 * sizes.
 */
export function portraitPath( config: MioConfig, radius: number ): string {
	const pts: [ number, number ][] = [];
	for ( let i = 0; i < RIM_SAMPLES; i++ ) {
		const angle = ( i / RIM_SAMPLES ) * TAU;
		const r = radius * shapeProfile( angle, config.physics );
		pts.push( [ r * Math.cos( angle ), r * Math.sin( angle ) ] );
	}
	const n = pts.length;
	const at = ( i: number ): [ number, number ] =>
		pts[ ( ( i % n ) + n ) % n ];
	let d = `M${ fix( pts[ 0 ][ 0 ] ) } ${ fix( pts[ 0 ][ 1 ] ) }`;
	for ( let i = 0; i < n; i++ ) {
		const p0 = at( i - 1 );
		const p1 = at( i );
		const p2 = at( i + 1 );
		const p3 = at( i + 2 );
		const c1x = p1[ 0 ] + ( p2[ 0 ] - p0[ 0 ] ) / 6;
		const c1y = p1[ 1 ] + ( p2[ 1 ] - p0[ 1 ] ) / 6;
		const c2x = p2[ 0 ] - ( p3[ 0 ] - p1[ 0 ] ) / 6;
		const c2y = p2[ 1 ] - ( p3[ 1 ] - p1[ 1 ] ) / 6;
		d +=
			`C${ fix( c1x ) } ${ fix( c1y ) },` +
			`${ fix( c2x ) } ${ fix( c2y ) },` +
			`${ fix( p2[ 0 ] ) } ${ fix( p2[ 1 ] ) }`;
	}
	return d + 'Z';
}

/**
 * How far the outline reaches from the centre, as a multiple of
 * `radius`.
 *
 * Every preset subtracts its own mean, so they all carry the same
 * *average* radius and read at the same weight. Their peaks do not
 * match at all: a teardrop reaches 1.62x its mean, a star 1.40x, a
 * circle 1.00x. A box drawn for the circle amputates the teardrop's
 * tip, so the box is measured, not assumed.
 *
 * Measuring per look also means every portrait fills its own box, so a
 * 48px avatar is 48px of face whatever shape it is. That is a
 * deliberate difference from the desk, where every Mio shares one
 * radius and a star genuinely is spikier than a circle is round. An
 * avatar grid is read tile by tile, not compared, and a candidate that
 * renders small reads as worse rather than as rounder.
 */
export function portraitExtent( config: MioConfig ): number {
	let max = 0;
	for ( let i = 0; i < RIM_SAMPLES; i++ ) {
		max = Math.max(
			max,
			shapeProfile( ( i / RIM_SAMPLES ) * TAU, config.physics ),
		);
	}
	return max;
}

/**
 * Draw a Mio at rest.
 *
 * The look is taken as given: callers hand it output from
 * `sanitizeMioConfig()` (or, on the PHP side, from the clamp), never
 * raw storage.
 *
 * **`idSuffix` is not optional when you inline more than one.** The
 * markup defines the outline and the gradient once and references them
 * by id. Inline two portraits into the same document with the same ids
 * and every `use` resolves against the first one, so a grid of twelve
 * candidates silently renders as twelve copies of the first: same
 * shape, same colours, no error anywhere. Pass something unique (the
 * agent id, the candidate index) whenever the SVG goes into the page
 * as markup. A portrait used as an `img` source or written to its own
 * file is its own document and needs nothing.
 *
 * @param config   Appearance and physics. Missing halves fall back to
 *                 the shipped defaults.
 * @param size     Rendered width and height, in pixels.
 * @param idSuffix Appended to every internal id. Required when
 *                 inlining more than one portrait per document.
 */
export function mioPortraitSvg(
	config: Partial< MioConfig > = {},
	size: number = 96,
	idSuffix: string = '',
): string {
	const full: MioConfig = {
		appearance: { ...MIO_DEFAULTS.appearance, ...config.appearance },
		physics: { ...MIO_DEFAULTS.physics, ...config.physics },
	};
	const { appearance: a } = full;

	// Work on a canonical 100-unit radius and let the viewBox scale it,
	// so the same path serves a 24px avatar and a 176px hero.
	const radius = 100;
	const scale = radius / MIO_DEFAULTS.appearance.radius;
	const stroke = a.outlineWidth * scale;
	const liner = a.linerWidth * scale;
	// `glow` is a multiple of the radius, and the outermost shell is
	// drawn at the full reach either side of the outline.
	const reach = ( a.glow / 10 ) * radius * 0.18;
	const half =
		radius * portraitExtent( full ) + stroke / 2 + reach * GLOW_SHELLS[ 0 ][ 0 ];
	const box = fix( half );
	const span = fix( half * 2 );

	const d = portraitPath( full, radius );
	const ring = chromaRing( RING_SAMPLES, 0, a );

	// The ramp is emitted as gradient stops rather than as one stroked
	// segment per sample. Segments leave hairline gaps at every joint
	// once the stroke is thick, and 48 subpaths is 48 chances for the
	// two renderers to disagree about a join.
	// Only `[A-Za-z0-9_-]` survives, so a caller cannot close the
	// attribute and write markup through this parameter.
	const uid = String( idSuffix ).replace( /[^A-Za-z0-9_-]/g, '' );
	const ringId = `r${ uid }`;
	const shapeId = `s${ uid }`;
	const clipId = `c${ uid }`;

	const stops = ring
		.map( ( rgb, i ) => {
			const offset = fix( ( i / ( ring.length - 1 ) ) * 100 );
			return `<stop offset="${ offset }%" stop-color="${ hex( rgb ) }"/>`;
		} )
		.join( '' );

	// The outline is defined once and referenced. Repeating a
	// 72-segment path four times, once per glow shell plus the core,
	// quadrupled the file for no drawn difference.
	const glow = GLOW_SHELLS.map(
		( [ spread, alpha ] ) =>
			`<use href="#${ shapeId }" fill="none" stroke="url(#${ ringId })"` +
			` stroke-width="${ fix( stroke + reach * spread * 2 ) }"` +
			` stroke-opacity="${ fix( alpha ) }" stroke-linejoin="round"/>`,
	).join( '' );

	// At rest the body is undeformed, so every squash factor in
	// `eyeLayout()` is exactly 1 and the gaze and blink terms are zero.
	// What is left is the resting face.
	const eyeH = radius * a.eyeScale;
	const eyeW = eyeH * 0.46;
	const eyeGap = radius * 0.28;
	const eyeY = -radius * 0.02 - eyeH / 2;
	const eye = ( cx: number ): string =>
		`<rect x="${ fix( cx - eyeW / 2 ) }" y="${ fix( eyeY ) }"` +
		` width="${ fix( eyeW ) }" height="${ fix( eyeH ) }"` +
		` rx="${ fix( eyeW / 2 ) }" fill="${ hex( a.eyeColor ) }"/>`;

	// The inner line, clipped to the body.
	//
	// SVG strokes are centred on their path and cannot be offset to one
	// side, so the line is drawn at the full width it would need if it
	// reached both ways — `stroke + liner * 2` — and the clip throws
	// the outer half away. What is left runs from the outline inward,
	// and the chroma stroke below is painted over its inner reach, so
	// the visible white is exactly the band between the two. That is
	// the same geometry `fillLiner` produces in the live renderer, by
	// the only means SVG offers.
	const line =
		liner > 0
			? `<use href="#${ shapeId }" fill="none" stroke="${ hex( a.linerColor ) }"` +
				` stroke-width="${ fix( stroke + liner * 2 ) }"` +
				` stroke-linejoin="round" clip-path="url(#${ clipId })"/>`
			: '';

	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${ size }" height="${ size }"` +
		` viewBox="-${ box } -${ box } ${ span } ${ span }">` +
		`<defs><linearGradient id="${ ringId }" x1="0" y1="0" x2="0.85" y2="1">${ stops }</linearGradient>` +
		`<path id="${ shapeId }" d="${ d }"/>` +
		`<clipPath id="${ clipId }"><use href="#${ shapeId }"/></clipPath></defs>` +
		glow +
		`<use href="#${ shapeId }" fill="${ hex( a.bodyColor ) }"` +
		` fill-opacity="${ fix( a.bodyAlpha ) }"/>` +
		line +
		`<use href="#${ shapeId }" fill="none" stroke="url(#${ ringId })"` +
		` stroke-width="${ fix( stroke ) }" stroke-linejoin="round"/>` +
		eye( -eyeGap ) +
		eye( eyeGap ) +
		'</svg>'
	);
}

/**
 * A portrait as a `data:` URI, ready for `src` or a CSS `url()`.
 *
 * Base64 rather than percent-encoding: the markup is full of `#`, `"`
 * and `<`, and one missed escape in a URL-encoded payload is a broken
 * image rather than a loud error.
 */
export function mioPortraitDataUri(
	config: Partial< MioConfig > = {},
	size: number = 96,
): string {
	// A data URI is its own document, so the ids cannot collide with
	// anything and the suffix is left empty on purpose.
	const svg = mioPortraitSvg( config, size );
	// `btoa` in the browser, `Buffer` under Node for the tests.
	const encoded =
		typeof btoa === 'function'
			? btoa( svg )
			: Buffer.from( svg, 'utf8' ).toString( 'base64' );
	return `data:image/svg+xml;base64,${ encoded }`;
}
