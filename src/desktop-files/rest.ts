/**
 * OpenStation — Files REST client.
 *
 * Thin wrapper around `fetch` that adds the WP nonce and the
 * desktop's REST base URL. Returns parsed JSON; throws on
 * non-2xx with the `WP_Error.code`/`message` shape WP serves.
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
	 */
	accessGated?: boolean;
	/**
	 * Server's "can this viewer trash this placement?" answer. Set
	 * from `open_station_files_user_can_trash_placement` at shape
	 * time so the client can suppress trash affordances upfront —
	 * hiding the "Move to recycle bin" tile-menu entry AND making
	 * the trash drop target reject the drag — instead of letting
	 * the user attempt the action and surface a 403 in the
	 * console.
	 *
	 * Always `true` for placements the viewer owns; falsy for
	 * placements inside a shared folder where the viewer lacks
	 * write capability, plus anything a `open_station_files_user_can_trash_placement`
	 * filter customisation has vetoed.
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
	 * `shared` is viewer-agnostic, but `recipientCount` is
	 * owner-scoped: the server returns the real count only when
	 * the viewer can manage the folder's shares (per
	 * `open_station_files_share_can_manage`) and `0` for every
	 * other viewer, keeping the wire shape stable.
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
		throw new Error( '[openstation] files REST client called before installRestDeps().' );
	}
	return deps;
}

/**
 * Read-only view of the installed deps. Used by the desktop-storage
 * upload/download paths, which need the raw base URL + nonce (XHR
 * progress uploads and `_wpnonce`-in-query download navigations
 * can't ride the JSON `call()` wrapper).
 */
export function getFilesRestDeps(): FilesRestDeps {
	return ensureDeps();
}

/**
 * Conflict body the server returns on 409. The `actor` is the
 * user whose mutation won the race; `current` is the row's new
 * state after that mutation. Clients surface this in a toast.
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
			`[openstation] files REST ${ res.status }: ${ err?.code ?? '' } ${ err?.message ?? '' }`.trim(),
		);
	}
	// A 2xx with an empty or unparseable body is something the
	// consumers can't usefully do anything with (every route in
	// this module returns a shaped object). Two sources in
	// practice:
	//
	//   - OpenStation replacing itself live (REST routes
	//     briefly re-register, a redirect to wp-login HTML can
	//     sneak through) — `text` is non-empty but not JSON.
	//   - A genuinely empty 200 body (rare; usually a server
	//     misconfiguration).
	//
	// Silently returning `null` would crash the consumer with a
	// cryptic `Cannot read properties of null` far from the
	// actual root cause. Throw with as much diagnostic as we
	// have so the caller's `.catch` logs a meaningful line: when
	// `text` is non-empty include the parse error + the first
	// 120 chars of the body (usually enough to spot the PHP
	// notice or the login-form HTML that crept in), otherwise
	// fall back to the plain "empty body" message.
	if ( null === body ) {
		if ( parseError && text ) {
			const head = text.slice( 0, 120 ).replace( /\s+/g, ' ' );
			throw new Error(
				`[openstation] files REST ${ res.status } returned non-JSON body — ` +
					`${ parseError.message }. First 120 chars: ${ head }`,
			);
		}
		throw new Error(
			`[openstation] files REST ${ res.status }: empty or unparseable body.`,
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
 * (`open_station_files_restore_placement` /
 * `open_station_files_restore_folder`).
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
		throw new Error( `[openstation] restore ${ res.status }` );
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
 */
export function leaveShare(
	folderId: number,
): Promise< { left: true } > {
	return call< { left: true } >( `/folders/${ folderId }/leave`, {
		method: 'POST',
	} );
}

/**
 * Site-admin only: drop the folder-sharing tables outright. Used
 * by the OS Settings → Features → "Delete folder sharing data"
 * action. Server permission callback enforces `manage_options`;
 * non-admins get a 403.
 */
export function purgeFolderSharingTables(): Promise< { dropped: string[] } > {
	return call< { dropped: string[] } >(
		'/folder-sharing-tables/purge',
		{ method: 'POST' },
	);
}

// ---------------------------------------------------------------------------
// Stored uploads (real per-user file storage — DESKMOD-45)
// ---------------------------------------------------------------------------

/**
 * Wire shape of a `target_type='file'` share row (single uploaded
 * file shared read-only with a specific user). Distinguished from
 * folder shares by `targetType`.
 */
export interface RestFileShareShape {
	id: number;
	targetType: 'file';
	fileId: number;
	principalType: 'user' | string;
	principalRef: string;
	capability: 'read' | string;
	state: 'pending' | 'accepted' | 'denied' | string;
	invitedBy: number;
	invitedAtMs: number;
	decidedAtMs: number | null;
	fileName?: string;
	ownerId?: number;
	ownerName?: string;
	ownerAvatar?: string;
}

export function listFileShares(
	fileId: number,
): Promise< { shares: RestFileShareShape[] } > {
	return call< { shares: RestFileShareShape[] } >(
		`/uploads/${ fileId }/shares`,
		{ method: 'GET' },
	);
}

export function inviteFileShare(
	fileId: number,
	userId: number,
): Promise< RestFileShareShape > {
	return call< RestFileShareShape >( `/uploads/${ fileId }/shares`, {
		method: 'POST',
		body: JSON.stringify( { userId } ),
	} );
}

export function revokeFileShare(
	fileId: number,
	shareId: number,
): Promise< { deleted: true } > {
	return call< { deleted: true } >(
		`/uploads/${ fileId }/shares/${ shareId }`,
		{ method: 'DELETE' },
	);
}

export function acceptFileShare(
	fileId: number,
	shareId: number,
): Promise< RestFileShareShape > {
	return call< RestFileShareShape >(
		`/uploads/${ fileId }/shares/${ shareId }/accept`,
		{ method: 'POST' },
	);
}

export function denyFileShare(
	fileId: number,
	shareId: number,
): Promise< RestFileShareShape > {
	return call< RestFileShareShape >(
		`/uploads/${ fileId }/shares/${ shareId }/deny`,
		{ method: 'POST' },
	);
}

export function leaveFileShare( fileId: number ): Promise< { left: true } > {
	return call< { left: true } >( `/uploads/${ fileId }/leave`, {
		method: 'POST',
	} );
}

/**
 * Rename an uploaded file's display name (owner only).
 */
export function renameUpload(
	fileId: number,
	name: string,
): Promise< { id: number; name: string; sizeBytes: number; mime: string } > {
	return call< { id: number; name: string; sizeBytes: number; mime: string } >(
		`/uploads/${ fileId }`,
		{ method: 'PATCH', body: JSON.stringify( { name } ) },
	);
}

/**
 * Ensure a directory path exists under `parentId` (mkdir-p) and
 * return the leaf folder id. Used by tree drops to preserve empty
 * directories.
 */
export function ensureUploadPath(
	parentId: number,
	relativePath: string,
): Promise< { folderId: number } > {
	return call< { folderId: number } >( '/uploads/paths', {
		method: 'POST',
		body: JSON.stringify( { parentId, relativePath } ),
	} );
}

/**
 * Mint a download URL for a stored file. Cookie auth rides the
 * same-origin navigation; the `_wpnonce` query param satisfies the
 * REST CSRF check (the officially supported GET form). Mint at
 * click time — nonces expire, so never persist these URLs.
 */
export function getUploadDownloadUrl( fileId: number ): string {
	const { baseUrl, nonce } = ensureDeps();
	const base = joinRestUrl( baseUrl, `/uploads/${ fileId }/download` );
	return `${ base }${ base.includes( '?' ) ? '&' : '?' }_wpnonce=${ encodeURIComponent( nonce ) }`;
}

/**
 * Mint the on-demand folder-zip download URL. Same auth shape as
 * {@link getUploadDownloadUrl}.
 */
export function getFolderZipUrl( folderId: number ): string {
	const { baseUrl, nonce } = ensureDeps();
	const base = joinRestUrl( baseUrl, `/folders/${ folderId }/download` );
	return `${ base }${ base.includes( '?' ) ? '&' : '?' }_wpnonce=${ encodeURIComponent( nonce ) }`;
}
