const EVENT_NAME = 'os-recycle-bin-changed';

const HEARTBEAT_FIELD = 'openstation_recycle_bin_seen_ts';
const POSTMESSAGE_TYPE = 'os-recycle-bin-changed';

type DetailKind = 'restore' | 'purge' | 'empty' | 'external';

interface ChangedDetail {
	kind: DetailKind;
	ok: number;
	errors: Array< { id: number; code: string; message: string } >;
	source?: 'chromeless' | 'heartbeat' | 'local';
	ts?: number;
}

interface JQueryStaticLite {
	( selector: Document | Element ): {
		on: ( event: string, handler: ( ...args: unknown[] ) => void ) => void;
		off: ( event: string, handler?: ( ...args: unknown[] ) => void ) => void;
	};
}

declare global {
	interface Window {
		jQuery?: JQueryStaticLite;
	}
}

const state = {
	started: false,
	seenTs: 0,
	postMessageHandler: null as ( ( e: MessageEvent ) => void ) | null,
	heartbeatSendHandler: null as
		| ( ( ...args: unknown[] ) => void )
		| null,
	heartbeatTickHandler: null as
		| ( ( ...args: unknown[] ) => void )
		| null,
};

function dispatchChanged( source: ChangedDetail[ 'source' ], ts?: number ): void {
	const detail: ChangedDetail = {
		kind: 'external',
		ok: 0,
		errors: [],
		source,
		ts,
	};
	document.dispatchEvent( new CustomEvent( EVENT_NAME, { detail } ) );

	const hooks = window.wp?.hooks;
	if ( hooks && typeof hooks.doAction === 'function' ) {
		hooks.doAction( 'openstation.recycleBin.changed', detail );
	}
}

export function start(): void {
	if ( state.started ) {
		return;
	}
	state.started = true;

	state.seenTs = Date.now();

	const expectedOrigin = window.location.origin;
	state.postMessageHandler = ( e: MessageEvent ): void => {
		if ( e.origin !== expectedOrigin ) {
			return;
		}
		const data = e.data as
			| { type?: string; ts?: number }
			| null
			| undefined;
		if ( ! data || data.type !== POSTMESSAGE_TYPE ) {
			return;
		}
		const ts = typeof data.ts === 'number' ? data.ts : Date.now();
		if ( ts <= state.seenTs ) {
			return;
		}
		state.seenTs = ts;
		dispatchChanged( 'chromeless', ts );
	};
	window.addEventListener( 'message', state.postMessageHandler );

	const $ = window.jQuery;
	if ( ! $ ) {
		return;
	}

	state.heartbeatSendHandler = ( ...args: unknown[] ): void => {
		const data = args[ 1 ] as Record< string, unknown > | undefined;
		if ( data ) {
			data[ HEARTBEAT_FIELD ] = state.seenTs;
		}
	};
	$( document ).on( 'heartbeat-send', state.heartbeatSendHandler );

	state.heartbeatTickHandler = ( ...args: unknown[] ): void => {
		const response = args[ 1 ] as
			| { openstation_recycle_bin?: { changed?: boolean; ts?: number } }
			| undefined;
		const block = response?.openstation_recycle_bin;
		if ( ! block ) {
			return;
		}
		const ts = typeof block.ts === 'number' ? block.ts : 0;
		if ( ts > state.seenTs ) {
			state.seenTs = ts;
			if ( block.changed ) {
				dispatchChanged( 'heartbeat', ts );
			}
		}
	};
	$( document ).on( 'heartbeat-tick', state.heartbeatTickHandler );
}

export function stop(): void {
	if ( ! state.started ) {
		return;
	}
	state.started = false;

	if ( state.postMessageHandler ) {
		window.removeEventListener( 'message', state.postMessageHandler );
		state.postMessageHandler = null;
	}

	const $ = window.jQuery;
	if ( $ ) {
		if ( state.heartbeatSendHandler ) {
			$( document ).off( 'heartbeat-send', state.heartbeatSendHandler );
		}
		if ( state.heartbeatTickHandler ) {
			$( document ).off( 'heartbeat-tick', state.heartbeatTickHandler );
		}
	}
	state.heartbeatSendHandler = null;
	state.heartbeatTickHandler = null;
}

export function _seenTs(): number {
	return state.seenTs;
}
