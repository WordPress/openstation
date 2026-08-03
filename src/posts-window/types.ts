/**
 * Public extensibility types for the native Posts window.
 *
 * Plugin authors import these to type their `wp.hooks.addFilter` /
 * `addAction` callbacks. The native Posts window's contract surface
 * is intentionally narrow:
 *
 *   - `BulkAction` — items registered into the bulk-actions toolbar
 *     when one or more rows are selected.
 *   - `StatusSegment` — entries in the segmented control above the
 *     table (All / Published / Drafts / …).
 *   - `PostsWindowContext` — shell-managed handle handed to
 *     `BulkAction.run()` and the `openstation.postsWindow.opened`
 *     subscribers.
 *
 * The PostListItem row shape lives in `./rest.ts`; columns added via
 * `openstation.postsWindow.columns` reach into that shape.
 *
 * @public
 */

import type { OsTable } from '../ui/components/os-table/os-table';
import type { PostListItem, PostsListParams } from './rest';

/**
 * Context object handed to plugin extension points (bulk-action
 * runners, lifecycle subscribers). Stable read API; treat the
 * elements (`body`, `table`) as containers — mutating their
 * descendants outside the documented surface is unsupported.
 */
export interface PostsWindowContext {
	/** The native window's body element. Plugins can use this for scoping. */
	body: HTMLElement;
	/** The `<os-table>` instance the window populates. */
	table: OsTable< PostListItem >;
	/**
	 * Re-fetch + re-paint with the current view state. Returns a
	 * Promise that resolves after the data lands.
	 */
	refresh(): Promise< void >;
	/** Currently selected row ids. */
	getSelectedIds(): number[];
	/** Currently selected rows (resolved against the live `table.data`). */
	getSelectedRows(): PostListItem[];
	/** Snapshot of the outbound REST params on the next fetch. */
	getCurrentParams(): PostsListParams;
}

/**
 * A bulk action that appears in the toolbar when one or more rows
 * are selected. The shipped default is "Move to trash"; plugins
 * append/replace via the `openstation.postsWindow.bulkActions`
 * filter.
 */
export interface BulkAction {
	/** Stable id — used as a key, also the `data-action-id` on the button. */
	id: string;
	/** Visible button label. */
	label: string;
	/** Optional dashicon class (e.g. `'dashicons-trash'`). */
	icon?: string;
	/**
	 * `<os-button>` variant. Defaults to `'secondary'`; pass `'danger'`
	 * for destructive actions, `'primary'` for the headline action.
	 */
	variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
	/**
	 * Optional confirmation prompt. When set, clicking the button shows
	 * a `window.confirm()` with the message (interpolated with the row
	 * count via `%d`) before invoking `run`.
	 */
	confirm?: string;
	/**
	 * Action runner. Receives the selected row ids and the window
	 * context. May return a Promise; the bulk bar disables itself
	 * while it's pending. After the runner resolves the window
	 * automatically clears the selection and refreshes — return
	 * `false` to suppress the auto-refresh (e.g. the runner already
	 * called `ctx.refresh()` manually).
	 */
	run( ids: number[], ctx: PostsWindowContext ): void | false | Promise< void | false >;
}

/**
 * A status filter segment in the segmented control above the table.
 * Defaults are All / Published / Drafts / Pending / Scheduled / Trash;
 * plugins extend or replace via
 * `openstation.postsWindow.statusSegments`.
 *
 * The `value` is sent verbatim as the REST `?status=…` param when the
 * segment is selected. Use `''` (empty string) for the "All" sentinel
 * — the bundle remaps that to `?status=any` server-side so the user
 * sees every status they can edit.
 */
export interface StatusSegment {
	value: string;
	label: string;
}

/**
 * Detail shape of the `os-posts-window-data-loaded`
 * CustomEvent (and the matching `openstation.postsWindow.dataLoaded`
 * hook-bus action). Fired after every successful refresh.
 */
export interface PostsWindowDataLoadedDetail {
	items: PostListItem[];
	total: number;
	totalPages: number;
	page: number;
}
