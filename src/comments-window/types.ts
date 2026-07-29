/**
 * Native Comments window — shared types.
 *
 * @public
 */

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
 * One row of `wp/v2/comments`.
 *
 * Fields are split by whether the window's default `_fields` asks for
 * them. The optional block is still registered server-side (and any
 * caller may request it via the `desktop_mode_comments_window_query_args`
 * filter) but is NOT part of the default payload — each one is a
 * computed REST field whose cost is paid per row, and the conversation
 * view renders none of them. Treat them as absent unless you widened
 * `_fields` yourself.
 */
export interface CommentRow {
	// Index signature so `CommentRow` satisfies the
	// `T extends Record< string, unknown >` constraint on `<wpd-table>`.
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
	desktop_mode_post_title: string;
	desktop_mode_post_link: string;
	desktop_mode_can_edit: boolean;
	desktop_mode_can_moderate: boolean;
	desktop_mode_replies_count: number;

	// Registered, but outside the default `_fields` — see above.
	author_email?: string;
	author_url?: string;
	date?: string;
	link?: string;
	type?: string;
	desktop_mode_spam_score?: number;
	desktop_mode_link_count?: number;
	desktop_mode_akismet?: 'true' | 'false' | 'pending' | null;
	desktop_mode_ai_verdict?: AiVerdict | null;
}

export interface AiVerdict {
	spam: boolean;
	harmful: boolean;
	topic: string;
	summary: string;
	analyzedAt: number;
}

export interface AiModerationSettings {
	enabled: boolean;
	providerConfigured: boolean;
	canManage: boolean;
}

export interface CommentsConfig {
	mode: 'comments';
	introSlug: string;
	restRoot: string;
	restNonce: string;
	commentsUrl: string;
	currentUserId: number;
	defaultPerPage: number;
	queryArgs: Record< string, unknown >;
	introSeen: boolean;
	introUrl: string;
	canModerate: boolean;
	canEditComments: boolean;
	bulkUrl: string;
	replyUrl: string;
	insightsUrlBase: string;
	countsUrl: string;
	replyEditor: 'rich' | 'gutenberg' | 'plain';
	aiSettingsUrl: string;
	aiModeration: AiModerationSettings;
}

export interface CommentCounts {
	pending: number;
	approved: number;
	spam: number;
	trash: number;
	total: number;
}

export interface AuthorInsights {
	email: string;
	total: number;
	counts: { approve: number; hold: number; spam: number; trash: number };
	oldest: string | null;
	newest: string | null;
	userId: number;
	userName: string;
	reliability: number;
	avatarUrl: string;
}
