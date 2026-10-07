import { trackedFetch } from '../tracked-fetch';
import { createFeatureClient, restErrorFromResponse } from '../core/api-client';
import { joinRestUrl } from '../rest-url';
import { createSharedStore } from '../shared-store';

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

	accessGated?: boolean;

	canTrash?: boolean;
}

export interface RestFolderShape {
	id: number;
	ownerId: number;
	name: string;
	shareMode: 'private' | 'users' | 'roles' | 'all' | string;
	shareMeta: { users?: number[]; roles?: string[] } | null;
	updatedAtMs: number;

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

const depsStore = createSharedStore< { deps: FilesRestDeps | null } >(
	'desktop-files/rest-deps',
	() => ( { deps: null } ),
);

export function installRestDeps( next: FilesRestDeps ): void {
	depsStore.state.deps = next;
}

function ensureDeps(): FilesRestDeps {
	const { deps } = depsStore.state;
	if ( ! deps ) {
		throw new Error( '[openstation] files REST client called before installRestDeps().' );
	}
	return deps;
}

export function getFilesRestDeps(): FilesRestDeps {
	return ensureDeps();
}

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

const call = createFeatureClient( {
	prefix: '[openstation] files REST',
	source: 'desktop-mode/files',
	url: ( path ) => joinRestUrl( ensureDeps().baseUrl, path ),
	nonce: () => ensureDeps().nonce,
	conflict: ( body ) => {
		const data = ( body as { data?: { data?: FilesConflictDetail } } | null )?.data?.data ??
			( body as { data?: FilesConflictDetail } | null )?.data;
		return data && typeof data === 'object' ? new FilesConflictError( data as FilesConflictDetail ) : null;
	},
} );

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

export async function restoreTrashedItem(
	id: number,
	type: 'placement' | 'folder',
): Promise< { ok: number[]; errors: unknown[] } > {
	const { baseUrl, nonce } = ensureDeps();

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
		throw await restErrorFromResponse( res );
	}
	return ( await res.json() ) as { ok: number[]; errors: unknown[] };
}

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

export function leaveShare(
	folderId: number,
): Promise< { left: true } > {
	return call< { left: true } >( `/folders/${ folderId }/leave`, {
		method: 'POST',
	} );
}

export function purgeFolderSharingTables(): Promise< { dropped: string[] } > {
	return call< { dropped: string[] } >(
		'/folder-sharing-tables/purge',
		{ method: 'POST' },
	);
}

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

export function renameUpload(
	fileId: number,
	name: string,
): Promise< { id: number; name: string; sizeBytes: number; mime: string } > {
	return call< { id: number; name: string; sizeBytes: number; mime: string } >(
		`/uploads/${ fileId }`,
		{ method: 'PATCH', body: JSON.stringify( { name } ) },
	);
}

export interface RestMediaAttachmentShape {
	attachmentId: number;
	created: boolean;
	title: string;
	url: string;
	editUrl: string;
}

export function addUploadToMediaLibrary(
	fileId: number,
): Promise< RestMediaAttachmentShape > {
	return call< RestMediaAttachmentShape >( `/uploads/${ fileId }/media`, {
		method: 'POST',
	} );
}

export function startPostFromUpload(
	fileId: number,
	postType: string,
): Promise< {
	postId: number;
	postType: string;
	editUrl: string;
	attachment: RestMediaAttachmentShape;
} > {
	return call< {
		postId: number;
		postType: string;
		editUrl: string;
		attachment: RestMediaAttachmentShape;
	} >( `/uploads/${ fileId }/post`, {
		method: 'POST',
		body: JSON.stringify( { postType } ),
	} );
}

export interface RestAttachToPostShape {
	postId: number;
	title: string;
	editUrl: string;

	appended: boolean;

	featuredImageSet: boolean;
	attachments: RestMediaAttachmentShape[];
}

export function attachUploadsToPost(
	postId: number,
	fileIds: number[],
): Promise< RestAttachToPostShape > {
	return call< RestAttachToPostShape >( `/posts/${ postId }/uploads`, {
		method: 'POST',
		body: JSON.stringify( { fileIds } ),
	} );
}

export interface RestCreatedFolderShape {
	folder: RestFolderShape;
	placement: RestPlacementShape;
}

export function ensureUploadPath(
	parentId: number,
	relativePath: string,
): Promise< { folderId: number; createdFolders?: RestCreatedFolderShape[] } > {
	return call< { folderId: number; createdFolders?: RestCreatedFolderShape[] } >(
		'/uploads/paths',
		{
			method: 'POST',
			body: JSON.stringify( { parentId, relativePath } ),
		},
	);
}

export function getUploadDownloadUrl( fileId: number ): string {
	const { baseUrl, nonce } = ensureDeps();
	const base = joinRestUrl( baseUrl, `/uploads/${ fileId }/download` );
	return `${ base }${ base.includes( '?' ) ? '&' : '?' }_wpnonce=${ encodeURIComponent( nonce ) }`;
}

export function getFolderZipUrl( folderId: number ): string {
	const { baseUrl, nonce } = ensureDeps();
	const base = joinRestUrl( baseUrl, `/folders/${ folderId }/download` );
	return `${ base }${ base.includes( '?' ) ? '&' : '?' }_wpnonce=${ encodeURIComponent( nonce ) }`;
}
