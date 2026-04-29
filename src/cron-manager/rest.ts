/**
 * Cron Manager - REST glue.
 *
 * @since 0.22.0
 */

declare global {
	interface Window {
		wpDesktopCronManagerConfig?: {
			restNonce: string;
			eventsUrl: string;
			schedulesUrl: string;
			runNowUrl: string;
		};
	}
}

export interface CronEventIdentity {
	timestamp: number;
	hook: string;
	argsHash: string;
}

export interface CronEvent extends Record< string, unknown > {
	id: string;
	identity: CronEventIdentity;
	timestamp: number;
	nextRunGmt: string;
	nextRunLocal: string;
	hook: string;
	schedule: string;
	scheduleDisplay: string;
	interval: number;
	recurring: boolean;
	due: boolean;
	overdue: boolean;
	callbackCount: number;
	args: unknown[];
	argsJson: string;
	argsEditable: boolean;
	argsSummary: string;
}

export interface CronSchedule {
	slug: string;
	interval: number;
	display: string;
	custom: boolean;
}

export interface CronEventPayload {
	hook: string;
	timestamp: number;
	schedule: string;
	args?: unknown[] | Record< string, unknown >;
	customSchedule?: {
		slug: string;
		interval: number;
		display: string;
	};
}

export interface EventsResponse {
	events: CronEvent[];
}

export interface SchedulesResponse {
	schedules: CronSchedule[];
}

function config(): NonNullable< Window[ 'wpDesktopCronManagerConfig' ] > {
	const cfg = window.wpDesktopCronManagerConfig;
	if ( ! cfg ) {
		throw new Error(
			'wpDesktopCronManagerConfig is missing - the cron-manager bundle was loaded outside of desktop mode.',
		);
	}
	return cfg;
}

async function request< T >( url: string, init: RequestInit = {} ): Promise< T > {
	const cfg = config();
	const response = await fetch( url, {
		...init,
		credentials: 'same-origin',
		headers: {
			'X-WP-Nonce': cfg.restNonce,
			Accept: 'application/json',
			...( init.body ? { 'Content-Type': 'application/json' } : {} ),
			...( init.headers ?? {} ),
		},
	} );

	if ( ! response.ok ) {
		let message = `${ response.status } ${ response.statusText }`;
		try {
			const json = ( await response.json() ) as { message?: string };
			if ( json && typeof json.message === 'string' ) {
				message = json.message;
			}
		} catch {
			// Keep the status-line fallback.
		}
		throw new Error( message );
	}

	return ( await response.json() ) as T;
}

export function fetchEvents(): Promise< EventsResponse > {
	return request< EventsResponse >( config().eventsUrl, { method: 'GET' } );
}

export function fetchSchedules(): Promise< SchedulesResponse > {
	return request< SchedulesResponse >( config().schedulesUrl, { method: 'GET' } );
}

export function createEvent(
	event: CronEventPayload,
): Promise< EventsResponse > {
	return request< EventsResponse >( config().eventsUrl, {
		method: 'POST',
		body: JSON.stringify( event ),
	} );
}

export function updateEvent(
	identity: CronEventIdentity,
	event: CronEventPayload,
): Promise< EventsResponse > {
	return request< EventsResponse >( config().eventsUrl, {
		method: 'PUT',
		body: JSON.stringify( { identity, event } ),
	} );
}

export function deleteEvent(
	identity: CronEventIdentity,
): Promise< EventsResponse > {
	return request< EventsResponse >( config().eventsUrl, {
		method: 'DELETE',
		body: JSON.stringify( { identity } ),
	} );
}

export function runEventNow(
	identity: CronEventIdentity,
): Promise< EventsResponse > {
	return request< EventsResponse >( config().runNowUrl, {
		method: 'POST',
		body: JSON.stringify( { identity } ),
	} );
}
