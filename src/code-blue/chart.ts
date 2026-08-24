/**
 * Code Blue — stacked severity histogram.
 *
 * Plain inline SVG, no chart library. One stacked column per time
 * bucket, series = the four severity buckets in stack order (errors
 * at the baseline, info on top). Colors ride CSS classes that
 * resolve through the status tokens in `variables.css`, so desktop
 * themes re-skin the chart for free.
 *
 * Mark discipline (per the shell's chart conventions): columns are
 * capped at 24px, adjacent columns and stacked segments are
 * separated by 2px of surface (no strokes), the top segment gets a
 * rounded cap, gridlines are 1px and recessive, and every text node
 * wears text tokens — never a series color.
 *
 * @public
 */

import type { HistogramData, LevelBucket } from './types';
import { BUCKET_ORDER } from './model';

const SVG_NS = 'http://www.w3.org/2000/svg';

const CHART_HEIGHT = 150;
const PAD_TOP = 8;
const PAD_BOTTOM = 20;
const PAD_LEFT = 8;
const PAD_RIGHT = 40;
const MAX_BAR = 24;
const GAP = 2;

export interface ChartOptions {
	/** Localized bucket labels for the tooltip rows. */
	bucketLabels: Record< LevelBucket, string >;
	/** Format a bucket's time span for the tooltip header. */
	formatSpan: ( startSec: number, endSec: number ) => string;
	/** Format an axis timestamp. */
	formatTick: ( sec: number ) => string;
}

/** Smallest "nice" ceiling (1/2/5 × 10^k) at or above `value`. */
function niceCeil( value: number ): number {
	if ( value <= 5 ) {
		return Math.max( 1, value );
	}
	const power = Math.pow( 10, Math.floor( Math.log10( value ) ) );
	for ( const step of [ 1, 2, 5, 10 ] ) {
		if ( step * power >= value ) {
			return step * power;
		}
	}
	return 10 * power;
}

function svgEl< K extends keyof SVGElementTagNameMap >(
	tag: K,
	attrs: Record< string, string >,
): SVGElementTagNameMap[ K ] {
	const el = document.createElementNS( SVG_NS, tag );
	for ( const [ key, value ] of Object.entries( attrs ) ) {
		el.setAttribute( key, value );
	}
	return el;
}

/** A rect whose top two corners are rounded — the stack's cap. */
function cappedSegmentPath(
	x: number,
	y: number,
	w: number,
	h: number,
): string {
	const r = Math.min( 3, h / 2, w / 2 );
	return (
		`M ${ x } ${ y + h } ` +
		`L ${ x } ${ y + r } Q ${ x } ${ y } ${ x + r } ${ y } ` +
		`L ${ x + w - r } ${ y } Q ${ x + w } ${ y } ${ x + w } ${ y + r } ` +
		`L ${ x + w } ${ y + h } Z`
	);
}

/**
 * Render the histogram into `host` (cleared first). The tooltip div
 * is created inside `host`, which must be `position: relative`.
 */
export function renderHistogram(
	host: HTMLElement,
	data: HistogramData,
	options: ChartOptions,
): void {
	host.textContent = '';

	const width = Math.max( 280, host.clientWidth || 640 );
	const plotW = width - PAD_LEFT - PAD_RIGHT;
	const plotH = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
	const n = data.buckets.length;
	const slot = plotW / n;
	const barW = Math.max( 2, Math.min( MAX_BAR, slot - GAP ) );

	const maxTotal = data.buckets.reduce( ( max, column ) => {
		const total = BUCKET_ORDER.reduce(
			( sum, bucket ) => sum + column[ bucket ],
			0,
		);
		return Math.max( max, total );
	}, 0 );
	const yMax = niceCeil( maxTotal );
	const yScale = plotH / yMax;

	const svg = svgEl( 'svg', {
		class: 'os-cb-chart__svg',
		width: String( width ),
		height: String( CHART_HEIGHT ),
		viewBox: `0 0 ${ width } ${ CHART_HEIGHT }`,
		role: 'img',
	} );

	// Gridlines + y ticks at 0 / half / max.
	for ( const fraction of [ 0, 0.5, 1 ] ) {
		const value = yMax * fraction;
		const y = PAD_TOP + plotH - value * yScale;
		svg.appendChild(
			svgEl( 'line', {
				class: 'os-cb-chart__grid',
				x1: String( PAD_LEFT ),
				y1: String( y ),
				x2: String( PAD_LEFT + plotW ),
				y2: String( y ),
			} ),
		);
		const tick = svgEl( 'text', {
			class: 'os-cb-chart__tick',
			x: String( PAD_LEFT + plotW + 6 ),
			y: String( y + 3.5 ),
		} );
		tick.textContent = Number.isInteger( value )
			? value.toLocaleString()
			: String( value );
		svg.appendChild( tick );
	}

	// X-axis time labels: start / middle / end.
	const mid = data.start + ( data.end - data.start ) / 2;
	const anchors: Array< [ number, number, string ] > = [
		[ data.start, PAD_LEFT, 'start' ],
		[ mid, PAD_LEFT + plotW / 2, 'middle' ],
		[ data.end, PAD_LEFT + plotW, 'end' ],
	];
	for ( const [ sec, x, anchor ] of anchors ) {
		const label = svgEl( 'text', {
			class: 'os-cb-chart__tick',
			x: String( x ),
			y: String( CHART_HEIGHT - 5 ),
			'text-anchor': anchor,
		} );
		label.textContent = options.formatTick( sec );
		svg.appendChild( label );
	}

	// Tooltip + hover column, shared across all hit rects.
	const tooltip = document.createElement( 'div' );
	tooltip.className = 'os-cb-chart__tooltip';
	tooltip.hidden = true;

	const hoverRect = svgEl( 'rect', {
		class: 'os-cb-chart__hover',
		y: String( PAD_TOP ),
		width: String( slot ),
		height: String( plotH ),
	} );
	hoverRect.setAttribute( 'visibility', 'hidden' );
	svg.appendChild( hoverRect );

	data.buckets.forEach( ( column, index ) => {
		const x = PAD_LEFT + index * slot + ( slot - barW ) / 2;
		let yCursor = PAD_TOP + plotH;

		// Walk the stack top-down to find which segment is topmost,
		// then draw bottom-up; only the topmost segment gets the cap.
		const present = BUCKET_ORDER.filter(
			( bucket ) => column[ bucket ] > 0,
		);
		const topBucket = present[ present.length - 1 ];

		for ( const bucket of BUCKET_ORDER ) {
			const count = column[ bucket ];
			if ( count === 0 ) {
				continue;
			}
			const rawH = count * yScale;
			const h = Math.max( 1.5, rawH - ( bucket === topBucket ? 0 : GAP ) );
			const y = yCursor - rawH;
			if ( bucket === topBucket ) {
				svg.appendChild(
					svgEl( 'path', {
						class: `os-cb-seg os-cb-seg--${ bucket }`,
						d: cappedSegmentPath( x, y, barW, Math.max( 1.5, rawH ) ),
					} ),
				);
			} else {
				svg.appendChild(
					svgEl( 'rect', {
						class: `os-cb-seg os-cb-seg--${ bucket }`,
						x: String( x ),
						y: String( y + GAP ),
						width: String( barW ),
						height: String( h ),
					} ),
				);
			}
			yCursor = y;
		}

		// Full-height transparent hit target — hover anywhere in the
		// column's slot, not just on the (possibly tiny) marks.
		const hit = svgEl( 'rect', {
			class: 'os-cb-chart__hit',
			x: String( PAD_LEFT + index * slot ),
			y: String( PAD_TOP ),
			width: String( slot ),
			height: String( plotH ),
		} );
		hit.addEventListener( 'pointerenter', () => {
			hoverRect.setAttribute( 'x', String( PAD_LEFT + index * slot ) );
			hoverRect.setAttribute( 'visibility', 'visible' );
			showTooltip( tooltip, host, column, index, slot, data, options );
		} );
		hit.addEventListener( 'pointerleave', () => {
			hoverRect.setAttribute( 'visibility', 'hidden' );
			tooltip.hidden = true;
		} );
		svg.appendChild( hit );
	} );

	host.appendChild( svg );
	host.appendChild( tooltip );
}

function showTooltip(
	tooltip: HTMLDivElement,
	host: HTMLElement,
	column: Record< LevelBucket, number >,
	index: number,
	slot: number,
	data: HistogramData,
	options: ChartOptions,
): void {
	tooltip.textContent = '';

	const head = document.createElement( 'div' );
	head.className = 'os-cb-chart__tooltip-head';
	head.textContent = options.formatSpan(
		data.start + index * data.bucketSec,
		data.start + ( index + 1 ) * data.bucketSec,
	);
	tooltip.appendChild( head );

	// Rows top-of-stack first, mirroring what the eye sees.
	for ( const bucket of [ ...BUCKET_ORDER ].reverse() ) {
		const count = column[ bucket ];
		if ( count === 0 ) {
			continue;
		}
		const row = document.createElement( 'div' );
		row.className = 'os-cb-chart__tooltip-row';
		const swatch = document.createElement( 'span' );
		swatch.className = `os-cb-swatch os-cb-swatch--${ bucket }`;
		const label = document.createElement( 'span' );
		label.className = 'os-cb-chart__tooltip-label';
		label.textContent = options.bucketLabels[ bucket ];
		const value = document.createElement( 'span' );
		value.className = 'os-cb-chart__tooltip-value';
		value.textContent = count.toLocaleString();
		row.append( swatch, label, value );
		tooltip.appendChild( row );
	}
	if ( tooltip.children.length === 1 ) {
		const row = document.createElement( 'div' );
		row.className = 'os-cb-chart__tooltip-row';
		row.textContent = '—';
		tooltip.appendChild( row );
	}

	tooltip.hidden = false;
	const x = PAD_LEFT + index * slot + slot / 2;
	const clamped = Math.max(
		60,
		Math.min( x, ( host.clientWidth || 640 ) - 60 ),
	);
	// Deliberately the PHYSICAL `left`: `x` is SVG geometry, which is
	// physical in RTL locales too — a logical inset would mirror the
	// tooltip onto the wrong column there.
	tooltip.style.left = `${ clamped }px`;
}
