/**
 * OpenStation — Folder window status bar.
 *
 * A bottom strip inside every `os-folder-<id>` window
 * showing aggregate counts ("3 files, 1 folder") with a public
 * extension surface so plugins can append their own segments
 * (selection size, sync status, anything).
 *
 * Plugin contract — `os.files.folder-window.status-bar`
 * filter receives an array of `StatusBarSegment` and returns a
 * mutated copy:
 *
 * ```ts
 * wp.os.hooks.addFilter(
 *     'os.files.folder-window.status-bar',
 *     'my-plugin/sync',
 *     ( segments, ctx ) => [
 *         ...segments,
 *         {
 *             id: 'my-plugin/sync',
 *             label: 'Synced',
 *             icon: 'dashicons-cloud-saved',
 *             align: 'end',
 *             sort: 80,
 *         },
 *     ],
 * );
 * ```
 *
 * Re-renders every time the underlying placement list mutates
 * (subscribed via the files store) so counts stay live.
 */

import { applyFilters } from '../hooks';
import { formatBytes } from '../os-file-drop/format-bytes';
import { getFilesState, subscribeFilesStore } from './store';

export const STATUS_BAR_CLASS = 'os-folder-status-bar';

const ROOT_CLASS = STATUS_BAR_CLASS;

export interface StatusBarSegment {
	id: string;
	label: string;
	icon?: string;
	/** `'start'` (left) or `'end'` (right). Default `'start'`. */
	align?: 'start' | 'end';
	/** Sort order within the same alignment cluster. Default 100. */
	sort?: number;
	/** Optional click handler. Renders interactive when present. */
	onClick?: ( e: MouseEvent ) => void;
}

/**
 * How the status bar learns about the window's selection. Deliberately
 * structural rather than a `FilesLayer` — the My WordPress surfaces
 * paint this same bar from a different renderer, and a bar that only
 * understood file placements couldn't say "3 selected" for them.
 */
export interface StatusBarSelectionSource {
	count: () => number;
	/** Subscribe to selection changes. Returns an unsubscribe. */
	subscribe: ( cb: () => void ) => () => void;
}

export interface StatusBarContext {
	folderId: number;
	/** How many items the user currently has selected. */
	selectedCount: number;
	totals: {
		files: number;
		folders: number;
		total: number;
		/**
		 * Sum of `sizeBytes` across the folder's stored uploads
		 * (the `upload` file type). Reference tiles (posts, media
		 * links, …) have no byte weight; sub-folder contents are
		 * not included (only this folder's own items are hydrated
		 * client-side).
		 */
		bytes: number;
	};
}

/** Mount the status bar at the bottom of `host`. */
export function mountFolderStatusBar(
	host: HTMLElement,
	folderId: number,
	opts: { selection?: StatusBarSelectionSource } = {},
): {
	dispose: () => void;
} {
	const bar = document.createElement( 'div' );
	bar.className = ROOT_CLASS;
	bar.setAttribute( 'role', 'status' );
	bar.dataset.folderId = String( folderId );
	host.appendChild( bar );

	const repaint = (): void => {
		const list = getFilesState().placementsByFolder.get( folderId ) ?? [];
		const folders = list.filter( ( p ) => p.file.type === 'folder' ).length;
		const files = list.length - folders;
		let bytes = 0;
		for ( const p of list ) {
			if ( p.file.type === 'upload' ) {
				const size = Number(
					( p.file as { sizeBytes?: number } ).sizeBytes ?? 0,
				);
				if ( Number.isFinite( size ) && size > 0 ) {
					bytes += size;
				}
			}
		}
		const ctx: StatusBarContext = {
			folderId,
			selectedCount: opts.selection?.count() ?? 0,
			totals: { files, folders, total: list.length, bytes },
		};
		const segments = computeSegments( ctx );
		render( bar, segments );
	};

	repaint();
	const off = subscribeFilesStore( () => repaint() );
	const offSelection = opts.selection?.subscribe( () => repaint() );
	return {
		dispose() {
			off();
			offSelection?.();
			bar.remove();
		},
	};
}

function computeSegments( ctx: StatusBarContext ): StatusBarSegment[] {
	const { folders, files, bytes } = ctx.totals;
	const builtIns: StatusBarSegment[] = [
		{
			id: 'count',
			label:
				pluralize( files, 'file', 'files' ) +
				( folders > 0 ? `, ${ pluralize( folders, 'folder', 'folders' ) }` : '' ) +
				// Stored-upload weight — only when the folder holds
				// real bytes (reference tiles weigh nothing).
				( bytes > 0 ? ` (${ formatBytes( bytes ) })` : '' ),
			align: 'start',
			sort: 10,
		},
	];
	// Selection count sits on the trailing edge, and only while there
	// IS one — a permanent "0 selected" would be noise on a bar whose
	// whole job is to be glanceable.
	if ( ctx.selectedCount > 0 ) {
		builtIns.push( {
			id: 'selection',
			label: `${ ctx.selectedCount } selected`,
			align: 'end',
			sort: 10,
		} );
	}
	const filtered = applyFilters< StatusBarSegment[], [ StatusBarContext ] >(
		'os.files.folder-window.status-bar',
		builtIns,
		ctx,
	);
	return Array.isArray( filtered ) ? filtered : builtIns;
}

/**
 * Public renderer that any icon-canvas surface can call to paint
 * status-bar segments using the same DOM + CSS as the folder window.
 * The host element should already carry `STATUS_BAR_CLASS` (or be
 * styled compatibly).
 *
 * @public
 */
export function renderStatusBarSegments(
	bar: HTMLElement,
	segments: StatusBarSegment[],
): void {
	render( bar, segments );
}

function render( bar: HTMLElement, segments: StatusBarSegment[] ): void {
	const sort = ( a: StatusBarSegment, b: StatusBarSegment ): number => {
		const sa = typeof a.sort === 'number' ? a.sort : 100;
		const sb = typeof b.sort === 'number' ? b.sort : 100;
		if ( sa !== sb ) {
			return sa - sb;
		}
		return a.label.localeCompare( b.label );
	};
	const start = segments.filter( ( s ) => ( s.align ?? 'start' ) === 'start' ).sort( sort );
	const end = segments.filter( ( s ) => s.align === 'end' ).sort( sort );

	bar.replaceChildren();
	bar.appendChild( buildCluster( 'start', start ) );
	bar.appendChild( buildCluster( 'end', end ) );
}

function buildCluster( align: 'start' | 'end', segs: StatusBarSegment[] ): HTMLElement {
	const cluster = document.createElement( 'div' );
	cluster.className = `${ ROOT_CLASS }__cluster ${ ROOT_CLASS }__cluster--${ align }`;
	for ( const seg of segs ) {
		cluster.appendChild( buildSegment( seg ) );
	}
	return cluster;
}

function buildSegment( seg: StatusBarSegment ): HTMLElement {
	const interactive = typeof seg.onClick === 'function';
	const el = document.createElement( interactive ? 'button' : 'span' );
	el.className = `${ ROOT_CLASS }__segment`;
	el.dataset.segmentId = seg.id;
	if ( interactive ) {
		( el as HTMLButtonElement ).type = 'button';
		el.addEventListener( 'click', ( e ) => seg.onClick!( e as MouseEvent ) );
	}
	if ( seg.icon ) {
		const icon = document.createElement( 'span' );
		icon.className = `${ ROOT_CLASS }__icon dashicons ${ seg.icon.replace( /[^a-zA-Z0-9_-]/g, '' ) }`;
		icon.setAttribute( 'aria-hidden', 'true' );
		el.appendChild( icon );
	}
	const label = document.createElement( 'span' );
	label.className = `${ ROOT_CLASS }__label`;
	label.textContent = seg.label;
	el.appendChild( label );
	return el;
}

function pluralize( n: number, singular: string, plural: string ): string {
	return `${ n } ${ n === 1 ? singular : plural }`;
}
