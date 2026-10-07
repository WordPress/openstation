import { addAction, HOOKS } from '../hooks';
import { __ } from '../i18n';
import {
	DRAG_EVENTS,
	type DragManagerApi,
	type DragSession,
} from './types';
import type {
	DesktopFileDragData,
	ShortcutDragData,
} from '../desktop-files/drag-payloads';
import {
	DRAG_BRIDGE_EVENTS,
	bridgePayloadNeedsResolution,
	resolveBridgePayload,
	type DragBridgePayload,
} from '../drag-bridge';
import { findWindowRootAtPoint } from './window-at-point';
import { getWindowContent } from '../window-links/engine';

const TARGET_ID_PREFIX = 'desktop-mode-iframe-drop-';
const IFRAME_SELECTOR = 'iframe.os-window__iframe';
const DROP_ACTIVE_ATTR = 'data-os-iframe-drop-active';

let _installed = false;
let _dragManager: DragManagerApi | null = null;

type DeregisterFn = () => void;

const _suppressedIframes = new Map< HTMLIFrameElement, string >();

const _activeRegistrations = new Map< HTMLIFrameElement, DeregisterFn >();

let _bridgeInterceptPayload: DragBridgePayload | null = null;
let _lastHoveredBridgeIframe: HTMLIFrameElement | null = null;

function suppressIframePointerEventsBridge(): void {
	const iframes = document.querySelectorAll< HTMLIFrameElement >(
		IFRAME_SELECTOR,
	);
	iframes.forEach( ( iframe ) => {
		if ( _suppressedIframes.has( iframe ) ) {
			return;
		}
		_suppressedIframes.set( iframe, iframe.style.pointerEvents );
		iframe.style.pointerEvents = 'none';
	} );
}

function restoreIframePointerEvents(): void {
	_suppressedIframes.forEach( ( prev, iframe ) => {
		iframe.style.pointerEvents = prev;
	} );
	_suppressedIframes.clear();
}

function findIframeAtCursor(
	clientX: number,
	clientY: number,
): HTMLIFrameElement | null {
	const win = findWindowRootAtPoint( clientX, clientY );
	if ( ! win ) {
		return null;
	}
	const iframe = win.querySelector( IFRAME_SELECTOR );
	return iframe instanceof HTMLIFrameElement ? iframe : null;
}

const onBridgeDragOver = ( e: DragEvent ): void => {
	if ( ! _bridgeInterceptPayload ) {
		return;
	}
	e.preventDefault();
	if ( e.dataTransfer ) {
		e.dataTransfer.dropEffect = 'copy';
	}
	const iframe = findIframeAtCursor( e.clientX, e.clientY );
	if ( iframe === _lastHoveredBridgeIframe ) {
		if ( iframe ) {
			postDragMove( iframe, e.clientX, e.clientY );
		}
		return;
	}
	if ( _lastHoveredBridgeIframe ) {
		cancelDragMove();
		postIntoIframe( _lastHoveredBridgeIframe, {
			type: 'os-drag-leave',
		} );
	}
	_lastHoveredBridgeIframe = iframe;
	if ( iframe ) {
		postIntoIframe( iframe, {
			type: 'os-drag-over',
			payload: _bridgeInterceptPayload,
		} );
		postDragMove( iframe, e.clientX, e.clientY );
	}
};

const onBridgeDrop = ( e: DragEvent ): void => {
	if ( ! _bridgeInterceptPayload ) {
		return;
	}
	const iframe = findIframeAtCursor( e.clientX, e.clientY );
	if ( ! iframe ) {
		e.preventDefault();
		stopBridgeIntercept();
		return;
	}
	e.preventDefault();
	e.stopPropagation();
	if ( typeof e.stopImmediatePropagation === 'function' ) {
		e.stopImmediatePropagation();
	}
	const payload = _bridgeInterceptPayload;
	stopBridgeIntercept();
	const rect = iframe.getBoundingClientRect();
	postIntoIframe( iframe, {
		type: 'os-drop',
		payload,
		position: {
			x: e.clientX - rect.left,
			y: e.clientY - rect.top,
		},
	} );
};

const onBridgeDragEnd = (): void => {
	stopBridgeIntercept();
};

function startBridgeIntercept( payload: DragBridgePayload ): void {
	if ( _bridgeInterceptPayload ) {
		_bridgeInterceptPayload = payload;
		return;
	}
	_bridgeInterceptPayload = payload;
	suppressIframePointerEventsBridge();
	document.addEventListener( 'dragover', onBridgeDragOver, true );
	document.addEventListener( 'drop', onBridgeDrop, true );
	document.addEventListener( 'dragend', onBridgeDragEnd, true );
}

function stopBridgeIntercept(): void {
	if ( ! _bridgeInterceptPayload ) {
		return;
	}
	_bridgeInterceptPayload = null;
	cancelDragMove();
	if ( _lastHoveredBridgeIframe ) {
		postIntoIframe( _lastHoveredBridgeIframe, {
			type: 'os-drag-leave',
		} );
		_lastHoveredBridgeIframe = null;
	}
	document.removeEventListener( 'dragover', onBridgeDragOver, true );
	document.removeEventListener( 'drop', onBridgeDrop, true );
	document.removeEventListener( 'dragend', onBridgeDragEnd, true );
	restoreIframePointerEvents();
}

function extractBridgePayload(
	payload: unknown,
): DragBridgePayload | undefined {
	if ( ! payload || typeof payload !== 'object' ) {
		return undefined;
	}
	const obj = payload as { type?: unknown; data?: unknown };
	if ( obj.type !== 'shortcut' && obj.type !== 'desktop-file' ) {
		return undefined;
	}
	const data = obj.data as
		| ShortcutDragData
		| DesktopFileDragData
		| undefined;
	return data?.bridgePayload;
}

let _pointerHoveredIframe: HTMLIFrameElement | null = null;

let _pendingMove: { iframe: HTMLIFrameElement; clientX: number; clientY: number } | null = null;
let _moveFrame = 0;

function postDragMove( iframe: HTMLIFrameElement, clientX: number, clientY: number ): void {
	_pendingMove = { iframe, clientX, clientY };
	if ( _moveFrame ) {
		return;
	}
	_moveFrame = requestAnimationFrame( () => {
		_moveFrame = 0;
		const move = _pendingMove;
		_pendingMove = null;
		if ( ! move || ! move.iframe.isConnected ) {
			return;
		}
		const rect = move.iframe.getBoundingClientRect();
		postIntoIframe( move.iframe, {
			type: 'os-drag-move',
			position: { x: move.clientX - rect.left, y: move.clientY - rect.top },
		} );
	} );
}

function cancelDragMove(): void {
	_pendingMove = null;
	if ( _moveFrame ) {
		cancelAnimationFrame( _moveFrame );
		_moveFrame = 0;
	}
}

function postIntoIframe(
	iframe: HTMLIFrameElement,
	msg: unknown,
): void {
	const w = iframe.contentWindow;
	if ( ! w ) {
		return;
	}
	try {
		w.postMessage( msg, window.location.origin );
	} catch {

	}
}

function editorAcceptLabel( iframe: HTMLIFrameElement, windowId: string ): string | undefined {
	let url: URL;
	try {
		url = new URL( iframe.src );
	} catch {
		return undefined;
	}
	if ( ! /\/post(-new)?\.php$/.test( url.pathname ) ) {
		return undefined;
	}
	const type = getWindowContent( windowId )?.type ?? url.searchParams.get( 'post_type' );
	return type === 'page'
		? __( 'Add to page', 'desktop-mode' )
		: __( 'Add to post', 'desktop-mode' );
}

function registerDropTargetFor(
	dragManager: DragManagerApi,
	iframe: HTMLIFrameElement,
	target: HTMLElement,
	windowId: string,
): () => void {
	return dragManager.registerDropTarget( {
		id: `${ TARGET_ID_PREFIX }${ windowId }`,
		element: target,
		accept: ( payload ) => !! extractBridgePayload( payload ),
		acceptLabel: editorAcceptLabel( iframe, windowId ),
		onEnter: ( session: DragSession ) => {
			const bridge = extractBridgePayload( session.payload );
			if ( ! bridge ) {
				return;
			}
			target.setAttribute( DROP_ACTIVE_ATTR, '' );
			_pointerHoveredIframe = iframe;
			postIntoIframe( iframe, {
				type: 'os-drag-over',
				payload: bridge,
			} );
		},
		onLeave: () => {
			target.removeAttribute( DROP_ACTIVE_ATTR );
			if ( _pointerHoveredIframe === iframe ) {
				_pointerHoveredIframe = null;
			}
			postIntoIframe( iframe, { type: 'os-drag-leave' } );
		},
		onDrop: ( session, ev ) => {
			target.removeAttribute( DROP_ACTIVE_ATTR );
			_pointerHoveredIframe = null;
			const bridge = extractBridgePayload( session.payload );
			if ( ! bridge ) {
				return;
			}
			const rect = iframe.getBoundingClientRect();
			const position = {
				x: ev.clientX - rect.left,
				y: ev.clientY - rect.top,
			};
			if ( ! bridgePayloadNeedsResolution( bridge ) ) {
				postIntoIframe( iframe, { type: 'os-drop', payload: bridge, position } );
				return;
			}
			void deliverResolvedDrop( iframe, bridge, position );
		},
	} );
}

async function deliverResolvedDrop(
	iframe: HTMLIFrameElement,
	bridge: DragBridgePayload,
	position: { x: number; y: number },
): Promise< void > {
	const resolved = await resolveBridgePayload( bridge );
	if ( ! resolved ) {
		postIntoIframe( iframe, { type: 'os-drag-leave' } );
		return;
	}
	postIntoIframe( iframe, { type: 'os-drop', payload: resolved, position } );
}

function deriveWindowIdFromIframe( iframe: HTMLIFrameElement ): string {
	let cur: HTMLElement | null = iframe.parentElement;
	while ( cur ) {
		if ( cur.id.startsWith( 'wp-window-' ) ) {
			return cur.id.slice( 'wp-window-'.length );
		}
		cur = cur.parentElement;
	}

	return `unknown-${ Math.random().toString( 36 ).slice( 2, 10 ) }`;
}

function debugLog(
	iframeCount: number,
	isBridgeable: boolean,
	payload: unknown,
): void {
	try {
		if ( ! window.localStorage?.getItem( 'openStationDragDebug' ) ) {
			return;
		}
	} catch {
		return;
	}

	console.info(
		'[openstation] drag-start: suppressing %d iframe(s); bridgeable=%s',
		iframeCount,
		isBridgeable,
		payload,
	);
}

function onDragStart( payload: unknown ): void {
	const dragManager = _dragManager;
	if ( ! dragManager ) {
		return;
	}

	const iframes = document.querySelectorAll< HTMLIFrameElement >( IFRAME_SELECTOR );
	const isBridgeable = !! extractBridgePayload( payload );
	debugLog( iframes.length, isBridgeable, payload );
	iframes.forEach( ( iframe ) => {
		if ( ! _suppressedIframes.has( iframe ) ) {
			_suppressedIframes.set( iframe, iframe.style.pointerEvents );
			iframe.style.pointerEvents = 'none';
		}

		if ( ! isBridgeable ) {
			return;
		}
		if ( _activeRegistrations.has( iframe ) ) {
			return;
		}
		const dropTargetEl = iframe.parentElement;
		if ( ! dropTargetEl ) {
			return;
		}
		const windowId = deriveWindowIdFromIframe( iframe );
		const deregister = registerDropTargetFor(
			dragManager,
			iframe,
			dropTargetEl,
			windowId,
		);
		_activeRegistrations.set( iframe, deregister );
	} );
}

function onDragEnd(): void {
	cancelDragMove();
	_pointerHoveredIframe = null;
	_suppressedIframes.forEach( ( prev, iframe ) => {
		iframe.style.pointerEvents = prev;
	} );
	_suppressedIframes.clear();
	_activeRegistrations.forEach( ( deregister ) => {
		try {
			deregister();
		} catch {

		}
	} );
	_activeRegistrations.clear();
}

export function installIframeDropTargets( dragManager: DragManagerApi ): void {
	if ( _installed ) {
		return;
	}
	_installed = true;
	_dragManager = dragManager;

	document.addEventListener( DRAG_EVENTS.START, ( e ) => {
		const detail = ( e as CustomEvent ).detail as
			| { payload?: unknown }
			| undefined;
		onDragStart( detail?.payload );
	} );
	document.addEventListener( DRAG_EVENTS.END, () => {
		onDragEnd();
	} );

	document.addEventListener( DRAG_EVENTS.MOVE, ( e ) => {
		const iframe = _pointerHoveredIframe;
		if ( ! iframe ) {
			return;
		}
		const detail = ( e as CustomEvent ).detail as
			| { clientX?: number; clientY?: number }
			| undefined;
		if ( typeof detail?.clientX !== 'number' || typeof detail?.clientY !== 'number' ) {
			return;
		}
		postDragMove( iframe, detail.clientX, detail.clientY );
	} );

	document.addEventListener( DRAG_BRIDGE_EVENTS.START, ( e ) => {
		const detail = ( e as CustomEvent ).detail as
			| { payload?: DragBridgePayload }
			| undefined;
		if ( ! detail?.payload ) {
			return;
		}
		startBridgeIntercept( detail.payload );
	} );
	document.addEventListener( DRAG_BRIDGE_EVENTS.END, () => {
		stopBridgeIntercept();
	} );

	addAction(
		HOOKS.WINDOW_CLOSED,
		'desktop-mode/drag/iframe-drop-targets-window-close',
		() => {
			for ( const [ iframe ] of Array.from( _suppressedIframes ) ) {
				if ( ! iframe.isConnected ) {
					_suppressedIframes.delete( iframe );
				}
			}
			for ( const [ iframe, deregister ] of Array.from( _activeRegistrations ) ) {
				if ( ! iframe.isConnected ) {
					try {
						deregister();
					} catch {

					}
					_activeRegistrations.delete( iframe );
				}
			}
		},
	);

	type OpenStationIframeDropDebugWindow = Window & {
		__openStationIframeDropDebug?: () => {
			installed: boolean;
			iframesInDom: number;
			suppressedCount: number;
			registeredCount: number;
			suppressedIframeIds: string[];
		};
	};
	( window as OpenStationIframeDropDebugWindow ).__openStationIframeDropDebug = () => ( {
		installed: _installed,
		iframesInDom: document.querySelectorAll( IFRAME_SELECTOR ).length,
		suppressedCount: _suppressedIframes.size,
		registeredCount: _activeRegistrations.size,
		suppressedIframeIds: Array.from( _suppressedIframes.keys() ).map(
			deriveWindowIdFromIframe,
		),
	} );
}

export function __resetIframeDropTargetsForTests(): void {
	onDragEnd();
	_installed = false;
	_dragManager = null;
}
