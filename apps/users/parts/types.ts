/**
 * Users app — the wire shapes of the list.
 *
 * The rows are `wp/v2/users?context=edit` rows with the three
 * `openstation_*` REST fields the query asks for, plus the page's
 * content counts `data()` merges in under `openstation_user_stats`.
 * The profile's shapes live with the profile (`../profile/types`).
 */

import type { PageEnvelope } from '@openstation/app';
import type { ProfileConfig } from '../profile/types';

export type { ProfileConfig } from '../profile/types';

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
	roles: string[];
	registered_date?: string;
	avatar_urls?: Record< string, string >;
	openstation_user_stats?: UserStats;
	/** UTC unix timestamp; null when never recorded. */
	openstation_last_login?: number | null;
	openstation_presence?: UserPresence;
	openstation_can_edit?: boolean;
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

/** What a row's cells can ask the app to do. */
export interface RowActions {
	onSendReset: ( row: UserListItem ) => void;
	onResendWelcome: ( row: UserListItem ) => void;
	/** Say something (a copy failed, a door is missing). */
	toast: ( message: string ) => void;
}

/** The `ProfileConfig` keys the list reads, spelled out for the columns. */
export type ListConfig = Pick< ProfileConfig, 'currentUserId' | 'canEdit' | 'allRoles' >;
