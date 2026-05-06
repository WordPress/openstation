/**
 * Desktop Mode — Folder window status bar.
 *
 * A bottom strip inside every `desktop-mode-folder-<id>` window
 * showing aggregate counts ("3 files, 1 folder") with a public
 * extension surface so plugins can append their own segments
 * (selection size, sync status, anything).
 *
 * Plugin contract — `desktop-mode.files.folder-window.status-bar`
 * filter receives an array of `StatusBarSegment` and returns a
 * mutated copy:
 *
 * ```ts
 * wp.desktop.hooks.addFilter(
 *     'desktop-mode.files.folder-window.status-bar',
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
 *
 * @since 0.9.0
 */

import { applyFilters } from '../hooks';
import { getFilesState, subscribeFilesStore } from './store';

const ROOT_CLASS = 'desktop-mode-folder-status-bar';

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

export interface StatusBarContext {
	folderId: number;
	totals: {
		files: number;
		folders: number;
		total: number;
	};
}

/** Mount the status bar at the bottom of `host`. */
export function mountFolderStatusBar( host: HTMLElement, folderId: number ): {
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
		const ctx: StatusBarContext = {
			folderId,
			totals: { files, folders, total: list.length },
		};
		const segments = computeSegments( ctx );
		render( bar, segments );
	};

	repaint();
	const off = subscribeFilesStore( () => repaint() );
	return {
		dispose() {
			off();
			bar.remove();
		},
	};
}

function computeSegments( ctx: StatusBarContext ): StatusBarSegment[] {
	const { folders, files } = ctx.totals;
	const builtIns: StatusBarSegment[] = [
		{
			id: 'count',
			label:
				pluralize( files, 'file', 'files' ) +
				( folders > 0 ? `, ${ pluralize( folders, 'folder', 'folders' ) }` : '' ),
			align: 'start',
			sort: 10,
		},
	];
	const filtered = applyFilters< StatusBarSegment[], [ StatusBarContext ] >(
		'desktop-mode.files.folder-window.status-bar',
		builtIns,
		ctx,
	);
	return Array.isArray( filtered ) ? filtered : builtIns;
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
