import type { PageEnvelope, PagedList, ViewContext } from '@openstation/app';

export type CommentTab = 'pending' | 'all' | 'spam' | 'trash' | 'mine';

export type BulkAction =
	| 'approve'
	| 'unapprove'
	| 'spam'
	| 'unspam'
	| 'trash'
	| 'untrash';

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

export interface AppState extends Record< string, unknown > {
	tab: CommentTab;
	search: string;
	page: number;
	post: number;
	selected: number;
	gen: number;
}

export interface Thread {
	rows: CommentRow[];
	truncated: boolean;
}

export interface AppData {
	rail?: PageEnvelope< CommentRow > & { error: string; code: string };
	railKey?: string;

	thread?: Thread | null;

	counts?: CommentCounts;
}

export interface AppExtra {
	currentUserId?: number;
	canModerate?: boolean;
	canEditComments?: boolean;
}

export type Ctx = ViewContext< AppState, AppData >;

export interface UiState {

	pane: 'rail' | 'convo';

	status: string;

	draft: string;
	replyTo: number;

	editing: number;
	editSeed: string;
	editDraft: string;

	busy: string;

	loadingMore: boolean;

	list: PagedList< CommentRow >;

	thread: Thread | null;

	tree: { rows: CommentRow[] | null; byParent: Map< number, CommentRow[] > };

	announcedPost: number;

	draftFor: number;

	bodies: Map< number, { html: string; el: HTMLElement } >;
}
