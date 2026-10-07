import { activity } from './activity';
import { applyFilters, doAction, HOOKS } from './hooks';
import type { WindowManager } from './window-manager';

const EVENT_NAME = 'os-broadcast';
const POSTMESSAGE_TYPE = 'os-broadcast';
const ORIGIN = window.location.origin;

export interface BroadcastDetail< T = unknown > {
	topic: string;
	payload: T;
}

export type BroadcastSubscriber< T = unknown > = (
	payload: T,
	meta: { topic: string },
) => void;

export type BroadcastUnsubscribe = () => void;

let _manager: WindowManager | null = null;

export function attachBroadcastBus( manager: WindowManager ): void {
	_manager = manager;
}

export function broadcast< T = unknown >( topic: string, payload: T ): void {
	const filteredTopic = String(
		applyFilters( 'os.broadcast.topic', topic, { payload } ) ?? topic,
	);
	const filteredPayload = applyFilters(
		'os.broadcast.payload',
		payload,
		{ topic: filteredTopic },
	) as T;

	const detail: BroadcastDetail< T > = {
		topic: filteredTopic,
		payload: filteredPayload,
	};

	document.dispatchEvent( new CustomEvent( EVENT_NAME, { detail } ) );
	doAction( HOOKS.BROADCAST, detail );

	activity.publish(
		filteredTopic as `${ string }/${ string }`,
		filteredPayload,
	);

	if ( ! _manager ) {
		return;
	}
	const message = {
		type: POSTMESSAGE_TYPE,
		topic: filteredTopic,
		payload: filteredPayload,
	};
	for ( const win of _manager._stack ) {
		const target = win.iframe?.contentWindow;
		if ( ! target ) {
			continue;
		}
		try {
			target.postMessage( message, ORIGIN );
		} catch ( err ) {
			void err;
		}
	}
}

export function subscribe< T = unknown >(
	topic: string,
	cb: BroadcastSubscriber< T >,
): BroadcastUnsubscribe {
	const handler = ( e: Event ): void => {
		const detail = ( e as CustomEvent< BroadcastDetail< T > > ).detail;
		if ( ! detail ) {
			return;
		}
		if ( topic !== '*' && detail.topic !== topic ) {
			return;
		}
		try {
			cb( detail.payload, { topic: detail.topic } );
		} catch ( err ) {
			doAction( HOOKS.SHELL_ERROR, {
				scope: 'broadcast-subscriber',
				topic: detail.topic,
				error: err,
			} );
		}
	};
	document.addEventListener( EVENT_NAME, handler );
	return () => document.removeEventListener( EVENT_NAME, handler );
}

export function installBroadcastReceiver(): void {
	window.addEventListener( 'message', ( e: MessageEvent ) => {
		if ( e.origin !== ORIGIN ) {
			return;
		}
		const data = e.data as
			| {
				type?: string;
				topic?: string;
				payload?: unknown;
				_fromParent?: boolean;
			}
			| null
			| undefined;
		if ( ! data || data.type !== POSTMESSAGE_TYPE ) {
			return;
		}

		if ( data._fromParent ) {
			return;
		}
		if ( typeof data.topic !== 'string' ) {
			return;
		}
		broadcast( data.topic, data.payload );
	} );
}

export type ContentChangeAction =
	| 'created'
	| 'updated'
	| 'trashed'
	| 'untrashed'
	| 'deleted';

export function announceContentChange(
	type: string,
	action: ContentChangeAction,
	ids: number | number[],
	source = '',
): void {
	const list = ( Array.isArray( ids ) ? ids : [ ids ] )
		.map( ( id ) => Math.floor( Number( id ) ) )
		.filter( ( id ) => Number.isFinite( id ) && id > 0 );
	const slug = String( type ).trim();

	if ( '' === slug || 0 === list.length ) {
		return;
	}

	broadcast( `os.${ slug }.changed`, { source, action, ids: list } );
}
