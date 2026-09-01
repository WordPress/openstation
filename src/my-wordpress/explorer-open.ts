/**
 * WP Explorer — cross-bundle "open this object in the explorer".
 *
 * The explorer is the `my-wordpress` APP; its client bundle is a
 * lazy companion of its window. The clicks that ask for a post's
 * detail dossier or a media item live in other bundles (the desktop
 * tiles' "Navigate into", the wallpaper preview pane's "Explore
 * details", the Corkboard's "Open in <site>"), so the requested
 * object is threaded through a shared store — the same contract
 * `footprint-target.ts` uses for people:
 *
 *   1. A caller invokes {@link openExplorerDetail} /
 *      {@link openExplorerMedia}, which stashes the target here and
 *      opens (or focuses) the app window.
 *   2. The app's client view consumes the pending target on mount
 *      (cold open) or on the subscription (warm, already-open
 *      window), navigates, and clears it. See
 *      `apps/my-wordpress/parts/wire.ts`.
 *
 * @public
 */

import { createSharedStore } from '../shared-store';

/** The explorer app's window id. */
const WINDOW_ID = 'my-wordpress';

export interface ExplorerOpenTarget {
	/** What to open — null when nothing is pending. */
	kind: 'detail' | 'media' | null;
	/** Section the object lives in (`posts`, `pages`, `cpt-*`, `media`). */
	entityId: string;
	/** The object id. */
	id: number;
	/** Title for the breadcrumb before the payload lands. */
	title: string;
	/** `Date.now()` of the last request — informational. */
	requestedAt: number;
}

export const explorerOpenTarget = createSharedStore< ExplorerOpenTarget >(
	'desktop-mode/my-wordpress/open-target',
	() => ( { kind: null, entityId: '', id: 0, title: '', requestedAt: 0 } ),
);

/** Read the pending target. `kind === null` means nothing pending. */
export function readExplorerOpenTarget(): ExplorerOpenTarget {
	return { ...explorerOpenTarget.state };
}

/** Clear the target once a consumer has captured it. */
export function clearExplorerOpenTarget(): void {
	explorerOpenTarget.state.kind = null;
	explorerOpenTarget.state.entityId = '';
	explorerOpenTarget.state.id = 0;
	explorerOpenTarget.state.title = '';
	explorerOpenTarget.notify();
}

/** Subscribe to target changes (a request while the app is open). */
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

/**
 * Open a post's detail dossier (Author, Comments, Categories, Tags,
 * Attached media, Revisions) in the explorer.
 *
 * @param args           Target descriptor.
 * @param args.entityId  Section the post lives in (`posts` default,
 *                       `pages`, a `cpt-*` id).
 * @param args.postId    The post.
 * @param args.postTitle Breadcrumb placeholder title.
 */
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

/**
 * Open a media item — the Media section with the item's pane (its
 * facts and the "used in" scan) — in the explorer.
 *
 * @param args            Target descriptor.
 * @param args.mediaId    The attachment.
 * @param args.mediaTitle Optional breadcrumb placeholder title.
 */
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
