/**
 * My WordPress — type contracts.
 *
 * @public
 * @since 0.8.0
 */

export interface MyWordPressEntity {
	id: string;
	label: string;
	icon: string;
	restPath: string;
}

export interface MyWordPressConfig {
	restRoot: string;
	restNonce: string;
	editPostUrlBase: string;
	entities: MyWordPressEntity[];
	perPage: number;
}

export interface EntityLock {
	userId: number;
	userName: string;
	userAvatarUrl: string;
	/** ISO-8601 timestamp of the lock heartbeat. Empty string when unknown. */
	time: string;
}

export interface EntityListItem {
	id: number;
	title: { rendered: string };
	excerpt?: { rendered: string };
	date: string;
	featured_media?: number;
	link?: string;
	desktop_mode_lock?: EntityLock | null;
	_embedded?: {
		'wp:featuredmedia'?: Array< {
			id: number;
			source_url: string;
			alt_text?: string;
			media_details?: {
				sizes?: Record< string, { source_url: string } | undefined >;
			};
		} >;
	};
	[ key: string ]: unknown;
}

export interface EntityDetail {
	id: number;
	title: { rendered: string };
	content: { rendered: string; protected?: boolean };
	excerpt?: { rendered: string };
	date: string;
	modified?: string;
	status?: string;
	link?: string;
	author?: number;
	featured_media?: number;
	categories?: number[];
	tags?: number[];
	comment_status?: string;
	desktop_mode_contributors?: ContributorRef[];
	_links?: Record< string, Array< { href: string; count?: number } > >;
	_embedded?: EntityListItem[ '_embedded' ] & {
		author?: Array< {
			id: number;
			name: string;
			link?: string;
			avatar_urls?: Record< string, string >;
		} >;
		'wp:term'?: Array<
			Array< {
				id: number;
				name: string;
				slug: string;
				taxonomy: string;
				link?: string;
			} >
		>;
		replies?: Array< Array< { id: number; href?: string } > >;
	};
}

export interface ListResult {
	items: EntityListItem[];
	total: number;
	totalPages: number;
}

/** Sub-relation drilled into from a post detail view. */
export type SubRelation =
	| 'author'
	| 'contributors'
	| 'comments'
	| 'categories'
	| 'tags'
	| 'media'
	| 'revisions';

/**
 * Compact user shape returned by the `desktop_mode_contributors`
 * REST field. Enough to paint a tile + tooltip without an extra
 * `/wp/v2/users/<id>` round-trip per row.
 *
 * @since 0.8.0
 */
export interface ContributorRef {
	userId: number;
	userName: string;
	userAvatarUrl: string;
}

export interface RelatedSummary {
	authorId: number | null;
	authorName: string;
	commentCount: number;
	categoryIds: number[];
	tagIds: number[];
	featuredMediaId: number | null;
	featuredMediaUrl: string;
	revisionsHref: string | null;
}

export type Route =
	| { kind: 'root' }
	| { kind: 'list'; entityId: string }
	| {
			kind: 'detail';
			entityId: string;
			postId: number;
			postTitle: string;
	}
	| {
			kind: 'sub-list';
			entityId: string;
			postId: number;
			postTitle: string;
			relation: SubRelation;
	};
