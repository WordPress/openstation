/**
 * Code Blue — the client half.
 *
 * The body, as a function of the state `code-blue.os.php` declared
 * and the data it returns: source picker + time range + search in the
 * toolbar, headline stat tiles, a stacked severity histogram whose
 * legend doubles as a series filter, and a grouped issue list with
 * expandable stack traces. Everything that only re-slices the entries
 * already in the browser — range, search, sort, legend, expand — is
 * a `local` action or a bound write and never waits for a request;
 * switching source, refreshing and clearing dispatch to PHP.
 *
 * Pure model functions first (grouping, filtering, time buckets),
 * then the view. `code-blue.test.ts` exercises the model directly.
 */

import { __, _n, defineApp, formatBytes, formatDate, html, sprintf } from '@openstation/app';

// ------------------------------------------------------------ types

type LogLevel = 'fatal' | 'error' | 'warning' | 'deprecated' | 'notice' | 'info';
export type Bucket = 'error' | 'warning' | 'deprecated' | 'info';
type RangeKey = '1h' | '24h' | '7d' | '30d' | 'all';
type SortMode = 'recent' | 'frequent';

/** One parsed entry, as `log-reader.php` shapes it. */
export interface LogEntry {
	timestamp: number | null;
	level: LogLevel;
	label: string;
	message: string;
	file: string;
	line: number;
	trace: string;
	signature: string;
}

interface LogSource {
	id: string;
	label: string;
	path: string;
	exists: boolean;
	readable: boolean;
	writable: boolean;
	size: number;
	mtime: number;
}

interface EnvRow {
	label: string;
	value: string;
	on: boolean | null;
}

interface State extends Record< string, unknown > {
	source: string;
	range: RangeKey;
	query: string;
	sort: SortMode;
	hidden: Bucket[];
	expanded: string[];
	auto: boolean;
	error: string;
}

interface Data {
	sources: LogSource[];
	source: LogSource | null;
	environment: EnvRow[];
	entries: LogEntry[];
	scanned: number;
	truncated: boolean;
	readError: string;
	now: number;
}

export interface IssueGroup {
	signature: string;
	level: LogLevel;
	bucket: Bucket;
	label: string;
	message: string;
	file: string;
	line: number;
	count: number;
	firstTs: number | null;
	lastTs: number | null;
	trace: string;
	occurrences: number[];
}

// ------------------------------------------------------------ model

/** Stack/legend order, bottom first; the two pale hues stay non-adjacent. */
export const BUCKETS: readonly Bucket[] = [ 'error', 'warning', 'deprecated', 'info' ];

const BUCKET_OF: Record< LogLevel, Bucket > = {
	fatal: 'error',
	error: 'error',
	warning: 'warning',
	deprecated: 'deprecated',
	notice: 'info',
	info: 'info',
};

const RANK: Record< LogLevel, number > = { fatal: 0, error: 1, warning: 2, deprecated: 3, notice: 4, info: 5 };

const TONES: Record< Bucket, string > = { error: 'danger', warning: 'warning', deprecated: 'neutral', info: 'info' };

const RANGE_SECONDS: Record< RangeKey, number > = { '1h': 3600, '24h': 86400, '7d': 604800, '30d': 2592000, all: 0 };

export const bucketOf = ( level: LogLevel ): Bucket => BUCKET_OF[ level ] ?? 'info';
const rank = ( level: LogLevel ): number => RANK[ level ] ?? 6;

/** Keep entries at/after `since`, matching `query`, outside `hidden`. Untimestamped entries fail a time floor. */
export function filterEntries( entries: readonly LogEntry[], since: number | null, query: string, hidden: readonly Bucket[] ): LogEntry[] {
	const q = query.trim().toLowerCase();
	return entries.filter( ( e ) => {
		if ( hidden.length > 0 && hidden.includes( bucketOf( e.level ) ) ) {
			return false;
		}
		if ( since !== null && ( e.timestamp === null || e.timestamp < since ) ) {
			return false;
		}
		return q === '' || `${ e.message }\n${ e.label }\n${ e.file }`.toLowerCase().includes( q );
	} );
}

export function countBuckets( entries: readonly LogEntry[] ): Record< Bucket, number > {
	const totals: Record< Bucket, number > = { error: 0, warning: 0, deprecated: 0, info: 0 };
	for ( const e of entries ) {
		totals[ bucketOf( e.level ) ]++;
	}
	return totals;
}

/** Fold entries into issue groups by signature: most severe level, latest message, longest trace. */
export function groupEntries( entries: readonly LogEntry[] ): IssueGroup[] {
	const byKey = new Map< string, IssueGroup >();
	for ( const e of entries ) {
		const g = byKey.get( e.signature );
		if ( ! g ) {
			byKey.set( e.signature, {
				signature: e.signature,
				level: e.level,
				bucket: bucketOf( e.level ),
				label: e.label,
				message: e.message,
				file: e.file,
				line: e.line,
				count: 1,
				firstTs: e.timestamp,
				lastTs: e.timestamp,
				trace: e.trace,
				occurrences: e.timestamp === null ? [] : [ e.timestamp ],
			} );
			continue;
		}
		g.count++;
		if ( rank( e.level ) < rank( g.level ) ) {
			g.level = e.level;
			g.bucket = bucketOf( e.level );
			g.label = e.label;
		}
		g.message = e.message;
		g.file = e.file;
		g.line = e.line;
		if ( e.trace.length > g.trace.length ) {
			g.trace = e.trace;
		}
		if ( e.timestamp !== null ) {
			g.firstTs = g.firstTs === null ? e.timestamp : Math.min( g.firstTs, e.timestamp );
			g.lastTs = g.lastTs === null ? e.timestamp : Math.max( g.lastTs, e.timestamp );
			g.occurrences.unshift( e.timestamp );
			g.occurrences.length = Math.min( g.occurrences.length, 20 );
		}
	}
	return Array.from( byKey.values() );
}

export function sortGroups( groups: readonly IssueGroup[], mode: SortMode ): IssueGroup[] {
	return groups.slice().sort( ( a, b ) =>
		mode === 'frequent'
			? b.count - a.count || rank( a.level ) - rank( b.level ) || ( b.lastTs ?? 0 ) - ( a.lastTs ?? 0 )
			: ( b.lastTs ?? -1 ) - ( a.lastTs ?? -1 ) || rank( a.level ) - rank( b.level ) || b.count - a.count,
	);
}

/** Bucket timestamped entries into `count` stacked columns between `since` (or the oldest) and `now`. */
export function bucketize( entries: readonly LogEntry[], since: number | null, now: number, count: number ): { start: number; end: number; columns: number[][] } {
	const stamps = entries.map( ( e ) => e.timestamp ).filter( ( t ): t is number => t !== null );
	if ( stamps.length === 0 ) {
		return { start: 0, end: 0, columns: [] };
	}
	const start = since ?? Math.min( ...stamps );
	const end = Math.max( now, start + count );
	const width = Math.max( 1, Math.ceil( ( end - start ) / count ) );
	const columns = Array.from( { length: count }, () => BUCKETS.map( () => 0 ) );
	for ( const e of entries ) {
		if ( e.timestamp === null || e.timestamp < start || e.timestamp > end ) {
			continue;
		}
		columns[ Math.min( count - 1, Math.floor( ( e.timestamp - start ) / width ) ) ][ BUCKETS.indexOf( bucketOf( e.level ) ) ]++;
	}
	return { start, end, columns };
}

const rowKey = ( g: IssueGroup ): string => g.signature; // Signatures are already the stable identity.
const envTone = ( on: boolean | null ): string => {
	if ( on === null ) {
		return 'info';
	}
	return on ? 'success' : 'neutral';
};
const emptyCopy = ( hasSource: boolean, filtered: boolean ): [ string, string ] => {
	if ( ! hasSource ) {
		return [ __( 'No readable log files found' ), __( 'Define WP_DEBUG and WP_DEBUG_LOG in wp-config.php (or point the error_log PHP directive at a file) and errors will start collecting here.' ) ];
	}
	if ( filtered ) {
		return [ __( 'Nothing matches the filters' ), __( 'Try widening the time range or clearing the search.' ) ];
	}
	return [ __( 'The log is clean' ), __( 'No entries were recorded in this time range.' ) ];
};
const fullTime = ( sec: number ): string => formatDate( sec * 1000, 'datetime' );
const fileBase = ( path: string ): string => path.split( /[\\/]/ ).pop() || path;
const iso = ( sec: number ): string => formatDate( sec * 1000, 'iso' );

// ------------------------------------------------------------- view

export default defineApp< State, Data >( 'openstation-code-blue', {
	local: {
		toggle: ( state, args ) => {
			const key = String( args.key ?? '' );
			state.expanded = state.expanded.includes( key ) ? state.expanded.filter( ( k ) => k !== key ) : [ ...state.expanded, key ];
		},
		series: ( state, args ) => {
			state.hidden = ( Array.isArray( args.hidden ) ? args.hidden : [] ).map( String ) as Bucket[];
		},
	},

	view: ( { state, data } ) => {
		const labels: Record< Bucket, string > = { error: __( 'Errors' ), warning: __( 'Warnings' ), deprecated: __( 'Deprecated' ), info: __( 'Info' ) };
		const span = RANGE_SECONDS[ state.range ] ?? 86400;
		const since = span > 0 ? data.now - span : null;
		const inRange = filterEntries( data.entries, since, state.query, [] );
		const visible = filterEntries( inRange, null, '', state.hidden );
		const totals = countBuckets( inRange );
		const groups = sortGroups( groupEntries( visible ), state.sort );
		const chart = bucketize( inRange, since, data.now, 48 );
		const filtered = state.query !== '' || state.hidden.length > 0;
		const error = state.error !== '' ? state.error : data.readError;
		const source = data.source;
		const series = BUCKETS.map( ( b ) => ( { key: b, label: labels[ b ], tone: TONES[ b ] } ) );
		const clearDisabled = ! source || ( source.exists && ! source.writable );
		const empty = emptyCopy( !! source, filtered );

		const issue = ( g: IssueGroup ) => {
			const key = rowKey( g );
			const open = state.expanded.includes( key );
			return html`
				<li class="os-cb-issue" data-tone=${ TONES[ g.bucket ] }>
					<button type="button" class="os-cb-issue__row" os-action="toggle" os-arg-key=${ key } aria-expanded=${ open ? 'true' : 'false' }>
						<span class="os-cb-issue__level"><span class="os-cb-swatch" data-tone=${ TONES[ g.bucket ] }></span><span class="os-cb-issue__label">${ g.label }</span></span>
						<span class="os-cb-issue__message" title=${ g.message }>${ g.message }</span>
						<span class="os-cb-issue__meta">
							${ g.file !== '' ? html`<span class="os-cb-issue__file">${ g.line > 0 ? `${ fileBase( g.file ) }:${ g.line }` : fileBase( g.file ) }</span>` : '' }
							<os-badge no-dot>×${ g.count.toLocaleString() }</os-badge>
							${ g.lastTs !== null ? html`<os-relative-time compact class="os-cb-issue__when" datetime=${ iso( g.lastTs ) }></os-relative-time>` : '' }
						</span>
					</button>
					${ open
						? html`
							<div class="os-cb-issue__detail">
								<dl class="os-cb-issue__facts">
									${ g.file !== '' ? html`<dt>${ __( 'File' ) }</dt><dd>${ g.line > 0 ? `${ g.file }:${ g.line }` : g.file }</dd>` : '' }
									${ g.firstTs !== null ? html`<dt>${ __( 'First seen' ) }</dt><dd>${ fullTime( g.firstTs ) }</dd>` : '' }
									${ g.lastTs !== null ? html`<dt>${ __( 'Last seen' ) }</dt><dd>${ fullTime( g.lastTs ) }</dd>` : '' }
									<dt>${ __( 'Occurrences' ) }</dt><dd>${ g.count.toLocaleString() }</dd>
								</dl>
								${ g.occurrences.length > 1
									? html`<os-cluster gap="8" align="baseline" class="os-cb-issue__times">
										<span class="os-cb-issue__times-label">${ __( 'Latest occurrences' ) }</span>
										${ g.occurrences.slice( 0, 8 ).map( ( ts ) => html`<os-badge no-dot tone="neutral">${ fullTime( ts ) }</os-badge>` ) }
									</os-cluster>`
									: '' }
								${ g.trace !== '' ? html`<os-code block class="os-cb-issue__trace">${ g.trace }</os-code>` : '' }
							</div>`
						: '' }
				</li>`;
		};

		return html`
			<os-stack gap="12" class="os-cb">
				<os-cluster gap="10" align="end" class="os-cb__toolbar">
					<os-select label=${ __( 'Log source' ) } class="os-cb__source" os-bind="source" os-action="source" value=${ state.source }>
						${ data.sources.map( ( s ) => html`<os-option value=${ s.id } ?disabled=${ s.exists && ! s.readable }>${
							s.exists ? `${ s.label } (${ formatBytes( s.size ) })` : sprintf( /* translators: %s: log source label. */ __( '%s (empty)' ), s.label )
						}</os-option>` ) }
					</os-select>
					<os-segmented label=${ __( 'Time range' ) } os-bind="range" value=${ state.range }>
						${ ( Object.keys( RANGE_SECONDS ) as RangeKey[] ).map( ( k ) => html`<os-segment value=${ k }>${ k === 'all' ? __( 'All' ) : k }</os-segment>` ) }
					</os-segmented>
					<os-text-field type="search" class="os-cb__search" label=${ __( 'Search' ) } placeholder=${ __( 'Filter messages…' ) } os-bind="query"></os-text-field>
					<span class="os-app__spacer"></span>
					<os-segmented label=${ __( 'Sort issues' ) } os-bind="sort" value=${ state.sort }>
						<os-segment value="recent">${ __( 'Recent' ) }</os-segment>
						<os-segment value="frequent">${ __( 'Frequent' ) }</os-segment>
					</os-segmented>
					<os-switch class="os-cb__auto" label=${ __( 'Auto' ) } os-bind="auto" ?checked=${ state.auto }></os-switch>
					<os-button variant="secondary" os-action="refresh">${ __( 'Refresh' ) }</os-button>
					<os-button variant="danger" os-action="clear" os-confirm-danger
						os-confirm-title=${ __( 'Clear this log?' ) } os-confirm-label=${ __( 'Clear log' ) }
						os-confirm=${ sprintf( /* translators: %s: log file path. */ __( 'Every entry in %s will be deleted from disk. This cannot be undone.' ), source?.path ?? '' ) }
						?disabled=${ clearDisabled }>${ __( 'Clear log' ) }</os-button>
				</os-cluster>

				${ state.auto ? html`<span os-poll="30000" os-action="refresh" hidden></span>` : '' }
				${ error !== '' ? html`<os-notice tone="error" not-dismissible>${ error }</os-notice>` : '' }

				<os-grid gap="10" class="os-cb__stats">
					<os-stat value=${ inRange.length.toLocaleString() } label=${ __( 'Events' ) }></os-stat>
					${ BUCKETS.map( ( b ) => html`<os-stat value=${ totals[ b ].toLocaleString() } label=${ labels[ b ] } swatch data-tone=${ TONES[ b ] }></os-stat>` ) }
				</os-grid>

				<os-cluster gap="6" class="os-cb__env">
					${ data.environment.map( ( r ) => html`<os-badge tone=${ envTone( r.on ) }>${ r.label }: ${ r.value }</os-badge>` ) }
				</os-cluster>

				<os-histogram class="os-cb__card os-cb__chart" legend os-action="series"
					heading=${ __( 'Events over time' ) }
					series=${ JSON.stringify( series ) } columns=${ JSON.stringify( chart.columns ) }
					start=${ String( chart.start ) } end=${ String( chart.end ) }
					hidden-series=${ state.hidden.join( ',' ) }
					empty=${ __( 'No events in this range.' ) }></os-histogram>

				<section class="os-cb__card os-cb__issues">
					<div class="os-cb__card-head"><h2 class="os-cb__card-title">${ sprintf( /* translators: %s: number of grouped issues. */ _n( 'Issues (%s)', 'Issues (%s)', groups.length ), groups.length.toLocaleString() ) }</h2></div>
					<ul class="os-cb__list">
						${ groups.length === 0 ? html`<li class="os-cb__list-empty"><os-empty-state heading=${ empty[ 0 ] } description=${ empty[ 1 ] }></os-empty-state></li>` : groups.map( issue ) }
					</ul>
				</section>

				${ source
					? html`<os-cluster justify="space-between" class="os-cb__footer">
						<span>${ [
							sprintf( /* translators: 1: bytes scanned, 2: total file size. */ __( 'Scanned %1$s of %2$s' ), formatBytes( data.scanned ), formatBytes( source.size ) ),
							sprintf( /* translators: %s: number of parsed log entries. */ _n( '%s entry', '%s entries', data.entries.length ), data.entries.length.toLocaleString() ),
							data.truncated ? __( 'older entries not shown' ) : '',
						].filter( Boolean ).join( ' · ' ) }</span>
						<span>${ __( 'Updated' ) } <os-relative-time datetime=${ iso( data.now ) }></os-relative-time></span>
					</os-cluster>`
					: '' }
			</os-stack>
		`;
	},
} );
