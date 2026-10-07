import { showToast } from './toast';
import {
	isNoticeDismissed,
	markNoticeDismissed,
} from './ui/components/os-notice/storage';

export interface ShellNotice {

	id: string;

	title?: string;

	message: string;

	actionLabel?: string;

	actionUrl?: string;
}

export interface ShellNoticesDeps {

	notices: ShellNotice[] | undefined;

	openUrl: ( args: { url: string; title: string } ) => void;

	keyPrefix?: string;
}

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
