import { addAction } from '../hooks';
import { FILE_DROP_HOOKS } from './hooks';
import type { DropContext, DropDialogFields, DropUploadResult } from './types';

interface AfterUploadPayload {
	result: DropUploadResult;
	fields: DropDialogFields;
	context: DropContext;
}

export function mountMediaLibraryRefresher(): void {
	if (
		document.body.hasAttribute(
			'data-os-suppress-media-library-refresh',
		)
	) {
		return;
	}
	const sentinel = window as unknown as {
		__wpdMediaLibraryRefresher?: boolean;
	};
	if ( sentinel.__wpdMediaLibraryRefresher ) {
		return;
	}
	sentinel.__wpdMediaLibraryRefresher = true;

	addAction< [ AfterUploadPayload ] >(
		FILE_DROP_HOOKS.AFTER_UPLOAD,
		'desktop-mode/os-file-drop-library-refresh',
		() => refreshOpenLibraries(),
	);
}

function refreshOpenLibraries(): void {
	const iframes = document.querySelectorAll< HTMLIFrameElement >( 'iframe' );
	for ( const frame of Array.from( iframes ) ) {
		if ( ! isMediaLibraryUrl( resolveIframeUrl( frame ) ) ) {
			continue;
		}
		try {
			frame.contentWindow?.location.reload();
		} catch {
			const reloadHref = resolveIframeUrl( frame );
			if ( reloadHref ) {
				frame.setAttribute( 'src', reloadHref );
			}
		}
	}
}

function resolveIframeUrl( frame: HTMLIFrameElement ): string {
	try {
		return frame.contentWindow?.location.href ?? frame.src ?? '';
	} catch {
		return frame.src ?? '';
	}
}

function isMediaLibraryUrl( url: string ): boolean {
	if ( ! url ) {
		return false;
	}

	return /\/wp-admin\/upload\.php(?:[?#]|$)/.test( url );
}
