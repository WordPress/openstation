import { openPendingFileInviteModal, openPendingInviteModal } from './overlays-loader';
import { dropPending, sharesStore, type PendingInvite, type SharesState } from './shares-store';

const prompted = new Set< number >();

function sharingEnabled(): boolean {
	const settings = ( window as unknown as {
		wp?: { os?: { getOsSettings?: () => { foldersSharingEnabled?: boolean } } };
	} ).wp?.os?.getOsSettings?.();
	if ( ! settings ) {
		return true;
	}
	return settings.foldersSharingEnabled !== false;
}

export function installShareInviteBanner(): void {
	const store = sharesStore();
	const handle = ( state: Readonly< SharesState > ): void => {
		if ( ! sharingEnabled() ) {
			return;
		}
		for ( const invite of state.pending as PendingInvite[] ) {
			if ( prompted.has( invite.id ) ) {
				continue;
			}
			prompted.add( invite.id );

			if ( invite.targetType === 'file' && typeof invite.fileId === 'number' ) {
				const fileId = invite.fileId;
				void openPendingFileInviteModal( {
					id: invite.id,
					fileId,
					fileName: invite.fileName,
					ownerName: invite.ownerName,
				} ).then( ( decision ) => {
					if ( decision === 'accepted' ) {
						dropPending( invite.id );
					} else if ( decision === 'denied' ) {
						dropPending( invite.id, { denied: true, fileId } );
					}
				} );
				continue;
			}
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
			} );
		}
	};
	store.subscribe( handle );

	handle( store.state );
}
