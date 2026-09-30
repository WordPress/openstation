/**
 * What a share link did, said once.
 *
 * `?os_workspace=<token>` claims on the server and redirects to the
 * shell with `os_workspace_status=<status>` (see
 * `includes/workspace-shares/link.php`). The server resolves that into
 * `config.workspaceArrival`; this turns it into one toast and takes the
 * status off the address bar, so a reload or a bookmark does not say it
 * again.
 */

import { __, sprintf } from '../i18n';
import { showToast } from '../toast';

/** `config.workspaceArrival`, as the server shapes it. */
export interface WorkspaceArrival {
	status: 'pinned' | 'added' | 'already' | 'managed' | 'disabled' | 'not-allowed' | 'invalid';
	/** The workspace's name; '' when the link named none this user holds. */
	label: string;
	/** The desk the workspace landed on; '' when none. */
	desktop: string;
}

/** The query args the redirect carries. */
const ARRIVAL_ARGS = [ 'os_workspace_status', 'os_workspace_share' ];

/** The sentence for an arrival. */
export function workspaceArrivalMessage( arrival: WorkspaceArrival ): {
	message: string;
	type: string;
} {
	const name = arrival.label || __( 'The workspace' );
	switch ( arrival.status ) {
		case 'pinned':
			return {
				// translators: %s is the workspace name.
				message: sprintf( __( '%s is ready. It was set up for you, so it is the one desk you need.' ), name ),
				type: 'success',
			};
		case 'added':
			return {
				// translators: %s is the workspace name.
				message: sprintf( __( '%s was added to your workspaces.' ), name ),
				type: 'success',
			};
		case 'already':
			return {
				// translators: %s is the workspace name.
				message: sprintf( __( 'You already have %s — here it is.' ), name ),
				type: '',
			};
		case 'managed':
			return {
				message: __( 'Your desk is managed by the person who set it up, so this link cannot change it.' ),
				type: 'warning',
			};
		case 'not-allowed':
			return {
				message: __( 'This workspace link is not for your account, so nothing was changed.' ),
				type: 'warning',
			};
		case 'disabled':
			return {
				message: __( 'That workspace link has been turned off.' ),
				type: 'warning',
			};
		default:
			return {
				message: __( 'That workspace link does not exist.' ),
				type: 'error',
			};
	}
}

/**
 * Say what the link did, land on its desk, and clean the URL.
 *
 * @param arrival `config.workspaceArrival`, or null when no link was opened.
 * @param landOn  Switch to a desk, when it still exists.
 */
export function announceWorkspaceArrival(
	arrival: WorkspaceArrival | null,
	landOn: ( desktopId: string ) => void,
): void {
	if ( ! arrival ) {
		return;
	}
	if ( arrival.desktop ) {
		landOn( arrival.desktop );
	}
	// Long enough to read on a desk the user has never seen: this is
	// the one explanation of why their admin looks the way it does.
	showToast( { ...workspaceArrivalMessage( arrival ), duration: 9000 } );
	try {
		const url = new URL( window.location.href );
		for ( const arg of ARRIVAL_ARGS ) {
			url.searchParams.delete( arg );
		}
		window.history.replaceState( window.history.state, '', url.toString() );
	} catch {
		/* A URL we cannot rewrite only costs a repeated toast. */
	}
}
