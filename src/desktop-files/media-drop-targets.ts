/**
 * OpenStation — drop an upload tile onto a post tile.
 *
 * A `post` tile hard-rejects drops by default (see
 * `shouldRejectTileDrops` in `layer.ts`); this module opts the
 * `desktop-file` payload in through the tile-payload seam, for the
 * case where every dragged tile is a stored file the Media Library
 * would accept. The server does the rest in one request: each file
 * is copied into the Media Library (idempotently), appended to the
 * post as a block, attached to the post, and the first image becomes
 * the featured image when the post has none.
 *
 * Two handlers, not one, so the ghost chip can say "Add to page" on
 * a page and "Add to post" everywhere else — `acceptLabel` is a
 * plain string per handler, and the resolver picks the first handler
 * whose `appliesTo` matches.
 *
 * Activated once on boot from `src/desktop-files/index.ts`.
 */

import { showToast } from '../toast';
import { describeRestFailure } from '../core/rest-failure';
import { dragPlacements, type DesktopFileDragData } from './drag-payloads';
import { openUrlWindow } from './open';
import { attachUploadsToPost, listPlacements, type RestPlacementShape } from './rest';
import { setFolderPlacements } from './store';
import { registerTilePayloadHandler, type TilePayloadContext } from './tile-payloads';
import type { DragSession } from '../drag';

interface MediaConfigShape {
	canAddToMedia?: boolean;
}

function canAddToMedia(): boolean {
	return (
		( window.openStationConfig as { desktopStorage?: MediaConfigShape } | undefined )
			?.desktopStorage?.canAddToMedia === true
	);
}

/** The post id of a live post tile the viewer could add media to, or 0. */
function postIdOf( ctx: TilePayloadContext ): number {
	const file = ctx.placement.file;
	if ( file.type !== 'post' || file.exists === false || file.status === 'trash' ) {
		return 0;
	}
	if ( ! canAddToMedia() ) {
		return 0;
	}
	const id = parseInt( String( file.ref ?? '' ), 10 );
	return Number.isFinite( id ) && id > 0 ? id : 0;
}

/** Stored-file ids when EVERY dragged placement is a media upload, else `[]`. */
function mediaFileIds( data: Record< string, unknown > ): number[] {
	const placements = dragPlacements( data as unknown as DesktopFileDragData );
	if ( placements.length === 0 ) {
		return [];
	}
	const ids: number[] = [];
	for ( const placement of placements ) {
		const file = placement?.file;
		if ( ! file || file.type !== 'upload' || file.isMedia !== true ) {
			return [];
		}
		const id = parseInt( String( file.ref ?? '' ), 10 );
		if ( ! Number.isFinite( id ) || id <= 0 ) {
			return [];
		}
		ids.push( id );
	}
	return ids;
}

async function attachToPost(
	target: RestPlacementShape,
	fileIds: number[],
): Promise< void > {
	const postId = parseInt( String( target.file.ref ?? '' ), 10 );
	try {
		const res = await attachUploadsToPost( postId, fileIds );
		const count = res.attachments.length;
		const what = count === 1 ? 'file' : `${ count } files`;
		const title = res.title || target.file.title || `#${ postId }`;
		// The drop is an edit, so the post opens where the user can
		// see what landed — and undo it, if that was not the intent.
		openUrlWindow( {
			url: res.editUrl,
			title,
			icon: target.file.icon || 'dashicons-admin-post',
		} );
		showToast( { message: `Added ${ what } to “${ title }”.` } );
		// The post tile's preview is its featured image — re-pull the
		// folder so a newly set one shows up.
		if ( res.featuredImageSet ) {
			try {
				const refreshed = await listPlacements( target.parentId );
				setFolderPlacements( target.parentId, refreshed.placements );
			} catch {
				// Heartbeat will catch up.
			}
		}
	} catch ( err ) {
		showToast(
			describeRestFailure( err, { lead: `Could not add to the post`, fallback: `Could not add to the post.` } ),
		);
	}
}

function makeHandler( postType: 'page' | 'other' ) {
	return {
		appliesTo: ( ctx: TilePayloadContext ) => {
			if ( postIdOf( ctx ) === 0 ) {
				return false;
			}
			const isPage = ctx.placement.file.postType === 'page';
			return postType === 'page' ? isPage : ! isPage;
		},
		accept: ( data: Record< string, unknown > ) => mediaFileIds( data ).length > 0,
		acceptLabel: postType === 'page' ? 'Add to page' : 'Add to post',
		onDrop: ( session: DragSession, _ev: unknown, ctx: TilePayloadContext ) => {
			const fileIds = mediaFileIds( session.payload.data );
			if ( fileIds.length === 0 ) {
				return;
			}
			void attachToPost( ctx.placement, fileIds );
		},
	};
}

/**
 * Boot — opt `desktop-file` drags of media uploads into post tiles.
 */
export function installMediaDropTargets(): () => void {
	const offPage = registerTilePayloadHandler( 'desktop-file', makeHandler( 'page' ) );
	const offPost = registerTilePayloadHandler( 'desktop-file', makeHandler( 'other' ) );
	return () => {
		offPage();
		offPost();
	};
}
