/**
 * Desktop Mode — cross-window drag bridge.
 *
 * Native HTML5 drag-and-drop mostly works across same-origin iframes
 * (browsers preserve `text/plain`, `text/uri-list`, `text/html` in the
 * DataTransfer) — but custom MIME types like `application/x-wp-media-
 * attachment` can be stripped during the cross-frame hop, depending on
 * the browser. This bridge is the authoritative channel for the full
 * payload: source iframes postMessage us when a drag starts, the shell
 * can also push a payload in-process when a DragManager session begins
 * over a shell-rendered tile (My WordPress, desktop shortcut), and any
 * receiver iframe can read it back via `desktop-mode-drag-over` /
 * `desktop-mode-drop` messages routed by the shell, or pull it on
 * demand via `desktop-mode-drag-payload-request`.
 *
 * Architecture:
 *
 *   Shell-rendered drag source (My WordPress tile)
 *     │  dragManager fires `desktop-mode.drag.start`
 *     │  desktop.ts bridges that into `bridge.start(payload)`
 *     ▼
 *   Parent shell (this module)
 *     │  stores `currentPayload`
 *     │  dispatches `desktop-mode-cross-frame-drag-start` /
 *     │  `-end` CustomEvents on document so other shell modules
 *     │  can react (highlight drop zones, dim non-target windows).
 *     │  When the pointer enters an iframe drop target, the shell
 *     │  postMessages `desktop-mode-drag-over` into that iframe.
 *     │  On pointerup over an iframe, postMessages `desktop-mode-drop`.
 *     ▲
 *     │  source iframe (Media Library) can ALSO drive the bridge
 *     │  via `window.parent.postMessage(desktop-mode-drag-start, ...)`.
 *     ▼
 *   Receiver iframe (Gutenberg post editor)
 *     listens for `desktop-mode-drop`, inserts the appropriate block.
 *
 * Payload type is a discriminated union keyed on `kind`. The receiver
 * switches on `kind` to decide what block to create.
 *
 * @since 0.14.0
 */

/**
 * Attachment payload — media item dragged from a media surface
 * (My WordPress media view, future Media Library iframe).
 */
export interface AttachmentDragPayload {
	kind: 'attachment';
	id: number;
	/** Full-size file URL. */
	url: string;
	title: string;
	alt: string;
	/** `image/png`, `video/mp4`, `audio/mpeg`, application MIME, etc. */
	mime: string;
	thumbnailUrl?: string;
	sizes?: Record< string, unknown >;
}

/**
 * Post / page / CPT payload — dragged from a post-type list tile
 * (My WordPress posts/pages view).
 */
export interface PostDragPayload {
	kind: 'post';
	id: number;
	/** `'post'`, `'page'`, or any CPT slug. */
	postType: string;
	/** Permalink (frontend URL). Receivers use this for the anchor href. */
	url: string;
	title: string;
}

/**
 * User payload — dragged from a user tile (My WordPress users view).
 * Receivers turn this into an anchor pointing at the author archive.
 */
export interface UserDragPayload {
	kind: 'user';
	id: number;
	/** Author archive URL (or profile URL fallback). */
	url: string;
	title: string;
}

/** Discriminated union of all bridge payload shapes. */
export type DragBridgePayload =
	| AttachmentDragPayload
	| PostDragPayload
	| UserDragPayload;

/** Public surface — mounted on `wp.desktop.dragBridge`. */
export interface DragBridgeApi {
	/** Current payload while a cross-frame drag is in flight, or null. */
	getPayload(): DragBridgePayload | null;
	/** True when a cross-frame drag is in progress. */
	isDragging(): boolean;
	/**
	 * Start a bridge session from in-process (the shell). Used when a
	 * DragManager pointer session begins over a shell-rendered tile —
	 * fanning the payload here lets iframe receivers participate via
	 * the same message protocol used by iframe-source drags.
	 *
	 * Idempotent: calling `start` while a session is active overwrites
	 * the payload. Calling it with the same identity payload is a
	 * no-op.
	 */
	start( payload: DragBridgePayload ): void;
	/** End the current session. Idempotent. */
	end(): void;
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
	payload: DragBridgePayload;
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

/**
 * Map the legacy Media Library payload shape (no `kind` field, just
 * the WP attachment record) into the tagged union receivers expect.
 * Pass-through for already-tagged payloads.
 */
function normalizeLegacyPayload(
	payload: DragBridgePayload,
): DragBridgePayload {
	const obj = payload as unknown as { kind?: unknown } & Record<
		string,
		unknown
	>;
	if (
		obj.kind === 'attachment' ||
		obj.kind === 'post' ||
		obj.kind === 'user'
	) {
		return payload;
	}
	// Look-alike test for the legacy Media Library payload — id +
	// url + mime are the three fields the patch always emits. Any
	// other shape falls through unchanged and the receivers will
	// drop it on the typed shape check.
	if (
		typeof obj.id === 'number' &&
		typeof obj.url === 'string' &&
		typeof obj.mime === 'string'
	) {
		return {
			kind: 'attachment',
			id: obj.id,
			url: obj.url,
			title: typeof obj.title === 'string' ? obj.title : '',
			alt: typeof obj.alt === 'string' ? obj.alt : '',
			mime: obj.mime,
			thumbnailUrl:
				typeof obj.thumbnailUrl === 'string'
					? obj.thumbnailUrl
					: undefined,
			sizes:
				obj.sizes && typeof obj.sizes === 'object'
					? ( obj.sizes as Record< string, unknown > )
					: undefined,
		};
	}
	return payload;
}

// -----------------------------------------------------------------------

export class DragBridge implements DragBridgeApi {
	private _payload: DragBridgePayload | null = null;
	/** Snapshot of the origin at boot so later mutations can't widen trust. */
	private readonly _origin: string;

	constructor() {
		this._origin = window.location.origin;
		window.addEventListener( 'message', this._onMessage );
	}

	getPayload(): DragBridgePayload | null {
		return this._payload;
	}

	isDragging(): boolean {
		return this._payload !== null;
	}

	start( payload: DragBridgePayload ): void {
		if ( this._payload === payload ) {
			return;
		}
		this._startDrag( payload );
	}

	end(): void {
		this._endDrag();
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
			this._startDrag( msg.payload );
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

	private _startDrag( payload: DragBridgePayload ): void {
		// Legacy Media Library patch (`assets/js/media-library-enhanced.js`,
		// since 0.14.0) emits payloads without a `kind` field — just
		// `{ id, url, title, alt, mime, sizes, thumbnailUrl }`. Normalize
		// to the tagged union here so every downstream consumer
		// (Gutenberg drop-receiver, future plugin receivers) only
		// has to handle one shape. The shape check is conservative —
		// missing or non-matching fields fall through to the typed
		// branch as-is, preserving forward compatibility for plugins
		// that emit their own legitimate payload kinds.
		const normalized = normalizeLegacyPayload( payload );
		this._payload = normalized;
		document.dispatchEvent(
			new CustomEvent( DRAG_BRIDGE_EVENTS.START, {
				detail: { payload: normalized },
			} ),
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
