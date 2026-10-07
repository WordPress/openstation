import type { OsTable } from '../../../src/ui/components/os-table/os-table';

export type PostsMode = 'posts' | 'pages';

export interface ListState extends Record< string, unknown > {

	tab: string;
	page: number;
	perPage: number;
	search: string;
	status: string;
	orderby: string;
	order: 'asc' | 'desc';
	author: number[];
	tag: number[];
}

export interface ListData {
	query?: Record< string, unknown >;
	list: {
		replace?: boolean;
		items: PostListItem[];
		total: number;
		pages: number;
		page: number;
		perPage: number;
		error: string;
		code: string;
	};
}

export interface ListExtra {
	mode?: PostsMode;
	editPostUrlBase?: string;
	newPostUrl?: string;

	defaultOrderby?: string;
	defaultOrder?: 'asc' | 'desc';
	frontPageId?: number;
	postsPageId?: number;
	pageTemplates?: Record< string, string >;
}

export interface PostListItemLock {
	userId: number;
	userName: string;
	userAvatarUrl: string;

	time: string;
}

export interface PostListItem {
	id: number;
	title: { rendered: string };
	status: string;
	date: string;
	date_gmt: string;
	modified: string;
	modified_gmt: string;
	author: number;
	categories: number[];
	tags: number[];

	parent?: number;
	menu_order?: number;
	slug?: string;

	link?: string;

	template?: string;

	openstation_comment_count?: number;
	comment_status: 'open' | 'closed';
	excerpt?: { rendered: string; protected?: boolean };
	openstation_lock?: PostListItemLock | null;
	_embedded?: {
		author?: Array< {
			id: number;
			name: string;
			avatar_urls?: Record< string, string >;
		} >;
		'wp:term'?: Array<
			Array< {
				id: number;
				name: string;
				taxonomy: string;
				link: string;
			} >
		>;
		'wp:featuredmedia'?: Array< {
			id: number;
			source_url: string;
			alt_text: string;
			media_details?: {
				sizes?: Record< string, { source_url: string } | undefined >;
			};
		} >;
	};
	[ key: string ]: unknown;
}

export interface PostsListParams {
	page?: number;
	perPage?: number;
	search?: string;
	status?: string;
	orderby?: string;
	order?: 'asc' | 'desc';
	author?: number | number[];
	tag?: number | number[];
}

export interface TagTerm {
	id: number;
	name: string;
	slug: string;
	description?: string;
	count?: number;
	link?: string;
}

export interface CategoryTerm {
	id: number;
	name: string;
	slug: string;
	parent: number;
	description?: string;
	count?: number;
	link?: string;
}

export interface AuthorOption {
	id: number;
	name: string;
}

export interface TagOption {
	id: number;
	name: string;
	count?: number;
}

export interface TagOptionsPage {
	items: TagOption[];
	totalPages: number;
}

export interface TermRow {
	id: number;
	name: string;
	slug: string;
	parent: number;
	count: number;
	description: string;

	isDefault: boolean;
	[ key: string ]: unknown;
}

export interface TermsListPage {
	items: TermRow[];
	total: number;
	totalPages: number;
}

export interface TermsListParams {
	page?: number;
	perPage?: number;
	search?: string;
	orderby?: 'name' | 'count' | 'slug' | 'description';
	order?: 'asc' | 'desc';
	parent?: number;
}

export interface TermNeighbor {
	id: number;
	shared: number;
}

export interface PostsWindowContext {

	body: HTMLElement;

	table: OsTable< PostListItem >;

	refresh(): Promise< void >;

	getSelectedIds(): number[];

	getSelectedRows(): PostListItem[];

	getCurrentParams(): PostsListParams;
}

export interface BulkAction {

	id: string;
	label: string;

	icon?: string;

	variant?: 'primary' | 'secondary' | 'danger' | 'ghost';

	confirm?: string | ( ( count: number ) => string );

	run( ids: number[], ctx: PostsWindowContext ): void | false | Promise< void | false >;
}

export interface StatusSegment {
	value: string;
	label: string;
}

export interface PostsWindowDataLoadedDetail {
	items: PostListItem[];
	total: number;
	totalPages: number;
	page: number;
}
