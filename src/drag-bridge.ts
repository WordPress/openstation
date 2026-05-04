/**
 * Desktop Mode — cross-window drag bridge.
 *
 * Native HTML5 drag-and-drop mostly works across same-origin iframes
 * (browsers preserve `text/plain`, `text/uri-list`, `text/html` in the
 * DataTransfer) — but custom MIME types like `application/x-wp-media-
 * attachment` can be stripped during the cross-frame hop, depending on
 * the browser. This bridge is the authoritative channel for the full
 * attachment payload: source iframes postMessage us when a drag starts,
 * we hold the payload in memory, and any receiver iframe can request it
 * back via postMessage during its own `drop` handler.
 *
 * Architecture:
 *
 *   Source iframe (Media Library)
 *     │  window.parent.postMessage( desktop-mode-drag-start, payload )
 *     ▼
 *   Parent shell (this module)
 *     │  stores `currentPayload`
 *     │  dispatches `desktop-mode.drag.start` / `.end` CustomEvents on
 *     │  document so other shell modules can react (highlight drop
 *     │  zones, dim non-target windows, etc.)
 *     ▲
 *     │  any iframe can postMessage:
 *     │    desktop-mode-drag-payload-request → we reply with the payload
 *     ▼
 *   Receiver iframe (e.g. post editor)
 *     uses the payload in its drop handler to insert the media.
 *
 * This module is intentionally minimal — it does NOT render a ghost or
 * draw drop indicators. Those are future iterations. The foundation
 * here is the payload plumbing plus the shell-level events so other
 * modules can layer visual polish on top without duplicating the
 * source-of-truth.
 *
 * @since 0.14.0
 */

export interface DragPayload {
	id: number;
	url: string;
	title: string;
	alt: string;
	mime: string;
	thumbnailUrl?: string;
	sizes?: Record<string, unknown>;
}

/** Public surface — mounted on `wp.desktop.dragBridge`. */
export interface DragBridgeApi {
	/** Current payload while a cross-frame drag is in flight, or null. */
	getPayload(): DragPayload | null;
	/** True when a cross-frame drag is in progress. */
	isDragging(): boolean;
}

/** Event names we dispatch on `document`. */
export const DRAG_BRIDGE_EVENTS = {
	START: 'desktop-mode-cross-frame-drag-start',
	END: 'desktop-mode-cross-frame-drag-end',
} as const;

// -----------------------------------------------------------------------
// Wire types — opaque to TS but used for the postMessage channel.
// -----------------------------------------------------------------------

interface StartMsg {
	type: 'desktop-mode-drag-start';
	payload: DragPayload;
}
interface EndMsg {
	type: 'desktop-mode-drag-end';
}
interface PayloadRequestMsg {
	type: 'desktop-mode-drag-payload-request';
}

type InboundMsg = StartMsg | EndMsg | PayloadRequestMsg;

function isStart( m: unknown ): m is StartMsg {
	return !! m && typeof m === 'object' &&
		( m as { type?: unknown } ).type === 'desktop-mode-drag-start' &&
		!! ( m as { payload?: unknown } ).payload &&
		typeof ( m as { payload?: unknown } ).payload === 'object';
}
function isEnd( m: unknown ): m is EndMsg {
	return !! m && typeof m === 'object' &&
		( m as { type?: unknown } ).type === 'desktop-mode-drag-end';
}
function isPayloadRequest( m: unknown ): m is PayloadRequestMsg {
	return !! m && typeof m === 'object' &&
		( m as { type?: unknown } ).type === 'desktop-mode-drag-payload-request';
}

// -----------------------------------------------------------------------

export class DragBridge implements DragBridgeApi {
	private _payload: DragPayload | null = null;
	/** Snapshot of the origin at boot so later mutations can't widen trust. */
	private readonly _origin: string;

	constructor() {
		this._origin = window.location.origin;
		window.addEventListener( 'message', this._onMessage );
	}

	getPayload(): DragPayload | null {
		return this._payload;
	}

	isDragging(): boolean {
		return this._payload !== null;
	}

	// -----------------------------------------------------------
	// Internals
	// -----------------------------------------------------------

	private readonly _onMessage = ( e: MessageEvent ): void => {
		// Reject cross-origin messages — the payload is trusted and
		// feeds into drop handlers that may insert HTML. A malicious
		// same-origin script can still forge messages (the browser's
		// same-origin boundary is our real defence), but we don't want
		// to accept messages from cross-origin frames inadvertently
		// embedded in the page.
		if ( e.origin !== this._origin ) {
			return;
		}
		const msg = e.data as InboundMsg | unknown;

		if ( isStart( msg ) ) {
			this._startDrag( msg.payload, e.source ?? null );
			return;
		}
		if ( isEnd( msg ) ) {
			this._endDrag();
			return;
		}
		if ( isPayloadRequest( msg ) && this._payload && e.source ) {
			// Reply directly to whichever frame asked. e.source is the
			// Window of the posting frame; postMessage on it routes the
			// reply back to that frame only.
			try {
				( e.source as Window ).postMessage(
					{ type: 'desktop-mode-drag-payload', payload: this._payload },
					this._origin,
				);
			} catch {
				/* cross-origin source (shouldn't happen given the origin check above) */
			}
		}
	};

	private _startDrag( payload: DragPayload, _source: MessageEventSource | null ): void {
		this._payload = payload;
		document.dispatchEvent(
			new CustomEvent( DRAG_BRIDGE_EVENTS.START, { detail: { payload } } ),
		);
	}

	private _endDrag(): void {
		if ( this._payload === null ) {
			return;
		}
		const payload = this._payload;
		this._payload = null;
		document.dispatchEvent(
			new CustomEvent( DRAG_BRIDGE_EVENTS.END, { detail: { payload } } ),
		);
	}
}
