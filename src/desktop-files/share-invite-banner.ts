/**
 * Desktop Mode — Pending-invite prompt.
 *
 * Watches `sharesStore` for fresh pending invites. When one lands
 * we open the accept/deny modal once per invite per session. The
 * user can defer ("Decide later") to keep the invite in the
 * pending list without re-prompting until next heartbeat tick.
 *
 * @since 0.8.5
 */

import { openPendingInviteModal } from './share-settings-modal';
import { dropPending, sharesStore, type PendingInvite, type SharesState } from './shares-store';

const prompted = new Set< number >();

/**
 * Reads the per-user folder-sharing kill switch. Defaults to `true`
 * before the OS Settings snapshot is wired (early-boot window).
 */
function sharingEnabled(): boolean {
	const settings = ( window as unknown as {
		wp?: { desktop?: { getOsSettings?: () => { foldersSharingEnabled?: boolean } } };
	} ).wp?.desktop?.getOsSettings?.();
	if ( ! settings ) {
		return true;
	}
	return settings.foldersSharingEnabled !== false;
}

export function installShareInviteBanner(): void {
	const store = sharesStore();
	const handle = ( state: Readonly< SharesState > ): void => {
		// Bail entirely when the user has flipped sharing off. The
		// server-side heartbeat already skips `shares.pending` for
		// these users, so `state.pending` is normally empty — but a
		// stale subscription (settings toggled mid-session, last
		// heartbeat still in transit) can still carry one. Guard
		// here so we never open the modal in either case.
		if ( ! sharingEnabled() ) {
			return;
		}
		for ( const invite of state.pending as PendingInvite[] ) {
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
	};
	store.subscribe( handle );
	// Fire once against the current snapshot — covers invites
	// hydrated from the shell config on initial paint (refresh path),
	// not just the ones that arrive later via heartbeat. `subscribe`
	// itself doesn't replay the current state.
	handle( store.state );
}
