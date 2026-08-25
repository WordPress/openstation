/**
 * Code Blue — pure data model.
 *
 * Grouping, filtering, and time-bucketing over the entries the REST
 * layer returns. No DOM, no fetch, no i18n — everything here is
 * exercised directly by `tests/vitest/code-blue-model.test.ts`.
 *
 * @public
 */

import type {
	HistogramData,
	IssueGroup,
	LevelBucket,
	LogEntry,
	LogLevel,
} from './types';

/** Stack/legend order, bottom of the stack first. See types.ts. */
export const BUCKET_ORDER: readonly LevelBucket[] = [
	'error',
	'warning',
	'deprecated',
	'info',
];

const BUCKET_OF: Record<LogLevel, LevelBucket> = {
	fatal: 'error',
	error: 'error',
	warning: 'warning',
	deprecated: 'deprecated',
	notice: 'info',
	info: 'info',
};

/** Map a parser severity onto its display bucket. */
export function bucketOf( level: LogLevel ): LevelBucket {
	return BUCKET_OF[ level ] ?? 'info';
}

const SEVERITY_RANK: Record<LogLevel, number> = {
	fatal: 0,
	error: 1,
	warning: 2,
	deprecated: 3,
	notice: 4,
	info: 5,
};

/** Lower = more severe. Unknown levels sort last. */
export function severityRank( level: LogLevel ): number {
	return SEVERITY_RANK[ level ] ?? 6;
}

/** Occurrence timestamps kept per group for the detail view. */
const MAX_OCCURRENCES = 20;

/**
 * Fold entries into issue groups keyed by the server signature.
 *
 * The group takes the most severe level seen, the latest message
 * text (messages in a group differ only in collapsed numbers), and
 * the longest trace as its detail sample.
 */
export function groupEntries( entries: readonly LogEntry[] ): IssueGroup[] {
	const byKey = new Map<string, IssueGroup>();

	for ( const entry of entries ) {
		const existing = byKey.get( entry.signature );
		if ( ! existing ) {
			byKey.set( entry.signature, {
				signature: entry.signature,
				level: entry.level,
				bucket: bucketOf( entry.level ),
				label: entry.label,
				message: entry.message,
				file: entry.file,
				line: entry.line,
				count: 1,
				firstTs: entry.timestamp,
				lastTs: entry.timestamp,
				trace: entry.trace,
				occurrences:
					entry.timestamp === null ? [] : [ entry.timestamp ],
			} );
			continue;
		}

		existing.count += 1;
		if ( severityRank( entry.level ) < severityRank( existing.level ) ) {
			existing.level = entry.level;
			existing.bucket = bucketOf( entry.level );
			existing.label = entry.label;
		}
		// Entries arrive oldest-first, so the latest occurrence wins
		// the message/file/line slot (freshest line numbers).
		existing.message = entry.message;
		existing.file = entry.file;
		existing.line = entry.line;
		if ( entry.trace.length > existing.trace.length ) {
			existing.trace = entry.trace;
		}
		if ( entry.timestamp !== null ) {
			if ( existing.firstTs === null || entry.timestamp < existing.firstTs ) {
				existing.firstTs = entry.timestamp;
			}
			if ( existing.lastTs === null || entry.timestamp > existing.lastTs ) {
				existing.lastTs = entry.timestamp;
			}
			existing.occurrences.unshift( entry.timestamp );
			if ( existing.occurrences.length > MAX_OCCURRENCES ) {
				existing.occurrences.length = MAX_OCCURRENCES;
			}
		}
	}

	return Array.from( byKey.values() );
}

/** How the issue list is ordered. */
export type SortMode = 'recent' | 'frequent';

/**
 * Order groups. `recent` puts the latest occurrence first (groups
 * with no timestamp sink to the bottom); `frequent` puts the
 * highest count first, severity breaking ties.
 */
export function sortGroups(
	groups: readonly IssueGroup[],
	mode: SortMode,
): IssueGroup[] {
	const sorted = groups.slice();
	if ( mode === 'frequent' ) {
		sorted.sort(
			( a, b ) =>
				b.count - a.count ||
				severityRank( a.level ) - severityRank( b.level ) ||
				( b.lastTs ?? 0 ) - ( a.lastTs ?? 0 ),
		);
	} else {
		sorted.sort(
			( a, b ) =>
				( b.lastTs ?? -1 ) - ( a.lastTs ?? -1 ) ||
				severityRank( a.level ) - severityRank( b.level ) ||
				b.count - a.count,
		);
	}
	return sorted;
}

export interface EntryFilter {
	/** Buckets to keep; an empty set keeps everything. */
	buckets: ReadonlySet<LevelBucket>;
	/** Case-insensitive substring over message + label + file. */
	query: string;
	/** Keep entries at/after this Unix second; null = no floor. */
	sinceTs: number | null;
}

/**
 * Apply the toolbar filters to the raw entry list.
 *
 * Untimestamped entries pass a time filter only when no floor is
 * set — a floor means "this window of time", and an entry that
 * can't prove it belongs there doesn't.
 */
export function filterEntries(
	entries: readonly LogEntry[],
	filter: EntryFilter,
): LogEntry[] {
	const query = filter.query.trim().toLowerCase();
	return entries.filter( ( entry ) => {
		if ( filter.buckets.size > 0 && ! filter.buckets.has( bucketOf( entry.level ) ) ) {
			return false;
		}
		if ( filter.sinceTs !== null ) {
			if ( entry.timestamp === null || entry.timestamp < filter.sinceTs ) {
				return false;
			}
		}
		if ( query !== '' ) {
			const haystack = (
				entry.message +
				'\n' +
				entry.label +
				'\n' +
				entry.file
			).toLowerCase();
			if ( ! haystack.includes( query ) ) {
				return false;
			}
		}
		return true;
	} );
}

/** Per-bucket totals for the stat tiles. */
export function countBuckets(
	entries: readonly LogEntry[],
): Record<LevelBucket, number> {
	const totals: Record<LevelBucket, number> = {
		error: 0,
		warning: 0,
		deprecated: 0,
		info: 0,
	};
	for ( const entry of entries ) {
		totals[ bucketOf( entry.level ) ] += 1;
	}
	return totals;
}

function emptyColumn(): Record<LevelBucket, number> {
	return { error: 0, warning: 0, deprecated: 0, info: 0 };
}

/**
 * Bucket timestamped entries into `bucketCount` stacked columns
 * between `sinceTs` (or the oldest timestamp when null) and `nowTs`.
 *
 * Untimestamped entries never chart. Returns null when nothing in
 * the list carries a timestamp — the caller renders an empty state
 * instead of an empty grid.
 */
export function bucketize(
	entries: readonly LogEntry[],
	sinceTs: number | null,
	nowTs: number,
	bucketCount: number,
): HistogramData | null {
	const stamped = entries.filter(
		( entry ): entry is LogEntry & { timestamp: number } =>
			entry.timestamp !== null,
	);
	if ( stamped.length === 0 ) {
		return null;
	}

	let start = sinceTs;
	if ( start === null ) {
		start = stamped.reduce(
			( min, entry ) => Math.min( min, entry.timestamp ),
			Infinity,
		);
	}
	const end = Math.max( nowTs, start + bucketCount );
	const span = end - start;
	const bucketSec = Math.max( 1, Math.ceil( span / bucketCount ) );

	const buckets: Array<Record<LevelBucket, number>> = [];
	for ( let i = 0; i < bucketCount; i++ ) {
		buckets.push( emptyColumn() );
	}

	for ( const entry of stamped ) {
		if ( entry.timestamp < start || entry.timestamp > end ) {
			continue;
		}
		const index = Math.min(
			bucketCount - 1,
			Math.floor( ( entry.timestamp - start ) / bucketSec ),
		);
		buckets[ index ][ bucketOf( entry.level ) ] += 1;
	}

	return { start, end, bucketSec, buckets };
}

