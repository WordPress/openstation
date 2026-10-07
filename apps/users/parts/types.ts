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

	openstation_last_login?: number | null;
	openstation_presence?: UserPresence;
	openstation_can_edit?: boolean;
	[ key: string ]: unknown;
}

export interface UsersState extends Record< string, unknown > {
	page: number;
	perPage: number;
	search: string;

	role: string;
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

export interface RowActions {
	onSendReset: ( row: UserListItem ) => void;
	onResendWelcome: ( row: UserListItem ) => void;

	toast: ( message: string ) => void;
}

export type ListConfig = Pick< ProfileConfig, 'currentUserId' | 'canEdit' | 'allRoles' >;
