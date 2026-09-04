/**
 * Comments app — the wire and view types.
 *
 * Part of the `comments` client view: imported by the `comments.os.ts`
 * entry and its sibling parts.
 *
 * @public
 */

import type { PageEnvelope, PagedList, ViewContext } from '@openstation/app';

export type CommentTab = 'pending' | 'all' | 'spam' | 'trash' | 'mine';

export type BulkAction =
	| 'approve'
	| 'unapprove'
	| 'spam'
	| 'unspam'
	| 'trash'
	| 'untrash';

/**
 * One row of `wp/v2/comments`, exactly as the collection serialises it
 * under the app's default `_fields` projection (`parts/fields.php`),
 * plus `openstation_replies_count`, which `data()` merges in from one
 * grouped query for the rail's rows.
 */
export interface CommentRow {
	[ key: string ]: unknown;
	id: number;
	post: number;
	parent: number;
	author: number;
	author_name: string;
	author_avatar_urls: Record< string, string >;
	date_gmt: string;
	content: { rendered?: string; raw?: string };
	/** `approved` | `hold` | `spam` | `trash`, in whichever spelling the collection used. */
	status: string;
	openstation_post_title: string;
	openstation_post_link: string;
	openstation_can_edit: boolean;
	openstation_replies_count?: number;
}

export interface CommentCounts {
	pending: number;
	approved: number;
	spam: number;
	trash: number;
	total: number;
}

/** The declared state — `App::state()` in `comments.os.php`. */
export interface AppState extends Record< string, unknown > {
	tab: CommentTab;
	search: string;
	page: number;
	post: number;
	selected: number;
	gen: number;
}

/** The selected conversation's rows, and whether the server cut them off. */
export interface Thread {
	rows: CommentRow[];
	truncated: boolean;
}

/**
 * What `data()` returns. A half an action left untouched is omitted
 * (`select` sends no rail, Load more sends no thread) and the client
 * keeps what it has.
 */
export interface AppData {
	rail?: PageEnvelope< CommentRow > & { error: string; code: string };
	railKey?: string;
	/** `null`: nothing selected or the read failed; absent: unchanged. */
	thread?: Thread | null;
	/** Absent only while the app paints its placeholder: the tabs stay bare. */
	counts?: CommentCounts;
}

/** `App::config()` — static facts shipped once with the window. */
export interface AppExtra {
	currentUserId?: number;
	canModerate?: boolean;
	canEditComments?: boolean;
}

export type Ctx = ViewContext< AppState, AppData >;

/** Client-only per-window state — none of it may reach the server. */
export interface UiState {
	/** Which pane a narrow window shows. */
	pane: 'rail' | 'convo';
	/** The polite live region's text ("Approved", "Reply sent"). */
	status: string;
	/** The composer's text and target (0 = the conversation root). */
	draft: string;
	replyTo: number;
	/** The message whose inline editor is open (0 = none), its seed and its text. */
	editing: number;
	editSeed: string;
	editDraft: string;
	/** `<id>:<action>`, `reply` or `edit:<id>` while a mutation is in flight. */
	busy: string;
	/** Load more in flight. */
	loadingMore: boolean;
	/** The rail's page accumulation. */
	list: PagedList< CommentRow >;
	/** The thread last received — kept while a response leaves it out. */
	thread: Thread | null;
	/** The tree built from `thread.rows`, keyed on that array's identity. */
	tree: { rows: CommentRow[] | null; byParent: Map< number, CommentRow[] > };
	/** The post id last announced to the window-links engine. */
	announcedPost: number;
	/** The selection the composer was last reset for. */
	draftFor: number;
	/** Rendered comment bodies, by id — kept as nodes so the renderer keeps them. */
	bodies: Map< number, { html: string; el: HTMLElement } >;
}
