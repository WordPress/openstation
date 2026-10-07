import { subscribe } from '../broadcast';
import { listFolders, listPlacements } from './rest';
import {
	getFilesState,
	setFolderPlacements,
	setFolders,
} from './store';

interface ChangedPayload {
	action?: string;
	source?: string;
	ids?: unknown;
}

let started = false;
const unsubscribers: Array< () => void > = [];

export function startFilesRestoreSync(): void {
	if ( started ) {
		return;
	}
	started = true;

	const onChange = ( payload: unknown ): void => {
		const detail = payload as ChangedPayload | null | undefined;
		if ( ! detail || detail.action !== 'untrashed' ) {
			return;
		}
		resyncFromServer();
	};

	unsubscribers.push(
		subscribe( 'os.placement.changed', onChange ),
		subscribe( 'os.shortcut.changed', onChange ),
		subscribe( 'os.folder.changed', onChange ),
	);
}

function resyncFromServer(): void {
	void listFolders()
		.then( ( res ) => {
			setFolders( res.folders );
		} )
		.catch( ( err ) => {
			console.error(
				'[openstation] files restore-sync: listFolders failed',
				err,
			);
		} );

	const hydrated = Array.from( getFilesState().hydratedFolders );
	for ( const folderId of hydrated ) {
		void listPlacements( folderId )
			.then( ( res ) => {
				setFolderPlacements( folderId, res.placements );
			} )
			.catch( ( err ) => {
				console.error(
					'[openstation] files restore-sync: listPlacements failed for',
					folderId,
					err,
				);
			} );
	}
}

export function __resetFilesRestoreSyncForTests(): void {
	for ( const off of unsubscribers ) {
		off();
	}
	unsubscribers.length = 0;
	started = false;
}
