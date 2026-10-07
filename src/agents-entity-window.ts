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
	return ( window as unknown as { wp?: { os?: DesktopFacade } } ).wp
		?.os;
}

function adminBase(): string {
	const url = getDesktop()?.config?.adminUrl ?? '/wp-admin/';
	return url.endsWith( '/' ) ? url : `${ url }/`;
}

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

export function attachmentUrl( attachment: AgentChatAttachment ): string {
	const id = encodeURIComponent( String( attachment.id ) );
	switch ( attachment.kind ) {
		case 'user':
			return `${ adminBase() }user-edit.php?user_id=${ id }`;
		case 'comment':
			return `${ adminBase() }comment.php?action=editcomment&c=${ id }`;

		default:
			return `${ adminBase() }post.php?post=${ id }&action=edit`;
	}
}

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
