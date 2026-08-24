/**
 * Code Blue — render entry point.
 *
 * Lazy-loaded by the native-window sync the first time the
 * `openstation-code-blue` window opens. An error-log reader in the
 * Grafana mold: source picker + time range + search in the toolbar,
 * headline stat tiles, a stacked severity histogram whose legend
 * doubles as a series filter, and a grouped issue list with
 * expandable stack traces.
 *
 * The `<os-*>` component modules this bundle instantiates are
 * imported below — `defineComponent` is idempotent, so co-shipping
 * with the main desktop bundle is safe.
 *
 * @public
 */

import '../ui/components/os-badge/os-badge';
import '../ui/components/os-button/os-button';
import '../ui/components/os-empty-state/os-empty-state';
import '../ui/components/os-notice/os-notice';
import '../ui/components/os-relative-time/os-relative-time';
import '../ui/components/os-segmented/os-segmented';
import '../ui/components/os-select/os-select';
import '../ui/components/os-switch/os-switch';
import '../ui/components/os-text-field/os-text-field';
import { __, _n, sprintf } from '../i18n';
import { formatBytes } from '../os-file-drop/format-bytes';
import {
	BUCKET_ORDER,
	bucketize,
	countBuckets,
	filterEntries,
	groupEntries,
	sortGroups,
	type SortMode,
} from './model';
import { renderHistogram, type ChartOptions } from './chart';
import {
	WINDOW_ID,
	clearSource,
	fetchEntries,
	fetchSources,
	getConfig,
} from './rest';
import type {
	CodeBlueConfig,
	EntriesResponse,
	EnvRow,
	IssueGroup,
	LevelBucket,
	LogEntry,
	LogSource,
} from './types';

// The framework's actual signature is wider but every feature bundle
// re-declares it as a narrow `() => void` and global declarations
// must agree — see content-graph/index.ts for the full story.
type RenderCallback = ( body: HTMLElement ) => void;

declare global {
	interface Window {
		openStationNativeWindows?: Record< string, RenderCallback | undefined >;
	}
}

interface ConfirmOptions {
	title?: string;
	message: string;
	confirmLabel?: string;
	cancelLabel?: string;
	danger?: boolean;
}

/**
 * Bridge to `wp.os.confirm` (the main bundle's `<os-confirm-dialog>`
 * wrapper) — same shape as the recycle-bin bundle uses.
 */
function osConfirmGlobal( options: ConfirmOptions ): Promise< boolean > {
	const fn = (
		window.wp as
			| { os?: { confirm?: ( o: ConfirmOptions ) => Promise< boolean > } }
			| undefined
	)?.os?.confirm;
	if ( typeof fn !== 'function' ) {
		return Promise.reject(
			new Error( '[openstation] wp.os.confirm is missing.' ),
		);
	}
	return fn( options );
}

type RangeKey = '1h' | '24h' | '7d' | '30d' | 'all';

const RANGE_SECONDS: Record< RangeKey, number | null > = {
	'1h': 3600,
	'24h': 86400,
	'7d': 7 * 86400,
	'30d': 30 * 86400,
	all: null,
};

const AUTO_REFRESH_MS = 30000;

interface State {
	sources: LogSource[];
	environment: EnvRow[];
	sourceId: string;
	response: EntriesResponse | null;
	range: RangeKey;
	query: string;
	sort: SortMode;
	/** Empty set = every bucket visible. */
	activeBuckets: Set< LevelBucket >;
	expanded: Set< string >;
	error: string;
}

function bucketLabels(): Record< LevelBucket, string > {
	return {
		error: __( 'Errors' ),
		warning: __( 'Warnings' ),
		deprecated: __( 'Deprecated' ),
		info: __( 'Info' ),
	};
}

function el< K extends keyof HTMLElementTagNameMap >(
	tag: K,
	className?: string,
	text?: string,
): HTMLElementTagNameMap[ K ] {
	const node = document.createElement( tag );
	if ( className ) {
		node.className = className;
	}
	if ( text !== undefined ) {
		node.textContent = text;
	}
	return node;
}

function fileBase( path: string ): string {
	const parts = path.split( /[\\/]/ );
	return parts[ parts.length - 1 ] || path;
}

function formatClock( sec: number ): string {
	return new Date( sec * 1000 ).toLocaleTimeString( [], {
		hour: '2-digit',
		minute: '2-digit',
	} );
}

function formatDay( sec: number ): string {
	return new Date( sec * 1000 ).toLocaleDateString( [], {
		month: 'short',
		day: 'numeric',
	} );
}

function formatFull( sec: number ): string {
	return new Date( sec * 1000 ).toLocaleString( [], {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	} );
}

async function renderCodeBlue( body: HTMLElement ): Promise< () => void > {
	const root = body.querySelector< HTMLElement >( '[data-os-code-blue-root]' );
	if ( ! root ) {
		body.textContent = __( 'Code Blue container missing.' );
		return () => {};
	}
	const cfg: CodeBlueConfig = getConfig();
	const labels = bucketLabels();

	const state: State = {
		sources: [],
		environment: [],
		sourceId: '',
		response: null,
		range: '24h',
		query: '',
		sort: 'recent',
		activeBuckets: new Set(),
		expanded: new Set(),
		error: '',
	};
	let disposed = false;
	let autoTimer: number | null = null;

	// ------------------------------------------------------- skeleton
	root.textContent = '';
	const app = el( 'div', 'os-cb' );

	const toolbar = el( 'header', 'os-cb__toolbar' );
	const sourceSelect = document.createElement( 'os-select' );
	sourceSelect.setAttribute( 'label', __( 'Log source' ) );
	sourceSelect.classList.add( 'os-cb__source' );

	const rangeSeg = document.createElement( 'os-segmented' );
	rangeSeg.setAttribute( 'label', __( 'Time range' ) );
	rangeSeg.setAttribute( 'value', state.range );
	for ( const [ key, label ] of [
		[ '1h', __( '1h' ) ],
		[ '24h', __( '24h' ) ],
		[ '7d', __( '7d' ) ],
		[ '30d', __( '30d' ) ],
		[ 'all', __( 'All' ) ],
	] as Array< [ RangeKey, string ] > ) {
		const seg = document.createElement( 'os-segment' );
		seg.setAttribute( 'value', key );
		seg.textContent = label;
		rangeSeg.appendChild( seg );
	}

	const search = document.createElement( 'os-text-field' );
	search.setAttribute( 'type', 'search' );
	search.setAttribute( 'label', __( 'Search' ) );
	search.setAttribute( 'placeholder', __( 'Filter messages…' ) );
	search.classList.add( 'os-cb__search' );

	const sortSeg = document.createElement( 'os-segmented' );
	sortSeg.setAttribute( 'label', __( 'Sort issues' ) );
	sortSeg.setAttribute( 'value', state.sort );
	for ( const [ key, label ] of [
		[ 'recent', __( 'Recent' ) ],
		[ 'frequent', __( 'Frequent' ) ],
	] as Array< [ SortMode, string ] > ) {
		const seg = document.createElement( 'os-segment' );
		seg.setAttribute( 'value', key );
		seg.textContent = label;
		sortSeg.appendChild( seg );
	}

	const autoSwitch = document.createElement( 'os-switch' );
	autoSwitch.setAttribute( 'label', __( 'Auto' ) );
	autoSwitch.classList.add( 'os-cb__auto' );

	const refreshBtn = document.createElement( 'os-button' );
	refreshBtn.setAttribute( 'variant', 'secondary' );
	refreshBtn.textContent = __( 'Refresh' );

	const clearBtn = document.createElement( 'os-button' );
	clearBtn.setAttribute( 'variant', 'danger' );
	clearBtn.textContent = __( 'Clear log' );

	toolbar.append(
		sourceSelect,
		rangeSeg,
		search,
		el( 'div', 'os-cb__toolbar-spacer' ),
		sortSeg,
		autoSwitch,
		refreshBtn,
		clearBtn,
	);

	const notice = document.createElement( 'os-notice' );
	notice.setAttribute( 'tone', 'error' );
	notice.setAttribute( 'not-dismissible', '' );
	notice.classList.add( 'os-cb__notice' );
	notice.hidden = true;

	const stats = el( 'div', 'os-cb__stats' );
	const envRowEl = el( 'div', 'os-cb__env' );

	const chartCard = el( 'section', 'os-cb__card os-cb__chart-card' );
	const chartHead = el( 'div', 'os-cb__card-head' );
	chartHead.appendChild(
		el( 'h2', 'os-cb__card-title', __( 'Events over time' ) ),
	);
	const legend = el( 'div', 'os-cb__legend' );
	legend.setAttribute( 'role', 'group' );
	legend.setAttribute( 'aria-label', __( 'Toggle severities' ) );
	chartHead.appendChild( legend );
	const chartHost = el( 'div', 'os-cb__chart-host' );
	chartCard.append( chartHead, chartHost );

	const issuesCard = el( 'section', 'os-cb__card os-cb__issues' );
	const issuesHead = el( 'div', 'os-cb__card-head' );
	const issuesTitle = el( 'h2', 'os-cb__card-title', __( 'Issues' ) );
	issuesHead.appendChild( issuesTitle );
	const list = el( 'ul', 'os-cb__list' );
	issuesCard.append( issuesHead, list );

	const footer = el( 'footer', 'os-cb__footer' );

	app.append( toolbar, notice, stats, envRowEl, chartCard, issuesCard, footer );
	root.appendChild( app );

	// ---------------------------------------------------- derivations
	const nowTs = (): number =>
		state.response?.generated_at ?? Math.floor( Date.now() / 1000 );

	const sinceTs = (): number | null => {
		const span = RANGE_SECONDS[ state.range ];
		return span === null ? null : nowTs() - span;
	};

	const chartOptions = (): ChartOptions => {
		const multiDay = RANGE_SECONDS[ state.range ] === null ||
			( RANGE_SECONDS[ state.range ] as number ) > 86400;
		return {
			bucketLabels: labels,
			formatTick: ( sec ) =>
				multiDay ? formatDay( sec ) : formatClock( sec ),
			formatSpan: ( start, end ) =>
				`${ formatFull( start ) } – ${ formatClock( end ) }`,
		};
	};

	// --------------------------------------------------------- paint

	// The filtered slices every paint function reads. Computed ONCE
	// per repaint by recompute() — the paint functions must not
	// re-derive them (four identical filterEntries passes per
	// keystroke was measurable jank at the 3000-entry cap).
	interface View {
		/** Range + search applied, all severities. */
		inRange: LogEntry[];
		/** `inRange` narrowed by the legend's severity toggles. */
		visible: LogEntry[];
		totals: Record< LevelBucket, number >;
	}
	let view: View = {
		inRange: [],
		visible: [],
		totals: { error: 0, warning: 0, deprecated: 0, info: 0 },
	};

	const recompute = (): void => {
		const entries = state.response?.entries ?? [];
		const inRange = filterEntries( entries, {
			buckets: new Set(),
			query: state.query,
			sinceTs: sinceTs(),
		} );
		let visible = inRange;
		if ( state.activeBuckets.size > 0 ) {
			visible = filterEntries( inRange, {
				buckets: state.activeBuckets,
				query: '',
				sinceTs: null,
			} );
		}
		view = { inRange, visible, totals: countBuckets( inRange ) };
	};

	const paintNotice = (): void => {
		notice.hidden = state.error === '';
		notice.textContent = state.error;
	};

	const paintStats = (): void => {
		stats.textContent = '';

		const totalTile = el( 'div', 'os-cb-tile' );
		totalTile.append(
			el( 'span', 'os-cb-tile__label', __( 'Events' ) ),
			el(
				'span',
				'os-cb-tile__value',
				view.inRange.length.toLocaleString(),
			),
		);
		stats.appendChild( totalTile );

		for ( const bucket of BUCKET_ORDER ) {
			const tile = el( 'div', `os-cb-tile os-cb-tile--${ bucket }` );
			const label = el( 'span', 'os-cb-tile__label' );
			label.append(
				el( 'span', `os-cb-swatch os-cb-swatch--${ bucket }` ),
				document.createTextNode( labels[ bucket ] ),
			);
			tile.append(
				label,
				el(
					'span',
					'os-cb-tile__value',
					view.totals[ bucket ].toLocaleString(),
				),
			);
			stats.appendChild( tile );
		}
	};

	const paintEnv = (): void => {
		envRowEl.textContent = '';
		for ( const row of state.environment ) {
			const badge = document.createElement( 'os-badge' );
			let tone = 'info';
			if ( row.on !== null ) {
				tone = row.on ? 'success' : 'neutral';
			}
			badge.setAttribute( 'tone', tone );
			badge.textContent = `${ row.label }: ${ row.value }`;
			envRowEl.appendChild( badge );
		}
	};

	const paintLegend = (): void => {
		legend.textContent = '';
		for ( const bucket of BUCKET_ORDER ) {
			const chip = el( 'button', 'os-cb__legend-chip' );
			chip.type = 'button';
			const active =
				state.activeBuckets.size === 0 ||
				state.activeBuckets.has( bucket );
			chip.setAttribute( 'aria-pressed', active ? 'true' : 'false' );
			chip.append(
				el( 'span', `os-cb-swatch os-cb-swatch--${ bucket }` ),
				el( 'span', 'os-cb__legend-label', labels[ bucket ] ),
				el(
					'span',
					'os-cb__legend-count',
					view.totals[ bucket ].toLocaleString(),
				),
			);
			chip.addEventListener( 'click', () => {
				if ( state.activeBuckets.size === 0 ) {
					// Everything visible → isolate the clicked bucket.
					state.activeBuckets = new Set( [ bucket ] );
				} else if ( state.activeBuckets.has( bucket ) ) {
					state.activeBuckets.delete( bucket );
					// Toggling the last one off = back to everything.
				} else {
					state.activeBuckets.add( bucket );
					if ( state.activeBuckets.size === BUCKET_ORDER.length ) {
						state.activeBuckets = new Set();
					}
				}
				repaint();
			} );
			legend.appendChild( chip );
		}
	};

	const paintChart = (): void => {
		const width = chartHost.clientWidth || 640;
		const bucketCount = Math.max( 24, Math.min( 60, Math.floor( width / 16 ) ) );
		const data = bucketize( view.visible, sinceTs(), nowTs(), bucketCount );
		if ( ! data ) {
			chartHost.textContent = '';
			chartHost.appendChild(
				el(
					'div',
					'os-cb__chart-empty',
					__( 'No events in this range.' ),
				),
			);
			return;
		}
		renderHistogram( chartHost, data, chartOptions() );
	};

	const paintList = (): void => {
		const groups = sortGroups( groupEntries( view.visible ), state.sort );

		issuesTitle.textContent = sprintf(
			/* translators: %s: number of grouped issues. */
			_n( 'Issues (%s)', 'Issues (%s)', groups.length ),
			groups.length.toLocaleString(),
		);

		list.textContent = '';
		if ( groups.length === 0 ) {
			const empty = document.createElement( 'os-empty-state' );
			empty.setAttribute(
				'heading',
				state.query !== '' || state.activeBuckets.size > 0
					? __( 'Nothing matches the filters' )
					: __( 'The log is clean' ),
			);
			empty.setAttribute(
				'description',
				state.query !== '' || state.activeBuckets.size > 0
					? __( 'Try widening the time range or clearing the search.' )
					: __( 'No entries were recorded in this time range.' ),
			);
			const holder = el( 'li', 'os-cb__list-empty' );
			holder.appendChild( empty );
			list.appendChild( holder );
			return;
		}

		for ( const group of groups ) {
			list.appendChild( renderIssueRow( group ) );
		}
	};

	const renderIssueRow = ( group: IssueGroup ): HTMLLIElement => {
		const item = el( 'li', `os-cb-issue os-cb-issue--${ group.bucket }` );
		const expanded = state.expanded.has( group.signature );

		const row = el( 'button', 'os-cb-issue__row' );
		row.type = 'button';
		row.setAttribute( 'aria-expanded', expanded ? 'true' : 'false' );

		const level = el( 'span', 'os-cb-issue__level' );
		level.append(
			el( 'span', `os-cb-swatch os-cb-swatch--${ group.bucket }` ),
			el( 'span', 'os-cb-issue__label', group.label ),
		);

		const message = el( 'span', 'os-cb-issue__message', group.message );
		message.title = group.message;

		const meta = el( 'span', 'os-cb-issue__meta' );
		if ( group.file !== '' ) {
			meta.appendChild(
				el(
					'span',
					'os-cb-issue__file',
					group.line > 0
						? `${ fileBase( group.file ) }:${ group.line }`
						: fileBase( group.file ),
				),
			);
		}
		meta.appendChild(
			el( 'span', 'os-cb-issue__count', `×${ group.count.toLocaleString() }` ),
		);
		if ( group.lastTs !== null ) {
			const when = document.createElement( 'os-relative-time' );
			when.setAttribute(
				'datetime',
				new Date( group.lastTs * 1000 ).toISOString(),
			);
			when.setAttribute( 'compact', '' );
			when.classList.add( 'os-cb-issue__when' );
			meta.appendChild( when );
		}

		row.append( level, message, meta );
		// Toggle the detail panel in place — a full paintList() here
		// would re-filter, re-group, re-sort, and rebuild hundreds of
		// rows just to open one stack trace.
		row.addEventListener( 'click', () => {
			if ( state.expanded.has( group.signature ) ) {
				state.expanded.delete( group.signature );
				row.setAttribute( 'aria-expanded', 'false' );
				item.querySelector( '.os-cb-issue__detail' )?.remove();
			} else {
				state.expanded.add( group.signature );
				row.setAttribute( 'aria-expanded', 'true' );
				item.appendChild( renderIssueDetail( group ) );
			}
		} );
		item.appendChild( row );

		if ( expanded ) {
			item.appendChild( renderIssueDetail( group ) );
		}
		return item;
	};

	const renderIssueDetail = ( group: IssueGroup ): HTMLElement => {
		const detail = el( 'div', 'os-cb-issue__detail' );

		const facts = el( 'dl', 'os-cb-issue__facts' );
		const fact = ( term: string, value: string ): void => {
			facts.append(
				el( 'dt', undefined, term ),
				el( 'dd', undefined, value ),
			);
		};
		if ( group.file !== '' ) {
			fact(
				__( 'File' ),
				group.line > 0 ? `${ group.file }:${ group.line }` : group.file,
			);
		}
		if ( group.firstTs !== null ) {
			fact( __( 'First seen' ), formatFull( group.firstTs ) );
		}
		if ( group.lastTs !== null ) {
			fact( __( 'Last seen' ), formatFull( group.lastTs ) );
		}
		fact( __( 'Occurrences' ), group.count.toLocaleString() );
		detail.appendChild( facts );

		if ( group.occurrences.length > 1 ) {
			const times = el( 'div', 'os-cb-issue__times' );
			times.appendChild(
				el(
					'span',
					'os-cb-issue__times-label',
					__( 'Latest occurrences' ),
				),
			);
			for ( const ts of group.occurrences.slice( 0, 8 ) ) {
				times.appendChild(
					el( 'span', 'os-cb-issue__time', formatFull( ts ) ),
				);
			}
			detail.appendChild( times );
		}

		if ( group.trace !== '' ) {
			const trace = el( 'pre', 'os-cb-issue__trace' );
			trace.textContent = group.trace;
			detail.appendChild( trace );
		}
		return detail;
	};

	const paintFooter = (): void => {
		footer.textContent = '';
		const response = state.response;
		if ( ! response ) {
			return;
		}
		const parts: string[] = [];
		parts.push(
			sprintf(
				/* translators: 1: bytes scanned, 2: total file size. */
				__( 'Scanned %1$s of %2$s' ),
				formatBytes( response.scanned_bytes ),
				formatBytes( response.source.size ),
			),
		);
		parts.push(
			sprintf(
				/* translators: %s: number of parsed log entries. */
				_n( '%s entry', '%s entries', response.entries.length ),
				response.entries.length.toLocaleString(),
			),
		);
		if ( response.truncated ) {
			parts.push( __( 'older entries not shown' ) );
		}
		footer.appendChild(
			el( 'span', 'os-cb__footer-text', parts.join( ' · ' ) ),
		);

		const updated = el( 'span', 'os-cb__footer-updated' );
		updated.append( document.createTextNode( `${ __( 'Updated' ) } ` ) );
		const when = document.createElement( 'os-relative-time' );
		when.setAttribute(
			'datetime',
			new Date( response.generated_at * 1000 ).toISOString(),
		);
		updated.appendChild( when );
		footer.appendChild( updated );
	};

	const repaint = (): void => {
		recompute();
		paintNotice();
		paintStats();
		paintLegend();
		paintChart();
		paintList();
		paintFooter();
	};

	// ---------------------------------------------------------- data
	const currentSource = (): LogSource | undefined =>
		state.sources.find( ( source ) => source.id === state.sourceId );

	// Monotonic request counter: a stale in-flight response (slow
	// source A racing a switch to source B, or overlapping with the
	// auto-refresh tick) must never overwrite a newer one.
	let loadSeq = 0;

	const loadEntries = async (): Promise< void > => {
		if ( state.sourceId === '' ) {
			return;
		}
		const seq = ++loadSeq;
		refreshBtn.setAttribute( 'busy', '' );
		try {
			const response = await fetchEntries( cfg, state.sourceId );
			if ( disposed || seq !== loadSeq ) {
				return;
			}
			state.response = response;
			state.error = '';
			// The response carries a fresh descriptor — sync it into
			// the picker so sizes and flags don't go stale.
			const index = state.sources.findIndex(
				( source ) => source.id === response.source.id,
			);
			if ( index !== -1 ) {
				state.sources[ index ] = response.source;
				paintSourceOptions();
			}
		} catch ( err ) {
			if ( disposed || seq !== loadSeq ) {
				return;
			}
			state.response = null;
			state.error = sprintf(
				/* translators: %s: error message. */
				__( 'Could not read the log: %s' ),
				err instanceof Error ? err.message : String( err ),
			);
		}
		refreshBtn.removeAttribute( 'busy' );
		const source = currentSource();
		if ( source && source.exists && ! source.writable ) {
			clearBtn.setAttribute( 'disabled', '' );
		} else {
			clearBtn.removeAttribute( 'disabled' );
		}
		repaint();
	};

	const paintSourceOptions = (): void => {
		sourceSelect.textContent = '';
		for ( const source of state.sources ) {
			const option = document.createElement( 'os-option' );
			option.setAttribute( 'value', source.id );
			// A missing file is an EMPTY log (selectable, served as
			// zero entries); only exists-but-unreadable is dead.
			if ( source.exists && ! source.readable ) {
				option.setAttribute( 'disabled', '' );
			}
			option.textContent = source.exists
				? `${ source.label } (${ formatBytes( source.size ) })`
				: sprintf(
					/* translators: %s: log source label. */
					__( '%s (empty)' ),
					source.label,
				);
			sourceSelect.appendChild( option );
		}
		sourceSelect.setAttribute( 'value', state.sourceId );
	};

	// -------------------------------------------------------- events
	sourceSelect.addEventListener( 'os-pick', ( event ) => {
		const value = ( event as CustomEvent< { value: string } > ).detail.value;
		if ( value !== state.sourceId ) {
			state.sourceId = value;
			state.expanded.clear();
			void loadEntries();
		}
	} );
	rangeSeg.addEventListener( 'os-pick', ( event ) => {
		state.range = ( event as CustomEvent< { value: string } > ).detail
			.value as RangeKey;
		repaint();
	} );
	sortSeg.addEventListener( 'os-pick', ( event ) => {
		state.sort = ( event as CustomEvent< { value: string } > ).detail
			.value as SortMode;
		paintList();
	} );

	let searchDebounce: number | null = null;
	search.addEventListener( 'os-input-change', ( event ) => {
		const value = ( event as CustomEvent< { value: string } > ).detail.value;
		if ( searchDebounce !== null ) {
			window.clearTimeout( searchDebounce );
		}
		searchDebounce = window.setTimeout( () => {
			searchDebounce = null;
			state.query = value;
			repaint();
		}, 200 );
	} );

	refreshBtn.addEventListener( 'click', () => {
		void loadEntries();
	} );

	autoSwitch.addEventListener( 'os-switch-change', ( event ) => {
		const checked = ( event as CustomEvent< { checked: boolean } > ).detail
			.checked;
		if ( autoTimer !== null ) {
			window.clearInterval( autoTimer );
			autoTimer = null;
		}
		if ( checked ) {
			autoTimer = window.setInterval( () => {
				if ( ! document.hidden ) {
					void loadEntries();
				}
			}, AUTO_REFRESH_MS );
		}
	} );

	clearBtn.addEventListener( 'click', () => {
		const source = currentSource();
		if ( ! source ) {
			return;
		}
		void ( async () => {
			const ok = await osConfirmGlobal( {
				title: __( 'Clear this log?' ),
				message: sprintf(
					/* translators: %s: log file path. */
					__(
						'Every entry in %s will be deleted from disk. This cannot be undone.',
					),
					source.path,
				),
				confirmLabel: __( 'Clear log' ),
				danger: true,
			} );
			if ( ! ok || disposed ) {
				return;
			}
			let clearError = '';
			try {
				await clearSource( cfg, state.sourceId );
			} catch ( err ) {
				clearError = sprintf(
					/* translators: %s: error message. */
					__( 'Could not clear the log: %s' ),
					err instanceof Error ? err.message : String( err ),
				);
			}
			state.expanded.clear();
			// Refresh the picker too — the cleared file's size and
			// writable flag changed on disk.
			try {
				const refreshed = await fetchSources( cfg );
				if ( ! disposed ) {
					state.sources = refreshed.sources;
					state.environment = refreshed.environment;
					paintSourceOptions();
					paintEnv();
				}
			} catch {
				// Non-fatal — the entries reload below still runs.
			}
			await loadEntries();
			// Re-assert the clear failure AFTER the reload: its
			// success path wipes state.error, which used to swallow
			// this message entirely.
			if ( clearError !== '' && ! disposed ) {
				state.error = clearError;
				paintNotice();
			}
		} )();
	} );

	// Re-render the chart when the window is resized.
	let resizeRaf: number | null = null;
	const resizeObserver = new ResizeObserver( () => {
		if ( resizeRaf !== null ) {
			return;
		}
		resizeRaf = window.requestAnimationFrame( () => {
			resizeRaf = null;
			if ( ! disposed && state.response ) {
				paintChart();
			}
		} );
	} );
	resizeObserver.observe( chartHost );

	// ---------------------------------------------------------- boot
	try {
		const sourcesResponse = await fetchSources( cfg );
		state.sources = sourcesResponse.sources;
		state.environment = sourcesResponse.environment;
	} catch ( err ) {
		state.error = sprintf(
			/* translators: %s: error message. */
			__( 'Could not load log sources: %s' ),
			err instanceof Error ? err.message : String( err ),
		);
	}

	paintEnv();

	// A source whose file doesn't exist yet is usable (an empty
	// log) — only exists-but-unreadable is not.
	const firstUsable = state.sources.find(
		( source ) => source.readable || ! source.exists,
	);
	if ( firstUsable ) {
		state.sourceId = firstUsable.id;
		paintSourceOptions();
		await loadEntries();
	} else {
		// No logs to read — explain how to get one, keep the
		// environment card visible (it says exactly which debug
		// constants are off).
		paintSourceOptions();
		const empty = document.createElement( 'os-empty-state' );
		empty.setAttribute( 'heading', __( 'No readable log files found' ) );
		empty.setAttribute(
			'description',
			__(
				'Define WP_DEBUG and WP_DEBUG_LOG in wp-config.php (or point the error_log PHP directive at a file) and errors will start collecting here.',
			),
		);
		const holder = el( 'li', 'os-cb__list-empty' );
		holder.appendChild( empty );
		list.appendChild( holder );
		paintNotice();
	}

	return () => {
		disposed = true;
		if ( autoTimer !== null ) {
			window.clearInterval( autoTimer );
		}
		if ( searchDebounce !== null ) {
			window.clearTimeout( searchDebounce );
		}
		if ( resizeRaf !== null ) {
			window.cancelAnimationFrame( resizeRaf );
		}
		resizeObserver.disconnect();
	};
}

const registry =
	( window.openStationNativeWindows ??
		( window.openStationNativeWindows = {} ) ) as Record<
		string,
		RenderCallback | undefined
	>;
// Return the render Promise so the framework keeps its loading
// overlay up until the first fetch has painted, and forward the
// teardown so close-time cleanup (timers, observers) actually fires.
registry[ WINDOW_ID ] = async ( body: HTMLElement ) => {
	return renderCodeBlue( body );
};
