import { createSharedStore } from '../shared-store';

const WINDOW_ID = 'my-wordpress';

export interface ExplorerOpenTarget {

	kind: 'detail' | 'media' | null;

	entityId: string;

	id: number;

	title: string;

	requestedAt: number;
}

export const explorerOpenTarget = createSharedStore< ExplorerOpenTarget >(
	'desktop-mode/my-wordpress/open-target',
	() => ( { kind: null, entityId: '', id: 0, title: '', requestedAt: 0 } ),
);

export function readExplorerOpenTarget(): ExplorerOpenTarget {
	return { ...explorerOpenTarget.state };
}

export function clearExplorerOpenTarget(): void {
	explorerOpenTarget.state.kind = null;
	explorerOpenTarget.state.entityId = '';
	explorerOpenTarget.state.id = 0;
	explorerOpenTarget.state.title = '';
	explorerOpenTarget.notify();
}

export function subscribeExplorerOpenTarget(
	cb: ( target: ExplorerOpenTarget ) => void,
): () => void {
	return explorerOpenTarget.subscribe( ( state ) => cb( { ...state } ) );
}

function stash( target: Omit< ExplorerOpenTarget, 'requestedAt' > ): void {
	explorerOpenTarget.state.kind = target.kind;
	explorerOpenTarget.state.entityId = target.entityId;
	explorerOpenTarget.state.id = target.id;
	explorerOpenTarget.state.title = target.title;
	explorerOpenTarget.state.requestedAt = Date.now();
	explorerOpenTarget.notify();
}

function openApp( source: string ): void {
	const open = (
		window.wp as
			| {
					os?: {
						openWindow?: (
							id: string,
							opts?: { source?: string },
						) => boolean | undefined;
					};
			}
			| undefined
	)?.os?.openWindow;
	open?.( WINDOW_ID, { source } );
}

export function openExplorerDetail( args: {
	entityId?: string;
	postId: number;
	postTitle?: string;
} ): void {
	const id = Number( args.postId );
	if ( ! Number.isFinite( id ) || id <= 0 ) {
		return;
	}
	stash( {
		kind: 'detail',
		entityId: args.entityId || 'posts',
		id,
		title: args.postTitle ?? '',
	} );
	openApp( 'my-wordpress/open-detail' );
}

export function openExplorerMedia( args: {
	mediaId: number;
	mediaTitle?: string;
} ): void {
	const id = Number( args.mediaId );
	if ( ! Number.isFinite( id ) || id <= 0 ) {
		return;
	}
	stash( {
		kind: 'media',
		entityId: 'media',
		id,
		title: args.mediaTitle ?? '',
	} );
	openApp( 'my-wordpress/open-media' );
}
