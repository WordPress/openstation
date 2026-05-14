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
}

export interface RestFolderShape {
	id: number;
	ownerId: number;
	name: string;
	shareMode: 'private' | 'users' | 'roles' | 'all' | string;
	shareMeta: { users?: number[]; roles?: string[] } | null;
	updatedAtMs: number;
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
	if ( text ) {
		try {
			body = JSON.parse( text );
		} catch {
			body = null;
		}
	}
	if ( ! res.ok ) {
		const err = body as { code?: string; message?: string } | null;
		throw new Error(
			`[desktop-mode] files REST ${ res.status }: ${ err?.code ?? '' } ${ err?.message ?? '' }`.trim(),
		);
	}
	// A 2xx with an empty or unparseable body is something the
	// consumers can't usefully do anything with (every route in
	// this module returns a shaped object). It happens transiently
	// when desktop-mode replaces itself live — REST routes briefly
	// re-register, a redirect to wp-login HTML can sneak through,
	// etc. — and crashes the consumer with a cryptic
	// `Cannot read properties of null` if we forward it. Throw
	// here so the caller's `.catch` logs a meaningful line.
	if ( null === body ) {
		throw new Error(
			`[desktop-mode] files REST ${ res.status }: empty or unparseable body.`,
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
): Promise< RestPlacementShape > {
	return call< RestPlacementShape >( `/placements/${ id }`, {
		method: 'PATCH',
		body: JSON.stringify( body ),
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
): Promise< RestFolderShape > {
	return call< RestFolderShape >( `/folders/${ id }`, {
		method: 'PATCH',
		body: JSON.stringify( body ),
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
