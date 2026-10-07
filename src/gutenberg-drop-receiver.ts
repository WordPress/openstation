import {
	computeInsertionPoint,
	resolveCanvasPoint,
	sameInsertionPoint,
	type InsertionPoint,
} from './gutenberg-insertion-point';

interface AttachmentDragPayload {
	kind: 'attachment';
	id: number;
	url: string;
	title: string;
	alt: string;
	mime: string;
	thumbnailUrl?: string;
	sizes?: Record< string, unknown >;
}

interface PostDragPayload {
	kind: 'post';
	id: number;
	postType: string;
	url: string;
	title: string;
}

interface UserDragPayload {
	kind: 'user';
	id: number;
	url: string;
	title: string;
}

interface UploadDragPayload {
	kind: 'upload';
	fileId: number;
	title: string;
	mime: string;
	thumbnailUrl?: string;
}

type DragBridgePayload =
	| AttachmentDragPayload
	| PostDragPayload
	| UserDragPayload
	| UploadDragPayload;

interface DragPosition {
	x: number;
	y: number;
}

interface DropMsg {
	type: 'os-drop';
	payload: DragBridgePayload;
	position?: DragPosition;
}

interface BlockSpec {

	name: string;

	attributes: Record< string, unknown >;
}

function escapeHtml( s: string ): string {
	return s
		.replace( /&/g, '&amp;' )
		.replace( /</g, '&lt;' )
		.replace( />/g, '&gt;' )
		.replace( /"/g, '&quot;' )
		.replace( /'/g, '&#039;' );
}

function isSafeUrl( raw: string ): boolean {
	const lower = raw.trimStart().toLowerCase();
	if ( lower.startsWith( 'javascript:' ) ) {
		return false;
	}
	if ( lower.startsWith( 'data:' ) ) {
		return false;
	}
	if ( lower.startsWith( 'vbscript:' ) ) {
		return false;
	}
	return true;
}

export function buildBlockSpec(
	payload: DragBridgePayload,
): BlockSpec | null {
	if ( payload.kind === 'attachment' ) {
		if ( ! payload.url || ! isSafeUrl( payload.url ) ) {
			return null;
		}
		const mime = payload.mime || '';
		if ( mime.startsWith( 'image/' ) ) {
			return {
				name: 'core/image',
				attributes: {
					id: payload.id,
					url: payload.url,
					alt: payload.alt || '',
					caption: '',
				},
			};
		}
		if ( mime.startsWith( 'video/' ) ) {
			return {
				name: 'core/video',
				attributes: {
					id: payload.id,
					src: payload.url,
				},
			};
		}
		if ( mime.startsWith( 'audio/' ) ) {
			return {
				name: 'core/audio',
				attributes: {
					id: payload.id,
					src: payload.url,
				},
			};
		}
		return {
			name: 'core/file',
			attributes: {
				id: payload.id,
				href: payload.url,
				fileName: payload.title,
			},
		};
	}

	if ( payload.kind === 'upload' ) {
		return null;
	}
	if ( ! payload.url || ! isSafeUrl( payload.url ) ) {
		return null;
	}
	const safeTitle = escapeHtml( payload.title || payload.url );
	const safeHref = escapeHtml( payload.url );
	return {
		name: 'core/paragraph',
		attributes: {
			content: `<a href="${ safeHref }">${ safeTitle }</a>`,
		},
	};
}

interface WpBlocks {
	createBlock( name: string, attributes?: Record< string, unknown > ): unknown;
}

interface WpDataDispatch {
	insertBlocks( blocks: unknown[], index?: number, rootClientId?: string ): void;

	showInsertionPoint(
		rootClientId: string | undefined,
		index: number,
		options?: { operation?: 'insert' | 'replace' | 'group' },
	): void;
	hideInsertionPoint(): void;
}

interface WpDataSelect {
	getBlockCount(): number;
}

interface WpData {
	dispatch( store: 'core/block-editor' ): WpDataDispatch;
	select( store: 'core/block-editor' ): WpDataSelect;
}

interface WpGlobal {
	blocks?: WpBlocks;
	data?: WpData;
	domReady?: ( cb: () => void ) => void;
}

declare const window: Window & { wp?: WpGlobal };

async function waitForEditor(): Promise< {
	blocks: WpBlocks;
	data: WpData;
} > {
	return new Promise( ( resolve, reject ) => {
		let ticks = 0;
		const MAX_TICKS = 300;
		const tick = (): void => {
			const wp = window.wp;
			if ( wp?.blocks && wp.data ) {
				resolve( { blocks: wp.blocks, data: wp.data } );
				return;
			}
			ticks++;
			if ( ticks > MAX_TICKS ) {
				reject(
					new Error(
						'desktop-mode/gutenberg-drop-receiver: timed out waiting for wp.blocks + wp.data',
					),
				);
				return;
			}
			requestAnimationFrame( tick );
		};
		tick();
	} );
}

let lastInsertionPoint: InsertionPoint | null = null;

function trackInsertionPoint( x: number, y: number, doc?: Document ): void {
	const target = doc ? { doc, x, y } : resolveCanvasPoint( document, x, y );
	const point = computeInsertionPoint( target.doc, target.x, target.y );
	if ( sameInsertionPoint( point, lastInsertionPoint ) ) {
		return;
	}
	lastInsertionPoint = point;
	const dispatch = window.wp?.data?.dispatch( 'core/block-editor' );
	if ( ! dispatch ) {
		return;
	}
	if ( point ) {
		dispatch.showInsertionPoint( point.rootClientId || undefined, point.index, {
			operation: 'insert',
		} );
	} else {
		dispatch.hideInsertionPoint();
	}
}

function clearInsertionPoint(): void {
	const hadPoint = lastInsertionPoint !== null;
	lastInsertionPoint = null;
	if ( hadPoint ) {
		window.wp?.data?.dispatch( 'core/block-editor' )?.hideInsertionPoint();
	}
}

async function performInsert(
	payload: DragBridgePayload,
	position?: DragPosition,
	doc?: Document,
): Promise< void > {
	const spec = buildBlockSpec( payload );
	if ( ! spec ) {
		clearInsertionPoint();
		return;
	}
	if ( position ) {
		trackInsertionPoint( position.x, position.y, doc );
	}
	const point = lastInsertionPoint;
	clearInsertionPoint();
	const { blocks, data } = await waitForEditor();
	const block = blocks.createBlock( spec.name, spec.attributes );
	const dispatch = data.dispatch( 'core/block-editor' );
	if ( point ) {
		dispatch.insertBlocks( [ block ], point.index, point.rootClientId || undefined );
	} else {
		dispatch.insertBlocks( [ block ] );
	}
}

function notifyParentOfFailure( reason: string ): void {
	if ( window.parent === window ) {
		return;
	}
	try {
		window.parent.postMessage(
			{ type: 'os-drop-failed', reason },
			window.location.origin,
		);
	} catch {

	}
}

function isDropMsg( m: unknown ): m is DropMsg {
	if ( ! m || typeof m !== 'object' ) {
		return false;
	}
	const obj = m as { type?: unknown; payload?: unknown };
	if ( obj.type !== 'os-drop' ) {
		return false;
	}
	const p = obj.payload as { kind?: unknown } | undefined;
	if ( ! p || typeof p !== 'object' ) {
		return false;
	}
	return p.kind === 'attachment' || p.kind === 'post' || p.kind === 'user';
}

let stashedBridgePayload: DragBridgePayload | null = null;

interface AttachedDocSentinel extends Document {
	__openStationDropReceiverAttached?: boolean;
}

function dragCarriesOsFiles( e: DragEvent ): boolean {
	const types = e.dataTransfer?.types;
	if ( ! types ) {
		return false;
	}
	const list = types as unknown as {
		includes?: ( s: string ) => boolean;
		contains?: ( s: string ) => boolean;
		length: number;
		[ i: number ]: string;
	};
	if ( typeof list.includes === 'function' ) {
		return list.includes( 'Files' );
	}
	if ( typeof list.contains === 'function' ) {
		return list.contains( 'Files' );
	}
	for ( let i = 0; i < list.length; i++ ) {
		if ( list[ i ] === 'Files' ) {
			return true;
		}
	}
	return false;
}

interface DragOverMsg {
	type: 'os-drag-over';
	payload: DragBridgePayload;
}

interface DragMoveMsg {
	type: 'os-drag-move';
	position: DragPosition;
}

interface DragLeaveMsg {
	type: 'os-drag-leave';
}

function isDragOverMsg( m: unknown ): m is DragOverMsg {
	if ( ! m || typeof m !== 'object' ) {
		return false;
	}
	const obj = m as { type?: unknown; payload?: unknown };
	if ( obj.type !== 'os-drag-over' ) {
		return false;
	}
	const p = obj.payload as { kind?: unknown } | undefined;
	if ( ! p || typeof p !== 'object' ) {
		return false;
	}
	return (
		p.kind === 'attachment' ||
		p.kind === 'post' ||
		p.kind === 'user' ||
		p.kind === 'upload'
	);
}

function isDragMoveMsg( m: unknown ): m is DragMoveMsg {
	if ( ! m || typeof m !== 'object' ) {
		return false;
	}
	const obj = m as { type?: unknown; position?: unknown };
	if ( obj.type !== 'os-drag-move' ) {
		return false;
	}
	const pos = obj.position as { x?: unknown; y?: unknown } | undefined;
	return !! pos && typeof pos.x === 'number' && typeof pos.y === 'number';
}

function isDragLeaveMsg( m: unknown ): m is DragLeaveMsg {
	return (
		!! m &&
		typeof m === 'object' &&
		( m as { type?: unknown } ).type === 'os-drag-leave'
	);
}

function onNativeDragOver( e: DragEvent ): void {
	if ( ! stashedBridgePayload ) {
		return;
	}
	if ( dragCarriesOsFiles( e ) ) {
		return;
	}
	e.preventDefault();
	if ( e.dataTransfer ) {
		e.dataTransfer.dropEffect = 'copy';
	}

	const doc = documentOfTarget( e );
	if ( doc ) {
		trackInsertionPoint( e.clientX, e.clientY, doc );
	}
}

function documentOfTarget( e: Event ): Document | undefined {
	const target = e.target as { ownerDocument?: Document | null } | null;
	return target?.ownerDocument ?? undefined;
}

function onNativeDrop( e: DragEvent ): void {
	if ( ! stashedBridgePayload ) {
		return;
	}
	if ( dragCarriesOsFiles( e ) ) {
		stashedBridgePayload = null;
		return;
	}
	const payload = stashedBridgePayload;
	stashedBridgePayload = null;
	e.preventDefault();
	e.stopPropagation();
	if ( typeof e.stopImmediatePropagation === 'function' ) {
		e.stopImmediatePropagation();
	}
	const doc = documentOfTarget( e );
	void performInsert( payload, { x: e.clientX, y: e.clientY }, doc ).catch( ( err: unknown ) => {
		const reason = err instanceof Error ? err.message : String( err );

		console.error(
			'[openstation] Gutenberg drop receiver native-drop insert failed:',
			err,
		);
		notifyParentOfFailure( reason );
	} );
}

function attachToDocument( doc: Document ): void {
	const sentinel = doc as AttachedDocSentinel;
	if ( sentinel.__openStationDropReceiverAttached ) {
		return;
	}
	sentinel.__openStationDropReceiverAttached = true;
	doc.addEventListener( 'drop', onNativeDrop, true );
	doc.addEventListener( 'dragover', onNativeDragOver, true );
}

function attachToAllFrames(): void {
	attachToDocument( document );
	document
		.querySelectorAll< HTMLIFrameElement >( 'iframe' )
		.forEach( ( iframe ) => {
			try {
				const innerDoc = iframe.contentDocument;
				if ( innerDoc ) {
					attachToDocument( innerDoc );
				}
			} catch {

			}
		} );
}

function install(): void {
	const expectedOrigin = window.location.origin;
	window.addEventListener( 'message', ( e: MessageEvent ) => {
		if ( e.origin !== expectedOrigin ) {
			return;
		}

		if ( isDragOverMsg( e.data ) ) {
			stashedBridgePayload = e.data.payload;
			return;
		}

		if ( isDragMoveMsg( e.data ) ) {
			if ( stashedBridgePayload ) {
				trackInsertionPoint( e.data.position.x, e.data.position.y );
			}
			return;
		}
		if ( isDragLeaveMsg( e.data ) ) {
			stashedBridgePayload = null;
			clearInsertionPoint();
			return;
		}
		if ( ! isDropMsg( e.data ) ) {
			return;
		}

		stashedBridgePayload = null;
		void performInsert( e.data.payload, e.data.position ).catch( ( err: unknown ) => {
			const reason = err instanceof Error ? err.message : String( err );

			console.error(
				'[openstation] Gutenberg drop receiver insert failed:',
				err,
			);
			notifyParentOfFailure( reason );
		} );
	} );

	attachToAllFrames();
	if ( typeof MutationObserver !== 'undefined' && document.documentElement ) {
		new MutationObserver( ( records ) => {
			for ( const r of records ) {
				for ( const node of Array.from( r.addedNodes ) ) {
					if (
						node instanceof HTMLIFrameElement ||
						( node instanceof Element &&
							node.querySelector?.( 'iframe' ) )
					) {
						attachToAllFrames();
						return;
					}
				}
			}
		} ).observe( document.documentElement, {
			childList: true,
			subtree: true,
		} );
	}

	document.addEventListener(
		'load',
		( e: Event ) => {
			if ( e.target instanceof HTMLIFrameElement ) {
				attachToAllFrames();
			}
		},
		true,
	);
}

install();
