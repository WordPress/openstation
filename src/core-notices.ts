/**
 * Surfaces server-derived global admin notices — the WordPress Core notices
 * (other than the update nag) plus the allowlisted plugin/library notices —
 * that would otherwise repeat in every window, as a single shell toast each.
 * The descriptors are re-derived from authoritative state server-side; this
 * just renders them. See docs/core-notices-audit.md.
 *
 * @since 0.9.4
 */

import { showToast } from './toast';
import {
	isNoticeDismissed,
	markNoticeDismissed,
} from './ui/components/wpd-notice/storage';

/** A single notice descriptor from `config.coreNotices` / `config.pluginNotices`. */
export interface ShellNotice {
	/** Stable notice id — the per-notice dismissal key. */
	id: string;
	/** Human-readable message (already translated server-side). */
	message: string;
	/** Optional action-button label. */
	actionLabel?: string;
	/** Admin URL the action opens as a window. */
	actionUrl?: string;
	/** Whether the toast is dismissible (dismissal persists locally). */
	dismissible?: boolean;
}

/** Dependencies the surfacing needs from the shell. */
export interface ShellNoticesDeps {
	/** The notice descriptors (may be absent). */
	notices: ShellNotice[] | undefined;
	/** Open an admin URL as a window (the notice's action). */
	openUrl: ( args: { url: string; title: string } ) => void;
	/**
	 * localStorage key namespace for dismissal, keeping core / plugin notice
	 * ids from colliding. Defaults to `core-notice`.
	 */
	keyPrefix?: string;
}

/**
 * Show each pending notice once as a persistent toast. Dismissible notices
 * that were already dismissed (locally) are skipped.
 */
export function maybeShowNotices( deps: ShellNoticesDeps ): void {
	const { notices, openUrl, keyPrefix = 'core-notice' } = deps;
	if ( ! Array.isArray( notices ) ) {
		return;
	}

	for ( const notice of notices ) {
		if (
			! notice ||
			typeof notice.id !== 'string' ||
			! notice.id ||
			typeof notice.message !== 'string' ||
			! notice.message
		) {
			continue;
		}

		const dismissKey = `desktop-mode/${ keyPrefix }:${ notice.id }`;
		if ( notice.dismissible && isNoticeDismissed( dismissKey ) ) {
			continue;
		}

		const label = notice.actionLabel;
		const actionUrl = notice.actionUrl;
		let action: { label: string; onClick: () => void } | undefined;
		if ( label && actionUrl ) {
			action = {
				label,
				onClick: () => openUrl( { url: actionUrl, title: label } ),
			};
		}

		showToast( {
			message: notice.message,
			persistent: true,
			dismissible: !! notice.dismissible,
			onDismiss: notice.dismissible
				? () => markNoticeDismissed( dismissKey )
				: undefined,
			action,
		} );
	}
}
