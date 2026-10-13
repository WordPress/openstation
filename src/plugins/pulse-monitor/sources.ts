/**
 * Pulse Monitor — signal sources.
 *
 * Every beat on the trace comes from one source. The catalog below is
 * what the settings dialog lists under "Listening to", what the
 * scheduler uses to pick a beat's shape and height, and the vocabulary
 * the server feed (`includes/pulse-monitor.php`) speaks for the
 * site-wide kinds.
 */

import { __ } from '../../i18n';

/**
 * Beat morphologies the rhythm engine can draw.
 *
 *   - `qrs`     a full P-QRS-T complex: a request, a visitor, a page.
 *   - `double`  two R spikes ("lub-dub"): a WordPress Heartbeat tick.
 *   - `flutter` a short, half-height spike: a window event, a toast.
 *   - `blip`    a tiny tick on the baseline: a click, an asset, a message.
 *   - `pvc`     a wide inverted ectopic beat: anything that failed.
 */
export type BeatShape = 'qrs' | 'double' | 'flutter' | 'blip' | 'pvc';

export type SourceGroup = 'client' | 'server';

export interface SourceDef {
	id: string;
	group: SourceGroup;
	label: string;
	shape: BeatShape;
	/** Height relative to a full R wave. */
	amplitude: number;
}

/** Every known source id. */
export const SOURCE_IDS = [
	'requests',
	'pages',
	'heartbeat',
	'assets',
	'windows',
	'input',
	'messages',
	'notices',
	'uploads',
	'errors',
	'visitors',
	'bots',
	'comments',
	'publish',
	'orders',
	'logins',
	'api',
	'cron',
	'team',
] as const;

export type SourceId = ( typeof SOURCE_IDS )[ number ];

/** Shape + height for a source, without the translated label. */
const SHAPES: Record< string, { shape: BeatShape; amplitude: number } > = {
	requests: { shape: 'qrs', amplitude: 0.85 },
	pages: { shape: 'qrs', amplitude: 1 },
	heartbeat: { shape: 'double', amplitude: 0.9 },
	assets: { shape: 'blip', amplitude: 0.14 },
	windows: { shape: 'flutter', amplitude: 0.42 },
	input: { shape: 'blip', amplitude: 0.1 },
	messages: { shape: 'blip', amplitude: 0.12 },
	notices: { shape: 'flutter', amplitude: 0.55 },
	uploads: { shape: 'qrs', amplitude: 0.9 },
	errors: { shape: 'pvc', amplitude: 0.9 },
	visitors: { shape: 'qrs', amplitude: 1 },
	bots: { shape: 'flutter', amplitude: 0.5 },
	comments: { shape: 'qrs', amplitude: 1.25 },
	publish: { shape: 'qrs', amplitude: 1.3 },
	orders: { shape: 'qrs', amplitude: 1.3 },
	logins: { shape: 'qrs', amplitude: 1.1 },
	api: { shape: 'flutter', amplitude: 0.6 },
	cron: { shape: 'flutter', amplitude: 0.5 },
	team: { shape: 'qrs', amplitude: 0.7 },
};

/** Server-fed sources — everything else is observed in the shell. */
const SERVER_SOURCES: ReadonlySet< string > = new Set( [
	'visitors',
	'bots',
	'comments',
	'publish',
	'orders',
	'logins',
	'api',
	'cron',
	'team',
] );

/** Settings-dialog labels. A function so `__()` runs after i18n boots. */
function sourceLabels(): Record< SourceId, string > {
	return {
		requests: __( 'API requests (fetch, XHR, REST, admin-ajax)' ),
		pages: __( 'Page loads in windows' ),
		heartbeat: __( 'WordPress Heartbeat' ),
		assets: __( 'Scripts, styles, images and fonts' ),
		windows: __( 'Window and desktop events' ),
		input: __( 'Clicks, typing and scrolling' ),
		messages: __( 'Messages between windows' ),
		notices: __( 'Notifications and toasts' ),
		uploads: __( 'Uploads' ),
		errors: __( 'Errors (failed requests, JavaScript errors)' ),
		visitors: __( 'Visitors' ),
		bots: __( 'Bots and crawlers' ),
		comments: __( 'Comments' ),
		publish: __( 'Published posts' ),
		orders: __( 'Orders' ),
		logins: __( 'Logins' ),
		api: __( 'API and app requests' ),
		cron: __( 'Cron runs' ),
		team: __( 'Other people working in the admin' ),
	};
}

/**
 * The word printed on a spike — short, lowercase, what a person would
 * say happened. Unknown ids (plugin kinds) print as themselves.
 */
export function spikeLabel( source: string ): string {
	const labels: Record< string, string > = {
		requests: __( 'request' ),
		pages: __( 'page load' ),
		heartbeat: __( 'heartbeat' ),
		windows: __( 'window' ),
		notices: __( 'notice' ),
		uploads: __( 'upload' ),
		errors: __( 'error' ),
		visitors: __( 'visit' ),
		bots: __( 'bot' ),
		comments: __( 'comment' ),
		publish: __( 'published' ),
		orders: __( 'order' ),
		logins: __( 'login' ),
		api: __( 'API' ),
		cron: __( 'cron' ),
		team: __( 'teammate' ),
	};
	return labels[ source ] ?? source.replace( /[-_]+/g, ' ' );
}

/** The catalog, in the order the settings dialog lists it. */
export function sourceCatalog(): SourceDef[] {
	const labels = sourceLabels();
	return SOURCE_IDS.map( ( id ) => ( {
		id,
		group: SERVER_SOURCES.has( id ) ? 'server' : 'client',
		label: labels[ id ],
		...SHAPES[ id ],
	} ) );
}

/**
 * Shape + height for any source id. Unknown ids (a plugin's custom
 * server kind, a `pulse/beat` publish) get a standard beat.
 */
export function shapeFor( source: string ): { shape: BeatShape; amplitude: number } {
	return SHAPES[ source ] ?? { shape: 'qrs', amplitude: 0.9 };
}
