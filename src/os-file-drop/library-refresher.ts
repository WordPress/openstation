/**
 * OS-file drop manager — live-refresh open Media Library windows.
 *
 * When the user drops a file anywhere in the shell and the upload
 * completes, any open iframe window pointing at `upload.php` (the
 * classic Media Library) should reflect the new attachment without
 * the user pressing F5. We do this from the parent shell — the
 * iframe is same-origin, so we can call `contentWindow.location.
 * reload()` directly. For URLs we can't classify we leave the
 * iframe alone; this is purely additive.
 *
 * The My WordPress Media section has its own live-refresh path
 * (single REST GET → prepend) in `src/my-wordpress/media-list.ts`
 * — that's better UX (no scroll jump) and is the preferred surface
 * for plugins. This module covers the classic admin page that
 * doesn't yet have an in-place refresh affordance.
 *
 * Plugins that want to suppress this behavior can set
 * `data-desktop-mode-suppress-media-library-refresh` on `<body>`
 * before the shell boots.
 *
 * @since 0.31.0
 */

import { addAction } from '../hooks';
import { FILE_DROP_HOOKS } from './hooks';
import type { DropContext, DropDialogFields, DropUploadResult } from './types';

interface AfterUploadPayload {
	result: DropUploadResult;
	fields: DropDialogFields;
	context: DropContext;
}

/**
 * Subscribe once to `after-upload`. Idempotent — repeated calls are
 * no-ops, matching how `mountUploadProgressHud()` mounts.
 */
export function mountMediaLibraryRefresher(): void {
	if (
		document.body.hasAttribute(
			'data-desktop-mode-suppress-media-library-refresh',
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

/**
 * Walk every shell iframe; reload the ones whose URL points at the
 * classic Media Library. We classify on `upload.php` (the canonical
 * library page) — that catches both the default grid view and the
 * list view. We deliberately don't try to reload modal media
 * pickers (`media-upload.php`, `wp.media` overlays): they own a
 * different lifecycle and reloading them mid-pick would lose user
 * state.
 */
function refreshOpenLibraries(): void {
	const iframes = document.querySelectorAll< HTMLIFrameElement >( 'iframe' );
	for ( const frame of Array.from( iframes ) ) {
		if ( ! isMediaLibraryUrl( resolveIframeUrl( frame ) ) ) {
			continue;
		}
		try {
			// `location.reload()` is the simplest path that respects
			// the page's own initialization order; the classic
			// uploader has no public JS hook for "rescan attachments"
			// that we could call without poking at internals.
			frame.contentWindow?.location.reload();
		} catch {
			// Cross-origin (shouldn't happen for an admin iframe, but
			// guard anyway) — `src` reassignment is the cross-origin-
			// safe fallback. Always-same-origin in practice.
			const src = frame.getAttribute( 'src' );
			if ( src ) {
				frame.setAttribute( 'src', src );
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
	// Match both the bare admin path and absolute URLs. We don't
	// care about the query string — the user may have navigated
	// to a filter or to page 2; the reload preserves that URL.
	return /\/wp-admin\/upload\.php(?:[?#]|$)/.test( url );
}
