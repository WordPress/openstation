/**
 * Agents — open the object a message carried, in its own window.
 *
 * A drop or a "Send to" pick puts an {@link AgentChatAttachment} on the
 * user's transcript row; the chat renders it as a card the user can
 * click. This module turns that identity triple into the admin screen
 * for the object and hands it to the shell's window manager, the same
 * way the desktop's built-in file openers do.
 *
 * The URL is resolved at CLICK time rather than stored with the
 * message: transcripts outlive permalinks, and an old conversation
 * should still open whatever the entity is today.
 *
 * @public
 */

import { __ } from './i18n';
import type { AgentChatAttachment } from './agents-chat-store';

interface DesktopFacade {
	config?: { adminUrl?: string };
	deriveWindowId?: ( url: string, adminUrl?: string ) => string;
	windowManager?: {
		open?: ( config: {
			id: string;
			baseId?: string;
			url: string;
			title?: string;
			icon?: string;
		} ) => unknown;
	};
}

function getDesktop(): DesktopFacade | undefined {
	return ( window as unknown as { wp?: { desktop?: DesktopFacade } } ).wp
		?.desktop;
}

function adminBase(): string {
	const url = getDesktop()?.config?.adminUrl ?? '/wp-admin/';
	return url.endsWith( '/' ) ? url : `${ url }/`;
}

/** Dashicon shown on the attachment card and the opened window. */
export function attachmentIcon( kind: AgentChatAttachment[ 'kind' ] ): string {
	switch ( kind ) {
		case 'page':
			return 'dashicons-admin-page';
		case 'media':
			return 'dashicons-admin-media';
		case 'user':
			return 'dashicons-admin-users';
		case 'comment':
			return 'dashicons-admin-comments';
		default:
			return 'dashicons-admin-post';
	}
}

/** Translated, human-readable name of the entity kind. */
export function attachmentKindLabel(
	kind: AgentChatAttachment[ 'kind' ],
): string {
	switch ( kind ) {
		case 'page':
			return __( 'Page', 'desktop-mode' );
		case 'media':
			return __( 'Media', 'desktop-mode' );
		case 'user':
			return __( 'User', 'desktop-mode' );
		case 'comment':
			return __( 'Comment', 'desktop-mode' );
		default:
			return __( 'Post', 'desktop-mode' );
	}
}

/**
 * The admin URL that edits/inspects the attached object. Mirrors the
 * built-in desktop-file openers so a post opened from a chat and a
 * post opened from its wallpaper tile land in the same window.
 */
export function attachmentUrl( attachment: AgentChatAttachment ): string {
	const id = encodeURIComponent( String( attachment.id ) );
	switch ( attachment.kind ) {
		case 'user':
			return `${ adminBase() }user-edit.php?user_id=${ id }`;
		case 'comment':
			return `${ adminBase() }comment.php?action=editcomment&c=${ id }`;
		// Posts, pages and attachments are all edited through post.php.
		default:
			return `${ adminBase() }post.php?post=${ id }&action=edit`;
	}
}

/**
 * Open the attached object in a window. Reuses the shell's derived
 * window id so clicking the same object twice focuses one window
 * instead of stacking duplicates.
 *
 * @param attachment The object the message carried.
 * @return True when a window was opened (or focused).
 *
 * @public
 */
export function openAttachmentWindow(
	attachment: AgentChatAttachment,
): boolean {
	const desktop = getDesktop();
	if ( ! desktop?.windowManager?.open || ! desktop.deriveWindowId ) {
		return false;
	}
	const url = attachmentUrl( attachment );
	const id = desktop.deriveWindowId( url, adminBase() );
	desktop.windowManager.open( {
		id,
		baseId: id,
		url,
		title: attachment.title,
		icon: attachmentIcon( attachment.kind ),
	} );
	return true;
}
