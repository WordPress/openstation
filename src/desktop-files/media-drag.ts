/**
 * OpenStation — an `upload` tile on the cross-frame drag bridge.
 *
 * A stored file is not an attachment: it has no attachment id and no
 * public URL, which is what a receiver (the Gutenberg editor in an
 * iframe window) needs to insert a block. So an upload tile lifts as
 * a `{ kind: 'upload' }` bridge payload, and the bridge resolves it
 * at DROP time — not at lift, because a drag that ends on the
 * wallpaper or in a folder must not create an attachment — by
 * copying the file into the Media Library (idempotently; a file
 * dropped twice is one attachment) and handing the receiver the
 * `attachment` payload it already understands.
 *
 * Only files the Media Library would accept (`file.isMedia`), and
 * only for a viewer who may add to it (`desktopStorage.canAddToMedia`),
 * get a bridge payload at all — an upload that can never resolve
 * should not light up the editor window as a drop target.
 *
 * Activated once on boot from `src/desktop-files/index.ts`.
 */

import {
	registerBridgePayloadResolver,
	type AttachmentDragPayload,
	type DragBridgePayload,
	type UploadDragPayload,
} from '../drag-bridge';
import { showToast } from '../toast';
import { toastRestFailure } from '../core/rest-failure';
import { addUploadToMediaLibrary } from './rest';
import type { DesktopFileShape } from './types';

interface MediaConfigShape {
	canAddToMedia?: boolean;
}

function canAddToMedia(): boolean {
	return (
		( window.openStationConfig as { desktopStorage?: MediaConfigShape } | undefined )
			?.desktopStorage?.canAddToMedia === true
	);
}

/**
 * The bridge payload for an upload tile, or `undefined` when the
 * tile is not a media file the viewer could add to the Media Library.
 *
 * @public
 */
export function uploadBridgePayload(
	file: DesktopFileShape,
): UploadDragPayload | undefined {
	if ( file.type !== 'upload' || file.isMedia !== true || ! canAddToMedia() ) {
		return undefined;
	}
	const fileId = parseInt( String( file.ref ?? '' ), 10 );
	if ( ! Number.isFinite( fileId ) || fileId <= 0 ) {
		return undefined;
	}
	return {
		kind: 'upload',
		fileId,
		title: String( file.title ?? '' ),
		mime: String( file.mime ?? '' ),
		thumbnailUrl: file.previewUrl ? String( file.previewUrl ) : undefined,
	};
}

/**
 * Copy the stored file into the Media Library and describe the
 * attachment the way a media surface would. `null` (after a toast)
 * when the copy failed.
 *
 * @public
 */
export async function resolveUploadPayload(
	payload: DragBridgePayload,
): Promise< AttachmentDragPayload | null > {
	if ( payload.kind !== 'upload' ) {
		return null;
	}
	try {
		const attachment = await addUploadToMediaLibrary( payload.fileId );
		return {
			kind: 'attachment',
			id: attachment.attachmentId,
			url: attachment.url,
			title: attachment.title || payload.title,
			alt: '',
			mime: payload.mime,
			thumbnailUrl: payload.thumbnailUrl,
		};
	} catch ( err ) {
		toastRestFailure( showToast, err, { lead: `Could not add to the Media Library`, fallback: `Could not add to the Media Library.` } );
		return null;
	}
}

/**
 * Boot — register the `upload` resolver with the bridge.
 */
export function installMediaDrag(): () => void {
	return registerBridgePayloadResolver( 'upload', resolveUploadPayload );
}
