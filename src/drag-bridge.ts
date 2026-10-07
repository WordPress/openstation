import { createSharedStore } from './shared-store';

export interface AttachmentDragPayload {
	kind: 'attachment';
	id: number;

	url: string;
	title: string;
	alt: string;

	mime: string;
	thumbnailUrl?: string;
	sizes?: Record< string, unknown >;
}

export interface PostDragPayload {
	kind: 'post';
	id: number;

	postType: string;

	url: string;
	title: string;
}

export interface UserDragPayload {
	kind: 'user';
	id: number;

	url: string;
	title: string;
}

export interface UploadDragPayload {
	kind: 'upload';

	fileId: number;
	title: string;

	mime: string;
	thumbnailUrl?: string;
}

export type DragBridgePayload =
	| AttachmentDragPayload
	| PostDragPayload
	| UserDragPayload
	| UploadDragPayload;

export type BridgePayloadResolver = (
	payload: DragBridgePayload,
) => Promise< DragBridgePayload | null >;

interface ResolverStore {
	byKind: Map< string, BridgePayloadResolver >;
}

const resolvers = createSharedStore< ResolverStore >(
	'desktop-mode/drag-bridge-resolvers',
	() => ( { byKind: new Map() } ),
);

export function registerBridgePayloadResolver(
	kind: DragBridgePayload[ 'kind' ],
	resolver: BridgePayloadResolver,
): () => void {
	resolvers.state.byKind.set( kind, resolver );
	return () => {
		if ( resolvers.state.byKind.get( kind ) === resolver ) {
			resolvers.state.byKind.delete( kind );
		}
	};
}

export function bridgePayloadNeedsResolution( payload: DragBridgePayload ): boolean {
	return resolvers.state.byKind.has( payload.kind );
}

export async function resolveBridgePayload(
	payload: DragBridgePayload,
): Promise< DragBridgePayload | null > {
	const resolver = resolvers.state.byKind.get( payload.kind );
	if ( ! resolver ) {
		return payload;
	}
	try {
		return await resolver( payload );
	} catch ( err ) {
		console.error( '[openstation] bridge payload resolver threw:', err );
		return null;
	}
}

export interface DragBridgeApi {

	getPayload(): DragBridgePayload | null;

	isDragging(): boolean;

	start( payload: DragBridgePayload ): void;

	end(): void;
}

export const DRAG_BRIDGE_EVENTS = {
	START: 'os-cross-frame-drag-start',
	END: 'os-cross-frame-drag-end',
} as const;

interface StartMsg {
	type: 'os-drag-start';
	payload: DragBridgePayload;
}
interface EndMsg {
	type: 'os-drag-end';
}
interface PayloadRequestMsg {
	type: 'os-drag-payload-request';
}

type InboundMsg = StartMsg | EndMsg | PayloadRequestMsg;

function isStart( m: unknown ): m is StartMsg {
	return !! m && typeof m === 'object' &&
		( m as { type?: unknown } ).type === 'os-drag-start' &&
		!! ( m as { payload?: unknown } ).payload &&
		typeof ( m as { payload?: unknown } ).payload === 'object';
}
function isEnd( m: unknown ): m is EndMsg {
	return !! m && typeof m === 'object' &&
		( m as { type?: unknown } ).type === 'os-drag-end';
}
function isPayloadRequest( m: unknown ): m is PayloadRequestMsg {
	return !! m && typeof m === 'object' &&
		( m as { type?: unknown } ).type === 'os-drag-payload-request';
}

function normalizeLegacyPayload(
	payload: DragBridgePayload,
): DragBridgePayload {
	const obj = payload as unknown as { kind?: unknown } & Record<
		string,
		unknown
	>;
	if ( obj.kind !== undefined && obj.kind !== null ) {
		return payload;
	}

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

export class DragBridge implements DragBridgeApi {
	private _payload: DragBridgePayload | null = null;

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

	private readonly _onMessage = ( e: MessageEvent ): void => {
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
			try {
				( e.source as Window ).postMessage(
					{ type: 'os-drag-payload', payload: this._payload },
					this._origin,
				);
			} catch {

			}
		}
	};

	private _startDrag( payload: DragBridgePayload ): void {
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
