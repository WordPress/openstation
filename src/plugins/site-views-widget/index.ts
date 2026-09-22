/**
 * OpenStation — Site Views Widget (lazy bundle).
 *
 * Smooth SVG sparkline of page views for the last 7 days,
 * total view count, and a week-over-week delta arrow.
 *
 * Data priority:
 *   1. Jetpack Stats REST /jetpack/v4/stats/visits?unit=day&quantity=14
 *   2. Meta-key fallback  /desktop-mode/v1/site-views-meta
 *      (reads _post_views_YYYY-MM-DD meta written by post-views plugins)
 *
 * Shows a friendly "no source" state rather than failing silently
 * when neither source has data.
 *
 * Refresh: every 10 minutes.
 */
import './styles.css';
import { trackedFetch } from '../../tracked-fetch';
import type { WidgetContext, WidgetTeardown } from '../../widgets/types';
import { startVisibilityAwarePoller } from '../../widgets/poller';

const WIDGET_ID = 'desktop-mode/site-views';
const REFRESH_MS = 10 * 60_000;

interface DayRow { date: string; views: number }
interface ViewResult { source: string; days: DayRow[] }

function shortDay( iso: string ): string {
	return new Date( iso + 'T12:00:00' )
		.toLocaleString( undefined, { weekday: 'short' } )
		.slice( 0, 3 );
}

function apiRoot(): string {
	const s = ( window as unknown as { wpApiSettings?: { root?: string } } ).wpApiSettings ?? {};
	return ( s.root ?? '/wp-json/' ).replace( /\/$/, '' );
}

async function tryJetpack(): Promise< DayRow[] | null > {
	try {
		const res = await trackedFetch(
			apiRoot() + '/jetpack/v4/stats/visits?unit=day&quantity=14',
			{ credentials: 'same-origin' },
			{ source: 'desktop-mode/site-views-jetpack', silent: true },
		);
		if ( ! res.ok ) {
			return null;
		}
		const data = await res.json() as { data?: [ number, number ][] };
		if ( ! Array.isArray( data?.data ) ) {
			return null;
		}
		return data.data.map( ( [ ts, views ] ) => ( {
			date: new Date( ts * 1000 ).toISOString().slice( 0, 10 ),
			views: views || 0,
		} ) );
	} catch {
		return null;
	}
}

async function tryMeta(): Promise< DayRow[] | null > {
	try {
		const res = await trackedFetch(
			apiRoot() + '/desktop-mode/v1/site-views-meta',
			{ credentials: 'same-origin' },
			{ source: 'desktop-mode/site-views-meta', silent: true },
		);
		if ( ! res.ok ) {
			return null;
		}
		const data = await res.json() as { has_data?: boolean; days?: DayRow[] };
		if ( ! data?.has_data ) {
			return null;
		}
		return data.days ?? null;
	} catch {
		return null;
	}
}

async function fetchViewData(): Promise< ViewResult > {
	const jetpack = await tryJetpack();
	if ( jetpack?.length ) {
		return { source: 'jetpack', days: jetpack };
	}
	const meta = await tryMeta();
	if ( meta?.length ) {
		return { source: 'meta', days: meta };
	}
	return { source: 'none', days: [] };
}

function buildSparkPath( values: number[], W: number, H: number, pad: number ): {
	line: string; area: string; pts: [ number, number ][];
} | null {
	if ( values.length < 2 ) {
		return null;
	}
	const max = Math.max( 1, ...values );
	const pts: [ number, number ][] = values.map( ( v, i ) => [
		pad + ( ( W - pad * 2 ) / ( values.length - 1 ) ) * i,
		H - pad - ( v / max ) * ( H - pad * 2 ),
	] );
	let d = `M ${ pts[ 0 ][ 0 ] } ${ pts[ 0 ][ 1 ] }`;
	for ( let i = 1; i < pts.length; i++ ) {
		const cpx = ( pts[ i - 1 ][ 0 ] + pts[ i ][ 0 ] ) / 2;
		d += ` C ${ cpx } ${ pts[ i - 1 ][ 1 ] }, ${ cpx } ${ pts[ i ][ 1 ] }, ${ pts[ i ][ 0 ] } ${ pts[ i ][ 1 ] }`;
	}
	const area = d +
		` L ${ pts[ pts.length - 1 ][ 0 ] } ${ H } L ${ pts[ 0 ][ 0 ] } ${ H } Z`;
	return { line: d, area, pts };
}

function renderUI( container: HTMLElement, result: ViewResult | null, error: boolean ): void {
	container.innerHTML = '';

	const header = document.createElement( 'div' );
	header.className = 'dm-views__header';
	const title = document.createElement( 'span' );
	title.className = 'dm-views__title';
	title.textContent = 'Site Views';
	header.appendChild( title );
	container.appendChild( header );

	if ( error ) {
		const e = document.createElement( 'div' );
		e.className = 'dm-views__error';
		e.textContent = 'Could not load view data.';
		container.appendChild( e );
		return;
	}

	if ( ! result || result.source === 'none' || result.days.length === 0 ) {
		const ns = document.createElement( 'div' );
		ns.className = 'dm-views__no-source';
		const p = document.createElement( 'p' );
		p.textContent = 'No stats source found. Activate Jetpack Stats or a post-views plugin that writes ';
		const code = document.createElement( 'code' );
		code.textContent = '_post_views_YYYY-MM-DD';
		p.appendChild( code );
		p.appendChild( document.createTextNode( ' meta keys.' ) );
		ns.appendChild( p );
		container.appendChild( ns );
		return;
	}

	const thisWeek = result.days.slice( -7 );
	const prevWeek = result.days.slice( -14, -7 );
	const thisTotal = thisWeek.reduce( ( s, d ) => s + d.views, 0 );
	const prevTotal = prevWeek.reduce( ( s, d ) => s + d.views, 0 );

	const kpi = document.createElement( 'div' );
	kpi.className = 'dm-views__kpi';

	const totalEl = document.createElement( 'span' );
	totalEl.className = 'dm-views__total';
	totalEl.textContent = thisTotal.toLocaleString();

	const deltaEl = document.createElement( 'span' );
	deltaEl.className = 'dm-views__delta';
	if ( prevTotal === 0 ) {
		deltaEl.classList.add( 'dm-views__delta--flat' );
		deltaEl.textContent = '\u2014';
	} else {
		const pct = Math.round( ( ( thisTotal - prevTotal ) / prevTotal ) * 100 );
		if ( pct > 0 ) {
			deltaEl.classList.add( 'dm-views__delta--up' );
			deltaEl.textContent = '\u2191 ' + pct + '%';
		} else if ( pct < 0 ) {
			deltaEl.classList.add( 'dm-views__delta--down' );
			deltaEl.textContent = '\u2193 ' + Math.abs( pct ) + '%';
		} else {
			deltaEl.classList.add( 'dm-views__delta--flat' );
			deltaEl.textContent = '\u2192 0%';
		}
	}

	const label = document.createElement( 'span' );
	label.className = 'dm-views__label';
	label.textContent = 'views this week';

	kpi.appendChild( totalEl );
	kpi.appendChild( deltaEl );
	kpi.appendChild( label );
	container.appendChild( kpi );

	const svgNS = 'http://www.w3.org/2000/svg';
	const sparkWrap = document.createElement( 'div' );
	sparkWrap.className = 'dm-views__spark';
	const svg = document.createElementNS( svgNS, 'svg' );
	svg.setAttribute( 'viewBox', '0 0 300 80' );
	svg.setAttribute( 'preserveAspectRatio', 'none' );

	const paths = buildSparkPath( thisWeek.map( ( d ) => d.views ), 300, 80, 4 );
	if ( paths ) {
		const area = document.createElementNS( svgNS, 'path' );
		area.setAttribute( 'd', paths.area );
		area.setAttribute( 'fill', 'rgba(59,130,246,0.12)' );
		svg.appendChild( area );

		const line = document.createElementNS( svgNS, 'path' );
		line.setAttribute( 'd', paths.line );
		line.setAttribute( 'fill', 'none' );
		line.setAttribute( 'stroke', '#3b82f6' );
		line.setAttribute( 'stroke-width', '2' );
		line.setAttribute( 'stroke-linecap', 'round' );
		svg.appendChild( line );

		const last = paths.pts[ paths.pts.length - 1 ];
		const dot = document.createElementNS( svgNS, 'circle' );
		dot.setAttribute( 'cx', String( last[ 0 ] ) );
		dot.setAttribute( 'cy', String( last[ 1 ] ) );
		dot.setAttribute( 'r', '3' );
		dot.setAttribute( 'fill', '#3b82f6' );
		svg.appendChild( dot );
	}
	sparkWrap.appendChild( svg );
	container.appendChild( sparkWrap );

	const daysEl = document.createElement( 'div' );
	daysEl.className = 'dm-views__days';
	thisWeek.forEach( ( d ) => {
		const span = document.createElement( 'span' );
		span.textContent = shortDay( d.date );
		daysEl.appendChild( span );
	} );
	container.appendChild( daysEl );
}

const mount = async ( container: HTMLElement, _ctx: WidgetContext ): Promise< WidgetTeardown > => {
	let destroyed = false;
	const refresh = async (): Promise< void > => {
		if ( destroyed ) {
			return;
		}
		try {
			const result = await fetchViewData();
			if ( ! destroyed ) {
				renderUI( container, result, false );
			}
		} catch {
			if ( ! destroyed ) {
				renderUI( container, null, true );
			}
		}
	};
	await refresh();
	const poller = startVisibilityAwarePoller( refresh, REFRESH_MS );
	return () => {
		destroyed = true;
		poller.stop();
	};
};

const w = window as unknown as {
	openStationWidgets?: Record< string, typeof mount >;
};
w.openStationWidgets = w.openStationWidgets ?? {};
w.openStationWidgets[ WIDGET_ID ] = mount;
