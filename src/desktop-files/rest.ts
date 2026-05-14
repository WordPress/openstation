/**
 * Desktop Mode — Files REST client.
 *
 * Thin wrapper around `fetch` that adds the WP nonce and the
 * desktop's REST base URL. Returns parsed JSON; throws on
 * non-2xx with the `WP_Error.code`/`message` shape WP serves.
 *
 * @since 0.9.0
 */

import { trackedFetch } from '../tracked-fetch';
import { joinRestUrl } from '../rest-url';

export interface RestPlacementShape {
	id: number;
	parentId: number;
	x: number;
	y: number;
	sortOrder: number;
	updatedAtMs: number;
	meta: Record< string, unknown > | null;
	file: {
		type: string;
		ref: string;
		title: string;
		icon: string;
		previewUrl: string;
		exists: boolean;
		[ key: string ]: unknown;
	};
	/**
	 * True when this placement is visible to the viewer (because
	 * the owner shared the parent folder) but the viewer doesn't
	 * have read access on the underlying entity. The tile renderer
	 * paints a lock overlay + tooltip and the click handler shows
	 * a toast explaining the permission gap instead of routing to
	 * the opener.
	 *
	 * @since 0.18.0
	 */
	accessGated?: boolean;
	/**
	 * Server's "can this viewer trash this placement?" answer. Set
	 * from `desktop_mode_files_user_can_trash_placement` at shape
	 * time so the client can suppress trash affordances upfront —
	 * hiding the "Move to recycle bin" tile-menu entry AND making
	 * the trash drop target reject the drag — instead of letting
	 * the user attempt the action and surface a 403 in the
	 * console.
	 *
	 * Always `true` for placements the viewer owns; falsy for
	 * placements inside a shared folder where the viewer lacks
	 * write capability, plus anything a `desktop_mode_files_user_can_trash_placement`
	 * filter customisation has vetoed.
	 *
	 * @since 0.18.x
	 */
	canTrash?: boolean;
}

export interface RestFolderShape {
	id: number;
	ownerId: number;
	name: string;
	shareMode: 'private' | 'users' | 'roles' | 'all' | string;
	shareMeta: { users?: number[]; roles?: string[] } | null;
	updatedAtMs: number;
	/**
	 * Cheap summary for tile rendering. Avoids loading the full
	 * `listShares()` response just to paint the "this folder is
	 * shared" overlay badge.
	 *
	 * @since 0.18.0
	 */
	shareSummary?: { shared: boolean; recipientCount: number };
}

export interface CreatePlacementBody {
	parentId?: number;
	type: string;
	ref: string;
	x?: number;
	y?: number;
	sortOrder?: number;
	meta?: Record< string, unknown >;
}

export interface UpdatePlacementBody {
	parentId?: number;
	x?: number;
	y?: number;
	sortOrder?: number;
	meta?: Record< string, unknown > | null;
}

export interface CreateFolderBody {
	name: string;
	shareMode?: RestFolderShape[ 'shareMode' ];
	shareMeta?: { users?: number[]; roles?: string[] };
}

export interface UpdateFolderBody {
	name?: string;
	shareMode?: RestFolderShape[ 'shareMode' ];
	shareMeta?: { users?: number[]; roles?: string[] } | null;
}

export interface FilesRestDeps {
	baseUrl: string;
	nonce: string;
}

let deps: FilesRestDeps | null = null;

/** Install REST deps. Called once from `desktop.ts` at boot. */
export function installRestDeps( next: FilesRestDeps ): void {
	deps = next;
}

function ensureDeps(): FilesRestDeps {
	if ( ! deps ) {
		throw new Error( '[desktop-mode] files REST client called before installRestDeps().' );
	}
	return deps;
}

/**
 * Conflict body the server returns on 409. The `actor` is the
 * user whose mutation won the race; `current` is the row's new
 * state after that mutation. Clients surface this in a toast.
 *
 * @since 0.18.0
 */
export interface FilesConflictDetail {
	reason: 'parent_changed' | 'trashed' | 'forbidden' | 'gone' | string;
	actor: { id: number; name: string; avatar: string };
	current: { parentId: number; parentName: string; updatedAtMs: number };
}

export class FilesConflictError extends Error {
	readonly status: number;
	readonly detail: FilesConflictDetail;
	constructor( detail: FilesConflictDetail ) {
		super(
			`Row was changed by ${ detail.actor.name || 'another session' } (parent="${ detail.current.parentName }")`,
		);
		this.name = 'FilesConflictError';
		this.status = 409;
		this.detail = detail;
	}
}

async function call< T >( path: string, init: RequestInit ): Promise< T > {
	const { baseUrl, nonce } = ensureDeps();
	const url = joinRestUrl( baseUrl, path );
	const headers = new Headers( init.headers ?? {} );
	headers.set( 'X-WP-Nonce', nonce );
	if ( init.body && ! headers.has( 'Content-Type' ) ) {
		headers.set( 'Content-Type', 'application/json' );
	}
	const res = await trackedFetch(
		url,
		{ ...init, headers, credentials: 'same-origin' },
		{ source: 'desktop-mode/files' },
	);
	const text = await res.text();
	let body: unknown = null;
	let parseError: Error | null = null;
	if ( text ) {
		try {
			body = JSON.parse( text );
		} catch ( e ) {
			body = null;
			parseError = e as Error;
		}
	}
	if ( ! res.ok ) {
		if ( res.status === 409 ) {
			const data = ( body as { data?: { data?: FilesConflictDetail } } | null )?.data?.data ??
				( body as { data?: FilesConflictDetail } | null )?.data;
			if ( data && typeof data === 'object' ) {
				throw new FilesConflictError( data as FilesConflictDetail );
			}
		}
		const err = body as { code?: string; message?: string } | null;
		throw new Error(
			`[desktop-mode] files REST ${ res.status }: ${ err?.code ?? '' } ${ err?.message ?? '' }`.trim(),
		);
	}
	// Surface JSON-parse failures on 2xx responses — the usual
	// cause is a PHP notice / warning that landed in the response
	// body before the actual JSON. Silently returning null
	// turns the parse error into a downstream TypeError far from
	// the actual root cause.
	if ( parseError && text ) {
		const head = text.slice( 0, 120 ).replace( /\s+/g, ' ' );
		throw new Error(
			`[desktop-mode] files REST ${ res.status } returned non-JSON body — ` +
				`${ parseError.message }. First 120 chars: ${ head }`,
		);
	}
	return body as T;
}

// ---------------------------------------------------------------------------
// Placements
// ---------------------------------------------------------------------------

export interface ListPlacementsResponse {
	placements: RestPlacementShape[];
	folderId: number;
}

export function listPlacements( folderId = 0 ): Promise< ListPlacementsResponse > {
	return call< ListPlacementsResponse >(
		`/placements?folder=${ encodeURIComponent( String( folderId ) ) }`,
		{ method: 'GET' },
	);
}

export function createPlacement( body: CreatePlacementBody ): Promise< RestPlacementShape > {
	return call< RestPlacementShape >( '/placements', {
		method: 'POST',
		body: JSON.stringify( body ),
	} );
}

export function updatePlacement(
	id: number,
	body: UpdatePlacementBody,
	ifMatchMs?: number,
): Promise< RestPlacementShape > {
	const headers: Record< string, string > = {};
	if ( typeof ifMatchMs === 'number' && ifMatchMs > 0 ) {
		headers[ 'If-Match' ] = String( ifMatchMs );
	}
	return call< RestPlacementShape >( `/placements/${ id }`, {
		method: 'PATCH',
		body: JSON.stringify( body ),
		headers,
	} );
}

export function deletePlacement( id: number ): Promise< { deleted: true } > {
	return call< { deleted: true } >( `/placements/${ id }`, { method: 'DELETE' } );
}

/**
 * Restore a soft-trashed placement (or folder) via the
 * recycle-bin REST endpoint. The `type` field routes to the
 * correct trash module on the server side
 * (`desktop_mode_files_restore_placement` /
 * `desktop_mode_files_restore_folder`).
 */
export async function restoreTrashedItem(
	id: number,
	type: 'placement' | 'folder',
): Promise< { ok: number[]; errors: unknown[] } > {
	const { baseUrl, nonce } = ensureDeps();
	// `baseUrl` ends with `/desktop-mode/v1/files`; swap the last
	// segment for `/recycle-bin/restore` to reach the bin's bulk
	// restore endpoint without a second config.
	const root = baseUrl.replace( /\/files\/?$/, '' );
	const url = `${ root }/recycle-bin/restore`;
	const res = await trackedFetch(
		url,
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-WP-Nonce': nonce,
			},
			credentials: 'same-origin',
			body: JSON.stringify( { items: [ { id, type } ] } ),
		},
		{ source: 'desktop-mode/files' },
	);
	if ( ! res.ok ) {
		throw new Error( `[desktop-mode] restore ${ res.status }` );
	}
	return ( await res.json() ) as { ok: number[]; errors: unknown[] };
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export interface ListFoldersResponse {
	folders: RestFolderShape[];
}

export function listFolders(): Promise< ListFoldersResponse > {
	return call< ListFoldersResponse >( '/folders', { method: 'GET' } );
}

export function createFolder( body: CreateFolderBody ): Promise< RestFolderShape > {
	return call< RestFolderShape >( '/folders', {
		method: 'POST',
		body: JSON.stringify( body ),
	} );
}

export function updateFolder(
	id: number,
	body: UpdateFolderBody,
	ifMatchMs?: number,
): Promise< RestFolderShape > {
	const headers: Record< string, string > = {};
	if ( typeof ifMatchMs === 'number' && ifMatchMs > 0 ) {
		headers[ 'If-Match' ] = String( ifMatchMs );
	}
	return call< RestFolderShape >( `/folders/${ id }`, {
		method: 'PATCH',
		body: JSON.stringify( body ),
		headers,
	} );
}

export function deleteFolder( id: number ): Promise< { deleted: true } > {
	return call< { deleted: true } >( `/folders/${ id }`, { method: 'DELETE' } );
}

// ---------------------------------------------------------------------------
// Associations
// ---------------------------------------------------------------------------

export interface SaveAssociationsResponse {
	associations: Record< string, string >;
}

export function saveAssociations(
	associations: Record< string, string >,
): Promise< SaveAssociationsResponse > {
	return call< SaveAssociationsResponse >( '/associations', {
		method: 'PUT',
		body: JSON.stringify( { associations } ),
	} );
}

// ---------------------------------------------------------------------------
// Folder shares
// ---------------------------------------------------------------------------

export interface RestShareShape {
	id: number;
	folderId: number;
	principalType: 'user' | 'role' | string;
	principalRef: string;
	capability: 'read' | 'write' | string;
	state: 'pending' | 'accepted' | 'denied' | string;
	invitedBy: number;
	invitedAtMs: number;
	decidedAtMs: number | null;
	displayName: string;
	avatarUrl: string;
}

export interface ListSharesResponse {
	shares: RestShareShape[];
	shareMode: string;
	all: boolean;
}

export function listShares( folderId: number ): Promise< ListSharesResponse > {
	return call< ListSharesResponse >( `/folders/${ folderId }/shares`, { method: 'GET' } );
}

export function inviteShare(
	folderId: number,
	body: {
		principalType: 'user' | 'role';
		principalRef: string;
		capability: 'read' | 'write';
	},
): Promise< RestShareShape > {
	return call< RestShareShape >( `/folders/${ folderId }/shares`, {
		method: 'POST',
		body: JSON.stringify( body ),
	} );
}

export function updateShareCapability(
	folderId: number,
	shareId: number,
	capability: 'read' | 'write',
): Promise< RestShareShape > {
	return call< RestShareShape >( `/folders/${ folderId }/shares/${ shareId }`, {
		method: 'PATCH',
		body: JSON.stringify( { capability } ),
	} );
}

export function revokeShare(
	folderId: number,
	shareId: number,
): Promise< { deleted: true } > {
	return call< { deleted: true } >( `/folders/${ folderId }/shares/${ shareId }`, {
		method: 'DELETE',
	} );
}

export function acceptShare(
	folderId: number,
	shareId: number,
): Promise< RestShareShape > {
	return call< RestShareShape >( `/folders/${ folderId }/shares/${ shareId }/accept`, {
		method: 'POST',
	} );
}

export function denyShare(
	folderId: number,
	shareId: number,
): Promise< RestShareShape > {
	return call< RestShareShape >( `/folders/${ folderId }/shares/${ shareId }/deny`, {
		method: 'POST',
	} );
}

/**
 * Recipient-initiated leave. Different from `denyShare` because
 * it can target a role-principal share without affecting other
 * role members — the server writes a per-user decision row.
 *
 * @since 0.18.0
 */
export function leaveShare(
	folderId: number,
): Promise< { left: true } > {
	return call< { left: true } >( `/folders/${ folderId }/leave`, {
		method: 'POST',
	} );
}
