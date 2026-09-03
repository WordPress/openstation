/**
 * Comments app — the wire and view types.
 *
 * Part of the `comments` client view: imported by the `comments.os.ts`
 * entry and its sibling parts.
 *
 * @public
 */

import type { PagedList, ViewContext } from '@openstation/app';

export type CommentStatus = 'approved' | 'hold' | 'spam' | 'trash';
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
 * under the app's default `_fields` projection (`parts/fields.php`).
 * The optional block is registered server-side but not requested by
 * default — each is a computed field whose cost is paid per row.
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
	status: CommentStatus | string;
	openstation_post_title: string;
	openstation_post_link: string;
	openstation_can_edit: boolean;
	openstation_can_moderate: boolean;
	openstation_replies_count: number;
	author_email?: string;
	openstation_spam_score?: number;
	openstation_link_count?: number;
	openstation_akismet?: 'true' | 'false' | 'pending' | null;
	openstation_ai_verdict?: AiVerdict | null;
}

export interface AiVerdict {
	spam: boolean;
	harmful: boolean;
	topic: string;
	summary: string;
	analyzedAt: number;
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
	perPage: number;
	post: number;
	selected: number;
	gen: number;
}

/** What `data()` returns. */
export interface AppData {
	rail: {
		items: CommentRow[];
		total: number;
		pages: number;
		page: number;
		perPage: number;
		error: string;
	};
	railKey: string;
	thread: CommentRow[] | null;
	counts: CommentCounts;
}

/** `App::config()` — static facts shipped once with the window. */
export interface AppExtra {
	currentUserId?: number;
	canModerate?: boolean;
	canEditComments?: boolean;
	replyEditor?: 'rich' | 'gutenberg' | 'plain';
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
	/** The post id last announced to the window-links engine. */
	announcedPost: number;
	/** The selection the composer was last reset for. */
	draftFor: number;
	/** Rendered comment bodies, by id — kept as nodes so the renderer keeps them. */
	bodies: Map< number, { html: string; el: HTMLElement } >;
}
