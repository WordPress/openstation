/**
 * Code Blue — shared types.
 *
 * The wire shapes mirror what `includes/code-blue/rest.php` emits;
 * the model shapes are what the pure functions in `model.ts` derive
 * from them.
 *
 * @public
 */

/** Severity slug assigned by the PHP parser, most to least severe. */
export type LogLevel =
	| 'fatal'
	| 'error'
	| 'warning'
	| 'deprecated'
	| 'notice'
	| 'info';

/**
 * Display bucket — the four series the chart, legend, and stat
 * tiles work in. `fatal` folds into `error`; `notice` folds into
 * `info`. The stack order (error → warning → deprecated → info,
 * bottom to top) is deliberate: it keeps the two pale hues
 * (warning's yellow, info's cyan) non-adjacent so neighboring
 * segments stay distinguishable.
 */
export type LevelBucket = 'error' | 'warning' | 'deprecated' | 'info';

/** One parsed log record from the REST layer. */
export interface LogEntry {
	/** Unix seconds (UTC), or null for untimestamped lines. */
	timestamp: number | null;
	level: LogLevel;
	/** Human label as logged, e.g. `PHP Fatal error`. */
	label: string;
	message: string;
	/** Absolute file path, '' when the line carried none. */
	file: string;
	line: number;
	trace: string;
	/** Server-computed grouping key. */
	signature: string;
}

/** One log file the server offers. */
export interface LogSource {
	id: string;
	label: string;
	path: string;
	exists: boolean;
	readable: boolean;
	writable: boolean;
	size: number;
	mtime: number;
}

/** One environment-card row (debug constants, versions). */
export interface EnvRow {
	key: string;
	label: string;
	value: string;
	/** true/false renders an on/off tone; null renders neutral. */
	on: boolean | null;
}

export interface SourcesResponse {
	sources: LogSource[];
	environment: EnvRow[];
}

export interface EntriesResponse {
	source: LogSource;
	entries: LogEntry[];
	truncated: boolean;
	scanned_bytes: number;
	dropped_entries: number;
	generated_at: number;
}

/** Localized window config from `openstation_register_window()`. */
export interface CodeBlueConfig {
	apiBase: string;
	restNonce: string;
}

/** One grouped issue — every occurrence sharing a signature. */
export interface IssueGroup {
	signature: string;
	/** Most severe level seen across occurrences. */
	level: LogLevel;
	bucket: LevelBucket;
	label: string;
	message: string;
	file: string;
	line: number;
	count: number;
	/** Unix seconds; null when no occurrence carried a timestamp. */
	firstTs: number | null;
	lastTs: number | null;
	/** Longest trace seen — the sample shown in the detail view. */
	trace: string;
	/** Latest occurrence timestamps, newest first (capped). */
	occurrences: number[];
}

/** The chart's input: one stacked column per time bucket. */
export interface HistogramData {
	/** Unix seconds of the first bucket's left edge. */
	start: number;
	/** Unix seconds of the last bucket's right edge. */
	end: number;
	/** Bucket width in seconds. */
	bucketSec: number;
	/** Per-bucket counts, index 0 = oldest. */
	buckets: Array<Record<LevelBucket, number>>;
}
