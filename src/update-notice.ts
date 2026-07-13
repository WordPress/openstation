/**
 * Core-update toast — the shell-side half of the update-nag hijack.
 *
 * WordPress core repeats "WordPress X is available!" on every admin
 * screen; the plugin detaches that nag inside every window (PHP) and
 * ships a compact `{ version, url }` descriptor in the shell config as
 * `coreUpdate`. This module turns that descriptor into a single
 * persistent toast in the desktop shell — one card, not one per
 * window.
 *
 * The toast is **not** dismissible: like core's own nag it stays until
 * the update is actually addressed. Clicking "Update now" opens the
 * update screen and clears the toast; if the user navigates away
 * without updating, it returns on the next shell load. Once the update
 * is installed the server stops shipping `coreUpdate`, so the toast
 * simply doesn't appear.
 *
 * @since 0.9.3
 */

import { showToast } from './toast';
import { __, sprintf } from './i18n';

/** Compact core-update descriptor shipped in the shell config. */
export interface CoreUpdateInfo {
	version: string;
	url: string;
}

/** Dependencies the toast needs from the shell. */
export interface UpdateNoticeDeps {
	/** The `config.coreUpdate` value (may be absent / null). */
	update: CoreUpdateInfo | null | undefined;
	/** Open an admin URL as a window (the "Update now" action). */
	openUrl: ( args: { url: string; title: string } ) => void;
}

/**
 * Show the core-update toast if an update is pending. No-op otherwise.
 */
export function maybeShowUpdateToast( deps: UpdateNoticeDeps ): void {
	const { update, openUrl } = deps;
	if (
		! update ||
		typeof update.version !== 'string' ||
		! update.version ||
		typeof update.url !== 'string' ||
		! update.url
	) {
		return;
	}

	showToast( {
		/* translators: %s: WordPress version number. */
		message: sprintf( __( 'WordPress %s is available.' ), update.version ),
		persistent: true,
		action: {
			label: __( 'Update now' ),
			onClick: () =>
				openUrl( {
					url: update.url,
					title: __( 'WordPress Updates' ),
				} ),
		},
	} );
}
