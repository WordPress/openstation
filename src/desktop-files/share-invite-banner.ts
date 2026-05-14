/**
 * Desktop Mode — Pending-invite prompt.
 *
 * Watches `sharesStore` for fresh pending invites. When one lands
 * we open the accept/deny modal once per invite per session. The
 * user can defer ("Decide later") to keep the invite in the
 * pending list without re-prompting until next heartbeat tick.
 *
 * @since 0.18.0
 */

import { openPendingInviteModal } from './share-settings-modal';
import { dropPending, sharesStore } from './shares-store';

const prompted = new Set< number >();

export function installShareInviteBanner(): void {
	const store = sharesStore();
	store.subscribe( ( state ) => {
		for ( const invite of state.pending ) {
			if ( prompted.has( invite.id ) ) {
				continue;
			}
			prompted.add( invite.id );
			void openPendingInviteModal( {
				id: invite.id,
				folderId: invite.folderId,
				folderName: invite.folderName,
				ownerName: invite.ownerName,
				capability: invite.capability,
			} ).then( ( decision ) => {
				if ( decision === 'accepted' ) {
					dropPending( invite.id );
				} else if ( decision === 'denied' ) {
					dropPending( invite.id, { denied: true, folderId: invite.folderId } );
				}
				// 'dismissed' → leave it pending; next heartbeat
				// tick will re-deliver but we keep the prompted-set
				// gate so we don't re-open the modal in the same
				// session. The user can find the invite again from
				// (future) "Invitations" tray.
			} );
		}
	} );
}
