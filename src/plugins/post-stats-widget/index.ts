/**
 * OpenStation — Post Stats Widget (lazy bundle).
 *
 * Stacked canvas bar chart of posts per calendar month over
 * the last 6 months, split by Published / Pending / Draft.
 * Chart redraws on ResizeObserver so it stays crisp at any
 * card size. HiDPI-aware via devicePixelRatio.
 *
 * Data: GET /desktop-mode/v1/post-stats — one server-aggregated,
 * transient-cached request per refresh (it used to page through
 * /wp/v2/posts three times, once per status).
 * Refresh: every 5 minutes, paused while the tab is hidden.
 */
import './styles.css';
import { trackedFetch } from '../../tracked-fetch';
import type { WidgetContext, WidgetTeardown } from '../../widgets/types';
import { startVisibilityAwarePoller } from '../../widgets/poller';

const WIDGET_ID = 'desktop-mode/post-stats';
const REFRESH_MS = 5 * 60_000;
const MONTHS_BACK = 6;

const COLORS = {
	published: '#3b82f6',
	pending: '#fbbf24',
	draft: '#a5b4fc',
} as const;

interface Bucket {
	ym: string;
	label: string;
	published: number;
	pending: number;
	draft: number;
}

interface StatsMonth {
	ym: string;
	publish: number;
	draft: number;
	pending: number;
}

function shortLabel( ym: string ): string {
	const [ , m ] = ym.split( '-' );
	return new Date( 2000, parseInt( m, 10 ) - 1, 1 )
		.toLocaleString( undefined, { month: 'short' } );
}

/**
 * One request: the server aggregates months × status with a single
 * GROUP BY (transient-cached for 5 min) and returns exactly
 * MONTHS_BACK zero-filled buckets, oldest first.
 */
async function fetchBuckets(): Promise< Bucket[] > {
	const root = ( window as unknown as { wpApiSettings?: { root?: string } } )
		.wpApiSettings?.root ?? '/wp-json/';
	const res = await trackedFetch(
		root.replace( /\/$/, '' ) + '/desktop-mode/v1/post-stats',
		{ credentials: 'same-origin' },
		{ source: 'desktop-mode/post-stats', silent: true },
	);
	if ( ! res.ok ) {
		throw new Error( `post-stats request failed: ${ res.status }` );
	}
	const body = await res.json() as { months?: StatsMonth[] };
	const months = Array.isArray( body.months ) ? body.months : [];
	return months.slice( -MONTHS_BACK ).map( ( m ) => ( {
		ym: m.ym,
		label: shortLabel( m.ym ),
		published: Number( m.publish ) || 0,
		pending: Number( m.pending ) || 0,
		draft: Number( m.draft ) || 0,
	} ) );
}

/**
 * Safe rounded rect — falls back to a plain rect on browsers that do
 * not support CanvasRenderingContext2D.roundRect() (Safari < 15.4).
 *
 * Parameters use rx/ry/rw/rh/rr prefix to avoid shadowing any outer
 * scope variables with the same single-letter names (no-shadow rule).
 */
function safeRoundRect(
	ctx: CanvasRenderingContext2D,
	rx: number,
	ry: number,
	rw: number,
	rh: number,
	rr: number,
): void {
	if ( typeof ( ctx as unknown as { roundRect?: unknown } ).roundRect === 'function' ) {
		( ctx as unknown as { roundRect: ( x: number, y: number, w: number, h: number, r: number ) => void } )
			.roundRect( rx, ry, rw, rh, rr );
	} else {
		ctx.rect( rx, ry, rw, rh );
	}
}

function drawChart( canvas: HTMLCanvasElement, buckets: Bucket[] ): void {
	const dpr = window.devicePixelRatio || 1;
	const rect = canvas.getBoundingClientRect();

	if ( rect.width === 0 || rect.height === 0 ) {
		return;
	}

	canvas.width = Math.round( rect.width * dpr );
	canvas.height = Math.round( rect.height * dpr );
	const ctx = canvas.getContext( '2d' );
	if ( ! ctx ) {
		return;
	}
	ctx.scale( dpr, dpr );

	const W = rect.width;
	const H = rect.height;
	const PAD = { top: 18, right: 10, bottom: 22, left: 28 };
	const chartW = W - PAD.left - PAD.right;
	const chartH = H - PAD.top - PAD.bottom;

	if ( chartW <= 0 || chartH <= 0 ) {
		return;
	}

	const maxVal = Math.max( 1, ...buckets.map( ( b ) => b.published + b.pending + b.draft ) );
	const barGroupW = chartW / buckets.length;
	const barPad = barGroupW * 0.2;
	const barW = Math.max( 1, barGroupW - barPad * 2 );

	ctx.strokeStyle = 'rgba(0,0,0,0.07)';
	ctx.lineWidth = 1;
	for ( let i = 0; i <= 3; i++ ) {
		const y = PAD.top + chartH - ( chartH * i / 3 );
		ctx.beginPath();
		ctx.moveTo( PAD.left, y );
		ctx.lineTo( PAD.left + chartW, y );
		ctx.stroke();
		ctx.fillStyle = 'rgba(0,0,0,0.35)';
		ctx.font = '9px -apple-system, sans-serif';
		ctx.textAlign = 'right';
		ctx.fillText( String( Math.round( maxVal * i / 3 ) ), PAD.left - 4, y + 3 );
	}

	for ( let i = 0; i < buckets.length; i++ ) {
		const b = buckets[ i ];
		const x = PAD.left + barGroupW * i + barPad;
		let yTop = PAD.top + chartH;

		for ( const seg of [
			{ value: b.published, color: COLORS.published },
			{ value: b.pending, color: COLORS.pending },
			{ value: b.draft, color: COLORS.draft },
		] ) {
			if ( seg.value === 0 ) {
				continue;
			}
			const segH = ( seg.value / maxVal ) * chartH;
			yTop -= segH;
			ctx.fillStyle = seg.color;
			ctx.beginPath();
			safeRoundRect( ctx, x, yTop, barW, segH, 2 );
			ctx.fill();
		}

		ctx.fillStyle = 'rgba(0,0,0,0.5)';
		ctx.font = '9px -apple-system, sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText( b.label, x + barW / 2, PAD.top + chartH + 13 );
	}
}

function renderHeader( container: HTMLElement, total: number, error: boolean ): void {
	const header = document.createElement( 'div' );
	header.className = 'dm-poststats__header';
	const title = document.createElement( 'span' );
	title.className = 'dm-poststats__title';
	title.textContent = 'Post Stats';
	const totalEl = document.createElement( 'span' );
	totalEl.className = 'dm-poststats__total';
	totalEl.textContent = error ? '' : `${ total } post${ total !== 1 ? 's' : '' } in 6 mo`;
	header.appendChild( title );
	header.appendChild( totalEl );
	container.appendChild( header );
}

function buildLegend( container: HTMLElement ): void {
	const legend = document.createElement( 'div' );
	legend.className = 'dm-poststats__legend';
	for ( const [ label, color ] of [
		[ 'Published', COLORS.published ],
		[ 'Pending', COLORS.pending ],
		[ 'Draft', COLORS.draft ],
	] as const ) {
		const item = document.createElement( 'div' );
		item.className = 'dm-poststats__legend-item';
		const swatch = document.createElement( 'span' );
		swatch.className = 'dm-poststats__legend-swatch';
		swatch.style.background = color;
		item.appendChild( swatch );
		item.appendChild( document.createTextNode( label ) );
		legend.appendChild( item );
	}
	container.appendChild( legend );
}

const mount = async ( container: HTMLElement, _ctx: WidgetContext ): Promise< WidgetTeardown > => {
	let destroyed = false;
	let ro: ResizeObserver | null = null;

	const refresh = async (): Promise< void > => {
		if ( destroyed ) {
			return;
		}
		try {
			const buckets = await fetchBuckets();
			const total = buckets.reduce(
				( sum, b ) => sum + b.published + b.pending + b.draft,
				0,
			);
			if ( destroyed ) {
				return;
			}
			container.innerHTML = '';
			renderHeader( container, total, false );
			if ( total === 0 ) {
				const empty = document.createElement( 'div' );
				empty.className = 'dm-poststats__empty';
				empty.textContent = 'No posts in the last 6 months.';
				container.appendChild( empty );
				return;
			}
			const wrap = document.createElement( 'div' );
			wrap.className = 'dm-poststats__canvas-wrap';
			const canvas = document.createElement( 'canvas' );
			canvas.className = 'dm-poststats__canvas';
			wrap.appendChild( canvas );
			container.appendChild( wrap );
			buildLegend( container );
			ro?.disconnect();
			ro = new ResizeObserver( ( entries ) => {
				if ( destroyed ) {
					return;
				}
				const entry = entries[ 0 ];
				if ( entry && entry.contentRect.width > 0 && entry.contentRect.height > 0 ) {
					drawChart( canvas, buckets );
				}
			} );
			ro.observe( wrap );
		} catch {
			if ( ! destroyed ) {
				container.innerHTML = '';
				renderHeader( container, 0, true );
				const errEl = document.createElement( 'div' );
				errEl.className = 'dm-poststats__error';
				errEl.textContent = 'Could not load post data.';
				container.appendChild( errEl );
			}
		}
	};

	await refresh();
	const poller = startVisibilityAwarePoller( refresh, REFRESH_MS );

	return () => {
		destroyed = true;
		poller.stop();
		ro?.disconnect();
	};
};

const w = window as unknown as {
	openStationWidgets?: Record< string, typeof mount >;
};
w.openStationWidgets = w.openStationWidgets ?? {};
w.openStationWidgets[ WIDGET_ID ] = mount;
