import { applyFilters, HOOKS } from '../hooks';
import { DRAG_EVENTS, type DragPayload } from './types';
import {
	DRAG_BRIDGE_EVENTS,
	type DragBridgePayload,
} from '../drag-bridge';
import { findWindowRootAtPoint, windowIdFromRoot } from './window-at-point';

export const FOCUS_ON_DRAG_HOVER_DWELL_MS = 250;

export const FOCUS_ON_DRAG_HOVER_WATCHDOG_MS = 1000;

export const DRAG_HOVER_MESSAGE_TYPE = 'os-drag-hover';

export interface FocusableWindow {
	isFocused(): boolean;
}

export interface WindowFocusHost< W extends FocusableWindow = FocusableWindow > {
	getById( id: string ): W | undefined;

	focus( win: W | string ): void;
}

let _installed = false;
let _host: WindowFocusHost | null = null;
let _lastHoverWindowId: string | null = null;
let _dwellTimer: ReturnType< typeof setTimeout > | null = null;
let _watchdogTimer: ReturnType< typeof setTimeout > | null = null;

let _bridgePayloadKind: string | null = null;

function clearDwell(): void {
	if ( _dwellTimer !== null ) {
		clearTimeout( _dwellTimer );
		_dwellTimer = null;
	}
}

function clearWatchdog(): void {
	if ( _watchdogTimer !== null ) {
		clearTimeout( _watchdogTimer );
		_watchdogTimer = null;
	}
}

function resetHoverState(): void {
	clearDwell();
	clearWatchdog();
	_lastHoverWindowId = null;
}

function bumpWatchdog(): void {
	clearWatchdog();
	_watchdogTimer = setTimeout( () => {
		_watchdogTimer = null;
		resetHoverState();
	}, FOCUS_ON_DRAG_HOVER_WATCHDOG_MS );
}

function fireFocus( windowId: string, payloadType: string ): void {
	const win = _host?.getById( windowId );
	if ( ! win || win.isFocused() ) {
		return;
	}
	const shouldFocus = applyFilters<
		boolean,
		[ { windowId: string; payloadType: string } ]
	>(
		HOOKS.WINDOW_FOCUS_ON_DRAG_HOVER,
		true,
		{ windowId, payloadType },
	);
	if ( ! shouldFocus ) {
		return;
	}
	try {
		_host?.focus( win );
	} catch ( err ) {
		console.error( '[openstation] focus-on-drag-hover focus() threw:', windowId, err );
	}
}

function trackHoverWindowId( windowId: string | null, payloadType: string ): void {
	if ( windowId === _lastHoverWindowId ) {
		return;
	}
	clearDwell();
	_lastHoverWindowId = windowId;
	if ( windowId === null ) {
		return;
	}
	_dwellTimer = setTimeout( () => {
		_dwellTimer = null;
		fireFocus( windowId, payloadType );
	}, FOCUS_ON_DRAG_HOVER_DWELL_MS );
}

function trackHoverAtPoint( clientX: number, clientY: number, payloadType: string ): void {
	const root = findWindowRootAtPoint( clientX, clientY );
	trackHoverWindowId( root ? windowIdFromRoot( root ) : null, payloadType );
}

const onDragMove = ( e: Event ): void => {
	const detail = ( e as CustomEvent ).detail as
		| { payload?: DragPayload; clientX?: number; clientY?: number }
		| undefined;
	if (
		typeof detail?.clientX !== 'number' ||
		typeof detail?.clientY !== 'number'
	) {
		return;
	}
	trackHoverAtPoint( detail.clientX, detail.clientY, detail.payload?.type ?? '' );
};

const onDragEnd = (): void => {
	resetHoverState();
};

function dragHasFiles( e: DragEvent ): boolean {
	const types = e.dataTransfer?.types;
	if ( ! types ) {
		return false;
	}

	const list = types as unknown as {
		includes?: ( s: string ) => boolean;
		contains?: ( s: string ) => boolean;
	};
	if ( typeof list.includes === 'function' ) {
		return list.includes( 'Files' );
	}
	return typeof list.contains === 'function' && list.contains( 'Files' );
}

const onNativeDragOver = ( e: DragEvent ): void => {
	bumpWatchdog();
	const payloadType =
		_bridgePayloadKind ?? ( dragHasFiles( e ) ? 'os-file' : 'external' );
	trackHoverAtPoint( e.clientX, e.clientY, payloadType );
};

const onNativeDragSettled = (): void => {
	resetHoverState();
};

const onNativeDragLeave = ( e: DragEvent ): void => {
	if ( e.relatedTarget === null ) {
		resetHoverState();
	}
};

function windowIdFromMessageSource(
	source: MessageEventSource | null,
): string | null {
	if ( ! source ) {
		return null;
	}
	const iframes = document.querySelectorAll< HTMLIFrameElement >( 'iframe' );
	for ( const f of Array.from( iframes ) ) {
		if ( f.contentWindow === source ) {
			const host = f.closest( '[data-window-id]' );
			return host?.getAttribute( 'data-window-id' ) || null;
		}
	}
	return null;
}

const onHoverMessage = ( e: MessageEvent ): void => {
	if ( e.origin !== window.location.origin ) {
		return;
	}
	const data = e.data as { type?: unknown; payloadType?: unknown } | null;
	if ( ! data || data.type !== DRAG_HOVER_MESSAGE_TYPE ) {
		return;
	}
	const windowId = windowIdFromMessageSource( e.source );
	if ( ! windowId ) {
		return;
	}
	bumpWatchdog();
	trackHoverWindowId(
		windowId,
		typeof data.payloadType === 'string' ? data.payloadType : 'external',
	);
};

const onBridgeStart = ( e: Event ): void => {
	const detail = ( e as CustomEvent ).detail as
		| { payload?: DragBridgePayload }
		| undefined;
	if ( detail?.payload ) {
		_bridgePayloadKind = detail.payload.kind ?? '';
	}
};

const onBridgeEnd = (): void => {
	_bridgePayloadKind = null;
	resetHoverState();
};

export function installFocusWindowOnDragHover( host: WindowFocusHost ): void {
	if ( _installed ) {
		return;
	}
	_installed = true;
	_host = host;

	document.addEventListener( DRAG_EVENTS.MOVE, onDragMove );
	document.addEventListener( DRAG_EVENTS.END, onDragEnd );
	document.addEventListener( DRAG_BRIDGE_EVENTS.START, onBridgeStart );
	document.addEventListener( DRAG_BRIDGE_EVENTS.END, onBridgeEnd );

	document.addEventListener( 'dragover', onNativeDragOver, true );
	document.addEventListener( 'drop', onNativeDragSettled, true );
	document.addEventListener( 'dragend', onNativeDragSettled, true );
	document.addEventListener( 'dragleave', onNativeDragLeave, true );

	window.addEventListener( 'message', onHoverMessage );
}

export function __resetFocusWindowOnDragHoverForTests(): void {
	resetHoverState();
	_bridgePayloadKind = null;
	document.removeEventListener( DRAG_EVENTS.MOVE, onDragMove );
	document.removeEventListener( DRAG_EVENTS.END, onDragEnd );
	document.removeEventListener( DRAG_BRIDGE_EVENTS.START, onBridgeStart );
	document.removeEventListener( DRAG_BRIDGE_EVENTS.END, onBridgeEnd );
	document.removeEventListener( 'dragover', onNativeDragOver, true );
	document.removeEventListener( 'drop', onNativeDragSettled, true );
	document.removeEventListener( 'dragend', onNativeDragSettled, true );
	document.removeEventListener( 'dragleave', onNativeDragLeave, true );
	window.removeEventListener( 'message', onHoverMessage );
	_installed = false;
	_host = null;
}
