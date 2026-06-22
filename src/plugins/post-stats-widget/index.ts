/**
 * Desktop Mode — Post Stats Widget (lazy bundle).
 *
 * Stacked canvas bar chart of posts per calendar month over
 * the last 6 months, split by Published / Pending / Draft.
 * Chart redraws on ResizeObserver so it stays crisp at any
 * card size. HiDPI-aware via devicePixelRatio.
 *
 * Data: WP REST /wp/v2/posts with status filter and after= date.
 * Refresh: every 5 minutes.
 *
 * @since 0.26.0
 */
import './styles.css';
import { trackedFetch } from '../../tracked-fetch';
import type { WidgetContext, WidgetTeardown } from '../../widgets/types';

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

interface PostStub {
	id: number;
	date: string;
	status: string;
}

function monthKey( date: Date ): string {
	return date.getFullYear() + '-' + String( date.getMonth() + 1 ).padStart( 2, '0' );
}

function shortLabel( ym: string ): string {
	const [ , m ] = ym.split( '-' );
	return new Date( 2000, parseInt( m, 10 ) - 1, 1 )
		.toLocaleString( undefined, { month: 'short' } );
}

function buildBuckets(): Bucket[] {
	const now = new Date();
	return Array.from( { length: MONTHS_BACK }, ( _, i ) => {
		const d = new Date( now.getFullYear(), now.getMonth() - ( MONTHS_BACK - 1 - i ), 1 );
		const ym = monthKey( d );
		return { ym, label: shortLabel( ym ), published: 0, pending: 0, draft: 0 };
	} );
}

async function fetchPosts(): Promise< PostStub[] > {
	const root = ( window as unknown as { wpApiSettings?: { root?: string } } )
		.wpApiSettings?.root ?? '/wp-json/';
	const cutoff = new Date();
	cutoff.setMonth( cutoff.getMonth() - MONTHS_BACK );
	cutoff.setDate( 1 );
	const after = cutoff.toISOString();
	const statuses = [ 'publish', 'draft', 'pending' ] as const;
	const all: PostStub[] = [];

	for ( const status of statuses ) {
		let page = 1;
		let total = Infinity;
		while ( all.length < 200 && ( page - 1 ) * 100 < total ) {
			const res = await trackedFetch(
				root.replace( /\/$/, '' ) +
					`/wp/v2/posts?per_page=100&page=${ page }&status=${ status }&after=${ encodeURIComponent( after ) }&_fields=id,date,status`,
				{ credentials: 'same-origin' },
				{ source: 'desktop-mode/post-stats', silent: true },
			);
			if ( ! res.ok ) {
				break;
			}
			total = parseInt( res.headers.get( 'X-WP-Total' ) ?? '0', 10 );
			const posts = await res.json() as PostStub[];
			if ( ! Array.isArray( posts ) || posts.length === 0 ) {
				break;
			}
			all.push( ...posts );
			page++;
		}
	}
	return all;
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

	// Skip if layout has not settled yet. ResizeObserver will fire again
	// once the canvas wrapper has real dimensions.
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

	// Gridlines
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

	// Bars
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

function renderUI( container: HTMLElement, buckets: Bucket[], total: number, error: boolean ): HTMLCanvasElement | null {
	container.innerHTML = '';

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

	if ( error ) {
		const errEl = document.createElement( 'div' );
		errEl.className = 'dm-poststats__error';
		errEl.textContent = 'Could not load post data.';
		container.appendChild( errEl );
		return null;
	}
	if ( total === 0 ) {
		const empty = document.createElement( 'div' );
		empty.className = 'dm-poststats__empty';
		empty.textContent = 'No posts in the last 6 months.';
		container.appendChild( empty );
		return null;
	}

	const wrap = document.createElement( 'div' );
	wrap.className = 'dm-poststats__canvas-wrap';

	const canvas = document.createElement( 'canvas' );
	canvas.className = 'dm-poststats__canvas';
	wrap.appendChild( canvas );
	container.appendChild( wrap );

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

	return canvas;
}

const mount = async ( container: HTMLElement, _ctx: WidgetContext ): Promise< WidgetTeardown > => {
	let destroyed = false;
	let intervalId: ReturnType< typeof setInterval > | null = null;
	let ro: ResizeObserver | null = null;

	const refresh = async (): Promise< void > => {
		if ( destroyed ) {
			return;
		}
		try {
			const posts = await fetchPosts();
			const buckets = buildBuckets();
			for ( const post of posts ) {
				const ym = post.date ? post.date.slice( 0, 7 ) : null;
				const bucket = ym ? buckets.find( ( b ) => b.ym === ym ) : null;
				if ( ! bucket ) {
					continue;
				}
				if ( post.status === 'publish' ) {
					bucket.published++;
				} else if ( post.status === 'pending' ) {
					bucket.pending++;
				} else if ( post.status === 'draft' ) {
					bucket.draft++;
				}
			}
			const total = posts.length;
			if ( destroyed ) {
				return;
			}
			const canvas = renderUI( container, buckets, total, false );
			if ( canvas ) {
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
				ro.observe( canvas.parentElement! );
			}
		} catch {
			if ( ! destroyed ) {
				renderUI( container, buildBuckets(), 0, true );
			}
		}
	};

	await refresh();
	intervalId = setInterval( refresh, REFRESH_MS );

	return () => {
		destroyed = true;
		if ( intervalId !== null ) {
			clearInterval( intervalId );
		}
		ro?.disconnect();
	};
};

const w = window as unknown as {
	desktopModeWidgets?: Record< string, typeof mount >;
};
w.desktopModeWidgets = w.desktopModeWidgets ?? {};
w.desktopModeWidgets[ WIDGET_ID ] = mount;
