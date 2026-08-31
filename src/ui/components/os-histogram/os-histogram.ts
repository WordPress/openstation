/**
 * `<os-histogram>` — stacked time histogram with a toggle legend.
 *
 * One stacked column per time bucket, one series per stack layer,
 * painted as plain inline SVG (no chart library). The legend doubles
 * as a series filter: clicking a chip hides that layer and emits
 * `os-series-toggle`, so a server-rendered view can persist the
 * choice without owning any chart code.
 *
 *   <os-histogram
 *       legend
 *       series='[{"key":"error","label":"Errors","tone":"danger"}, …]'
 *       columns='[[3,1,0,2],[0,0,1,0], …]'
 *       start="1756600000" end="1756686400"
 *       hidden-series="info"
 *       empty="No events in this range."
 *   ></os-histogram>
 *
 * Mark discipline per the shell's chart conventions: columns cap at
 * 24px, adjacent columns and stacked segments are separated by 2px
 * of surface (no strokes), the top segment gets a rounded cap,
 * gridlines are 1px and recessive, and every text node wears text
 * tokens — never a series colour. Repaints itself when its width
 * changes.
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './os-histogram.styles';

const SVG_NS = 'http://www.w3.org/2000/svg';

const PAD_TOP = 8;
const PAD_BOTTOM = 20;
const PAD_LEFT = 8;
const PAD_RIGHT = 40;
const MAX_BAR = 24;
const GAP = 2;
const DEFAULT_HEIGHT = 150;

/** A stack layer. */
export interface HistogramSeries {
	key: string;
	label: string;
	/** `danger` | `warning` | `info` | `success` | `accent` | `neutral`. */
	tone?: string;
}

const TONES = new Set( [ 'danger', 'warning', 'info', 'success', 'accent', 'neutral' ] );

function parseJson< T >( raw: string | null, fallback: T ): T {
	if ( ! raw ) {
		return fallback;
	}
	try {
		return JSON.parse( raw ) as T;
	} catch {
		return fallback;
	}
}

/** Smallest "nice" ceiling (1/2/5 × 10^k) at or above `value`. */
export function niceCeil( value: number ): number {
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
function cappedPath( x: number, y: number, w: number, h: number ): string {
	const r = Math.min( 3, h / 2, w / 2 );
	return (
		`M ${ x } ${ y + h } ` +
		`L ${ x } ${ y + r } Q ${ x } ${ y } ${ x + r } ${ y } ` +
		`L ${ x + w - r } ${ y } Q ${ x + w } ${ y } ${ x + w } ${ y + r } ` +
		`L ${ x + w } ${ y + h } Z`
	);
}

export class OsHistogram extends Component {
	static props = [
		'heading',
		'series',
		'columns',
		'start',
		'end',
		'hidden-series',
		'legend',
		'empty',
		'height',
	] as const;

	static styles = [ styles ];

	static help = {
		title: 'Histogram',
		summary:
			'Stacked time histogram painted as inline SVG, with an optional legend whose chips toggle series on and off. Colours ride the status tokens (danger / warning / info / success / accent / neutral) so desktop themes re-skin it for free. Server-rendered views use it as a pure data sink: hand it series + columns, listen for os-series-toggle.',
		status: 'stable',
		props: [
			{
				name: 'heading',
				type: 'string',
				description: 'Optional title, painted on the same row as the legend (title start, chips end) — the card-head layout without a wrapper.',
			},
			{
				name: 'series',
				type: 'JSON — { key, label, tone }[]',
				description: 'Stack layers, bottom first. `tone` picks the status colour.',
			},
			{
				name: 'columns',
				type: 'JSON — number[][]',
				description: 'One inner array per time bucket, one count per series, oldest first.',
			},
			{ name: 'start', type: 'unix seconds', description: 'Left edge of the first bucket.' },
			{ name: 'end', type: 'unix seconds', description: 'Right edge of the last bucket.' },
			{
				name: 'hidden-series',
				type: 'comma-separated keys',
				description: 'Series hidden from the stack (their legend chip reads as off).',
			},
			{ name: 'legend', type: 'boolean attribute', description: 'Show the toggle legend above the chart.' },
			{ name: 'empty', type: 'string', description: 'Text shown when every column is zero.' },
			{ name: 'height', type: 'integer (px)', default: '150', description: 'Plot height.' },
		],
		events: [
			{
				name: 'os-series-toggle',
				detail: '{ key: string, hidden: string[] }',
				description: 'A legend chip was clicked. `hidden` is the full set after the toggle.',
			},
		],
		parts: [
			{ name: 'head', description: 'The heading + legend row. Style it as a card head from outside.' },
			{ name: 'heading', description: 'The title element.' },
			{ name: 'legend', description: 'The chip row.' },
			{ name: 'chart', description: 'The SVG host.' },
		],
		cssProps: [
			{ name: '--os-ui-danger' },
			{ name: '--os-ui-warning' },
			{ name: '--os-ui-info-fg' },
			{ name: '--os-ui-fg-muted' },
			{ name: '--os-ui-border' },
		],
		example: html`
			<os-histogram
				legend
				series='[{"key":"error","label":"Errors","tone":"danger"},{"key":"warning","label":"Warnings","tone":"warning"},{"key":"info","label":"Info","tone":"info"}]'
				columns='[[2,1,0],[0,3,1],[1,0,4],[5,2,0],[0,0,2],[3,1,1],[0,4,0],[1,1,3]]'
				start="1756600000"
				end="1756686400"
				empty="No events."
			></os-histogram>
		`,
	} as const;

	private _resize: ResizeObserver | null = null;
	private _tooltip: HTMLElement | null = null;

	connectedCallback(): void {
		super.connectedCallback();
		if ( typeof ResizeObserver !== 'undefined' ) {
			this._resize = new ResizeObserver( () => this.paint() );
			this._resize.observe( this );
		}
	}

	disconnectedCallback(): void {
		this._resize?.disconnect();
		this._resize = null;
	}

	protected requestUpdate(): void {
		super.requestUpdate();
		// The base render runs on the next microtask; paint after it.
		queueMicrotask( () => this.paint() );
	}

	// ------------------------------------------------------------ data

	/** Declared series, tones normalised. */
	get seriesList(): HistogramSeries[] {
		const raw = parseJson< unknown >( this.getAttribute( 'series' ), [] );
		if ( ! Array.isArray( raw ) ) {
			return [];
		}
		return raw
			.filter( ( s ): s is HistogramSeries => !! s && typeof s === 'object' && typeof ( s as HistogramSeries ).key === 'string' )
			.map( ( s ) => ( {
				key: s.key,
				label: typeof s.label === 'string' ? s.label : s.key,
				tone: s.tone && TONES.has( s.tone ) ? s.tone : 'neutral',
			} ) );
	}

	/** Column counts, one number per series per bucket. */
	get columnList(): number[][] {
		const raw = parseJson< unknown >( this.getAttribute( 'columns' ), [] );
		if ( ! Array.isArray( raw ) ) {
			return [];
		}
		return raw.map( ( column ) =>
			Array.isArray( column ) ? column.map( ( n ) => ( Number.isFinite( Number( n ) ) ? Math.max( 0, Number( n ) ) : 0 ) ) : [],
		);
	}

	get hiddenSet(): Set< string > {
		return new Set(
			( this.getAttribute( 'hidden-series' ) ?? '' )
				.split( ',' )
				.map( ( s ) => s.trim() )
				.filter( ( s ) => s !== '' ),
		);
	}

	/** Per-series totals across every column (hidden or not). */
	totals(): number[] {
		const series = this.seriesList;
		const totals = series.map( () => 0 );
		for ( const column of this.columnList ) {
			series.forEach( ( _s, i ) => {
				totals[ i ] += column[ i ] ?? 0;
			} );
		}
		return totals;
	}

	/** Flip one series and announce the new hidden set. */
	toggleSeries( key: string ): void {
		const hidden = this.hiddenSet;
		if ( hidden.has( key ) ) {
			hidden.delete( key );
		} else {
			hidden.add( key );
		}
		const list = Array.from( hidden );
		if ( list.length > 0 ) {
			this.setAttribute( 'hidden-series', list.join( ',' ) );
		} else {
			this.removeAttribute( 'hidden-series' );
		}
		this.emit( 'os-series-toggle', { key, hidden: list } );
	}

	// ---------------------------------------------------------- render

	protected render() {
		const series = this.seriesList;
		const totals = this.totals();
		const hidden = this.hiddenSet;
		const heading = this.getAttribute( 'heading' ) ?? '';
		return html`
			<div class="head" part="head">
				<h2 class="heading" part="heading" ?hidden=${ heading === '' }>${ heading }</h2>
				<div class="legend" part="legend" role="group">
				${ series.map(
					( s, i ) => html`
						<button
							type="button"
							class="chip"
							data-tone=${ s.tone ?? 'neutral' }
							aria-pressed=${ hidden.has( s.key ) ? 'false' : 'true' }
							@click=${ () => this.toggleSeries( s.key ) }
						>
							<span class="swatch"></span>
							<span class="label">${ s.label }</span>
							<span class="count">${ totals[ i ].toLocaleString() }</span>
						</button>
					`,
				) }
				</div>
			</div>
			<div class="chart" part="chart"></div>
			<div class="tooltip" part="tooltip" hidden></div>
		`;
	}

	/** Imperative SVG paint into the chart host. */
	paint(): void {
		const root = this.shadowRoot;
		const host = root?.querySelector< HTMLElement >( '.chart' );
		const tooltip = root?.querySelector< HTMLElement >( '.tooltip' );
		if ( ! host || ! tooltip ) {
			return;
		}
		this._tooltip = tooltip;
		tooltip.hidden = true;
		host.textContent = '';

		const columns = this.columnList;
		const anyData = columns.some( ( column ) => column.some( ( n ) => n > 0 ) );
		if ( columns.length === 0 || ! anyData ) {
			const empty = document.createElement( 'div' );
			empty.className = 'empty';
			empty.textContent = this.getAttribute( 'empty' ) ?? '';
			host.appendChild( empty );
			return;
		}

		const series = this.seriesList;
		const hidden = this.hiddenSet;
		const visibleIndexes = series.map( ( s, i ) => ( hidden.has( s.key ) ? -1 : i ) ).filter( ( i ) => i >= 0 );

		const heightAttr = parseInt( this.getAttribute( 'height' ) ?? '', 10 );
		const chartHeight = Number.isFinite( heightAttr ) && heightAttr > 40 ? heightAttr : DEFAULT_HEIGHT;
		const width = Math.max( 280, this.clientWidth || 640 );
		const plotW = width - PAD_LEFT - PAD_RIGHT;
		const plotH = chartHeight - PAD_TOP - PAD_BOTTOM;
		const n = columns.length;
		const slot = plotW / n;
		const barW = Math.max( 2, Math.min( MAX_BAR, slot - GAP ) );

		const maxTotal = columns.reduce( ( max, column ) => {
			const total = visibleIndexes.reduce( ( sum, i ) => sum + ( column[ i ] ?? 0 ), 0 );
			return Math.max( max, total );
		}, 0 );
		const yMax = niceCeil( maxTotal );
		const yScale = plotH / yMax;

		const svg = svgEl( 'svg', {
			width: String( width ),
			height: String( chartHeight ),
			viewBox: `0 0 ${ width } ${ chartHeight }`,
			role: 'img',
		} );

		for ( const fraction of [ 0, 0.5, 1 ] ) {
			const value = yMax * fraction;
			const y = PAD_TOP + plotH - value * yScale;
			svg.appendChild(
				svgEl( 'line', {
					class: 'grid',
					x1: String( PAD_LEFT ),
					y1: String( y ),
					x2: String( PAD_LEFT + plotW ),
					y2: String( y ),
				} ),
			);
			const tick = svgEl( 'text', {
				class: 'tick',
				x: String( PAD_LEFT + plotW + 6 ),
				y: String( y + 3.5 ),
			} );
			tick.textContent = Number.isInteger( value ) ? value.toLocaleString() : String( value );
			svg.appendChild( tick );
		}

		const start = Number( this.getAttribute( 'start' ) ) || 0;
		const end = Number( this.getAttribute( 'end' ) ) || start + n;
		const bucketSec = Math.max( 1, ( end - start ) / n );
		const multiDay = end - start > 36 * 3600;
		const formatTick = ( sec: number ): string =>
			new Date( sec * 1000 ).toLocaleString(
				[],
				multiDay ? { month: 'short', day: 'numeric' } : { hour: '2-digit', minute: '2-digit' },
			);
		const formatFull = ( sec: number ): string =>
			new Date( sec * 1000 ).toLocaleString( [], {
				month: 'short',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit',
			} );

		const anchors: Array< [ number, number, string ] > = [
			[ start, PAD_LEFT, 'start' ],
			[ start + ( end - start ) / 2, PAD_LEFT + plotW / 2, 'middle' ],
			[ end, PAD_LEFT + plotW, 'end' ],
		];
		for ( const [ sec, x, anchor ] of anchors ) {
			const label = svgEl( 'text', {
				class: 'tick',
				x: String( x ),
				y: String( chartHeight - 5 ),
				'text-anchor': anchor,
			} );
			label.textContent = formatTick( sec );
			svg.appendChild( label );
		}

		const hoverRect = svgEl( 'rect', {
			class: 'hover',
			y: String( PAD_TOP ),
			width: String( slot ),
			height: String( plotH ),
			visibility: 'hidden',
		} );
		svg.appendChild( hoverRect );

		columns.forEach( ( column, index ) => {
			const x = PAD_LEFT + index * slot + ( slot - barW ) / 2;
			let yCursor = PAD_TOP + plotH;
			const present = visibleIndexes.filter( ( i ) => ( column[ i ] ?? 0 ) > 0 );
			const top = present[ present.length - 1 ];

			for ( const i of visibleIndexes ) {
				const count = column[ i ] ?? 0;
				if ( count === 0 ) {
					continue;
				}
				const tone = series[ i ].tone ?? 'neutral';
				const rawH = count * yScale;
				const y = yCursor - rawH;
				if ( i === top ) {
					svg.appendChild(
						svgEl( 'path', {
							class: 'seg',
							'data-tone': tone,
							d: cappedPath( x, y, barW, Math.max( 1.5, rawH ) ),
						} ),
					);
				} else {
					svg.appendChild(
						svgEl( 'rect', {
							class: 'seg',
							'data-tone': tone,
							x: String( x ),
							y: String( y + GAP ),
							width: String( barW ),
							height: String( Math.max( 1.5, rawH - GAP ) ),
						} ),
					);
				}
				yCursor = y;
			}

			const hit = svgEl( 'rect', {
				class: 'hit',
				x: String( PAD_LEFT + index * slot ),
				y: String( PAD_TOP ),
				width: String( slot ),
				height: String( plotH ),
			} );
			hit.addEventListener( 'pointerenter', () => {
				hoverRect.setAttribute( 'x', String( PAD_LEFT + index * slot ) );
				hoverRect.setAttribute( 'visibility', 'visible' );
				this.showTooltip( index, column, slot, width, {
					head: `${ formatFull( start + index * bucketSec ) } – ${ formatTick( start + ( index + 1 ) * bucketSec ) }`,
					series,
					visibleIndexes,
				} );
			} );
			hit.addEventListener( 'pointerleave', () => {
				hoverRect.setAttribute( 'visibility', 'hidden' );
				tooltip.hidden = true;
			} );
			svg.appendChild( hit );
		} );

		host.appendChild( svg );
	}

	private showTooltip(
		index: number,
		column: number[],
		slot: number,
		width: number,
		info: { head: string; series: HistogramSeries[]; visibleIndexes: number[] },
	): void {
		const tooltip = this._tooltip;
		if ( ! tooltip ) {
			return;
		}
		tooltip.textContent = '';
		const head = document.createElement( 'div' );
		head.className = 'tooltip-head';
		head.textContent = info.head;
		tooltip.appendChild( head );

		// Rows top-of-stack first, mirroring what the eye sees.
		let rows = 0;
		for ( const i of [ ...info.visibleIndexes ].reverse() ) {
			const count = column[ i ] ?? 0;
			if ( count === 0 ) {
				continue;
			}
			rows++;
			const row = document.createElement( 'div' );
			row.className = 'tooltip-row';
			const swatch = document.createElement( 'span' );
			swatch.className = 'swatch';
			swatch.dataset.tone = info.series[ i ].tone ?? 'neutral';
			const label = document.createElement( 'span' );
			label.className = 'tooltip-label';
			label.textContent = info.series[ i ].label;
			const value = document.createElement( 'span' );
			value.className = 'tooltip-value';
			value.textContent = count.toLocaleString();
			row.append( swatch, label, value );
			tooltip.appendChild( row );
		}
		if ( rows === 0 ) {
			const row = document.createElement( 'div' );
			row.className = 'tooltip-row';
			row.textContent = '—';
			tooltip.appendChild( row );
		}

		tooltip.hidden = false;
		const x = PAD_LEFT + index * slot + slot / 2;
		// Physical `left` on purpose: `x` is SVG geometry, physical in
		// RTL too — a logical inset would mirror onto the wrong column.
		tooltip.style.left = `${ Math.max( 60, Math.min( x, width - 60 ) ) }px`;
	}
}

defineComponent( 'os-histogram', OsHistogram );
