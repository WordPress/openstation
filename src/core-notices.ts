/**
 * Surfaces server-derived global admin notices — the WordPress Core notices
 * (other than the update nag) plus the allowlisted plugin/library notices —
 * that would otherwise repeat in every window, as a single shell toast each.
 * The descriptors are re-derived from authoritative state server-side; this
 * just renders them.
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
	/** Window title for the action target (falls back to the action label). */
	title?: string;
	/** Human-readable message (already translated server-side). */
	message: string;
	/** Optional action-button label. */
	actionLabel?: string;
	/** Admin URL the action opens as a window. */
	actionUrl?: string;
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
 * Show each pending notice once. Every notice is a persistent, dismissible
 * toast — persistent because these report conditions the user should act on
 * (never auto-dismissed), dismissible because a persistent toast must always
 * have a way to be closed. Notices dismissed earlier (locally) are skipped.
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
		if ( isNoticeDismissed( dismissKey ) ) {
			continue;
		}

		const label = notice.actionLabel;
		const actionUrl = notice.actionUrl;
		// The window title is the target screen's name; the button keeps its
		// own label ("Go to Plugins"), which shouldn't leak into the title.
		const windowTitle = notice.title || label || '';
		let action: { label: string; onClick: () => void } | undefined;
		if ( label && actionUrl ) {
			action = {
				label,
				onClick: () => openUrl( { url: actionUrl, title: windowTitle } ),
			};
		}

		showToast( {
			message: notice.message,
			persistent: true,
			dismissible: true,
			onDismiss: () => markNoticeDismissed( dismissKey ),
			action,
		} );
	}
}
