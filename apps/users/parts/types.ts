/**
 * Users app — the wire shapes.
 *
 * The list rows are `wp/v2/users?context=edit` rows with the five
 * `openstation_*` REST fields `parts/fields.php` registers; the
 * profile record is `wp/v2/users/<id>?context=edit`; the insights
 * payload is `desktop-mode/v1/users/<id>/insights`.
 */

import type { PageEnvelope } from '@openstation/app';

export type UserPresence = 'online' | 'inactive' | 'offline';

export interface UserStats {
	posts: number;
	pages: number;
	comments: number;
}

export interface UserListItem {
	id: number;
	name: string;
	slug: string;
	email?: string;
	url?: string;
	description?: string;
	roles: string[];
	registered_date?: string;
	avatar_urls?: Record< string, string >;
	openstation_user_stats?: UserStats;
	/** UTC unix timestamp; null when never recorded. */
	openstation_last_login?: number | null;
	openstation_presence?: UserPresence;
	openstation_can_edit?: boolean;
	/** Role slugs the viewer can assign to this row. */
	openstation_assignable_roles?: string[];
	[ key: string ]: unknown;
}

/** The declared state — `App::state()` in `users.os.php`. */
export interface UsersState extends Record< string, unknown > {
	page: number;
	perPage: number;
	search: string;
	status: string;
	orderby: string;
	order: string;
	tab: string;
	createError: string;
	createField: string;
	created: number;
}

export interface UsersData {
	list: PageEnvelope< UserListItem > & { error?: string };
}

/** The static facts both apps ship through `App::config()`. */
export interface ProfileConfig {
	currentUserId?: number;
	editPostUrlBase?: string;
	canEdit?: boolean;
	canPromote?: boolean;
	canCreate?: boolean;
	canDelete?: boolean;
	isMultisite?: boolean;
	assignableRoles?: Record< string, string >;
	allRoles?: Record< string, string >;
	locales?: Record< string, string >;
	siteLocale?: string;
	defaultRole?: string;
	contactMethods?: Record< string, string >;
	colorSchemes?: Record< string, ColorSchemeInfo >;
}

export interface ColorSchemeInfo {
	name: string;
	url?: string;
	colors: string[];
	icon_colors?: Record< string, string >;
}

export interface UserEditRecord {
	id: number;
	username: string;
	name: string;
	first_name: string;
	last_name: string;
	nickname?: string;
	email: string;
	url: string;
	description: string;
	locale: string;
	roles: string[];
	registered_date?: string;
	avatar_urls?: Record< string, string >;
	link?: string;
	slug?: string;
	meta?: Record< string, unknown >;
	[ key: string ]: unknown;
}

export interface UserEditPatch {
	first_name?: string;
	last_name?: string;
	nickname?: string;
	name?: string;
	email?: string;
	url?: string;
	description?: string;
	locale?: string;
	roles?: string[];
	password?: string;
	slug?: string;
	meta?: Record< string, unknown >;
	[ key: string ]: unknown;
}

export interface UserEditSaveResult {
	ok: boolean;
	user?: UserEditRecord;
	error?: string;
	message?: string;
	fieldErrors?: Record< string, string >;
}

export interface UserInsightsPayload {
	userId: number;
	displayName: string;
	avatarUrl: string;
	profileUrl: string;
	roles: string[];
	capabilitiesCount: number;
	profileCompleteness: { filled: number; total: number; percent: number };
	stats: {
		posts: number;
		pages: number;
		attachments: number;
		commentsAuthored: number;
		commentsReceived: number;
		daysSinceRegistration: number | null;
		lastLoginAt: number | null;
		daysSinceLastLogin: number | null;
		registeredAt: number | null;
	};
	contentByMonth: Array< { month: string; count: number } >;
	recentPosts: Array< {
		id: number;
		title: string;
		status: string;
		type: string;
		dateGmt: string;
		commentCount: number;
		permalink: string;
		editUrl: string;
	} >;
	recentComments: Array< {
		id: number;
		postId: number;
		postTitle: string;
		excerpt: string;
		dateGmt: string;
		approved: boolean;
	} >;
	sessions: Array< {
		expiration: number;
		login: number;
		ip: string;
		ua: string;
		current: boolean;
	} >;
	applicationPasswords: {
		total: number;
		lastUsedAt: number | null;
		lastUsedName: string | null;
	};
}

export interface AppPasswordItem {
	uuid: string;
	name: string;
	created: number;
	last_used: number | null;
	last_ip: string | null;
}

/** `<os-form>`, by the methods the profile and Add User forms use. */
export interface OsFormElement extends HTMLElement {
	getValues(): Record< string, unknown >;
	setValues( patch: Record< string, unknown > ): void;
	setBusy( busy: boolean ): void;
	setError( message: string | null ): void;
	setFieldInvalid( name: string, invalid?: boolean, message?: string | null ): void;
	clearErrors(): void;
	reset(): void;
}

export interface OsSelectElement extends HTMLElement {
	items: ReadonlyArray< { value: string; label: string } >;
	value: string;
}
