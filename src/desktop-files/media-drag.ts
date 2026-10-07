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

export function installMediaDrag(): () => void {
	return registerBridgePayloadResolver( 'upload', resolveUploadPayload );
}
