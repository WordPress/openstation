import type { ViewContext } from '@openstation/app';
import type { PluginsRest } from './rest';

export interface AppState extends Record< string, unknown > {
	tab: PluginsTab;
	installedView: 'cards' | 'table';
	status: string;
	search: string;
	browse: BrowseFilter;
	query: string;
}

export interface AppData {
	installed: InstalledPlugin[];
	error: string;
}

export interface PluginsExtra {

	menuTabs?: Array< { id: string; label: string } >;
	ajaxUrl: string;
	ajaxNonce: string;
	updatesNonce: string;
	caps: {
		activate: boolean;
		install: boolean;
		delete: boolean;
		upload: boolean;
		update: boolean;
	};
	autoUpdatesEnabled: boolean;

	selfPluginFile: string;

	adminUrl: string;

	deactivationFeedback: {
		script: { url: string; translations?: string };
		styleUrl: string;
		restUrl: string;
	} | null;

	editorUrl: string;
}

export type Ctx = ViewContext< AppState, AppData >;

export type PluginsTab = 'installed' | 'browse' | 'featured';

export type PluginStatus = 'active' | 'inactive' | 'network-active';

export interface InstalledPlugin {

	plugin: string;
	status: PluginStatus;
	name: string;
	plugin_uri?: string;
	author?: string;
	author_uri?: string;
	description?: { raw: string; rendered: string } | string;
	version?: string;

	textdomain?: string;
	network_only?: boolean;
	requires_wp?: string;
	requires_php?: string;

	openstation_update_available?: {
		available: boolean;
		new_version: string | null;

		package: string;
		slug: string;
	};

	openstation_can_manage?: {
		activate: boolean;
		deactivate: boolean;
		delete: boolean;
	};

	openstation_wporg_slug?: string | null;

	openstation_icon_url?: string | null;

	openstation_size_kb?: number | null;

	openstation_auto_update?: {
		enabled: boolean;
		forced: boolean | null;
		supported: boolean;
	};
	[ key: string ]: unknown;
}

export interface WpOrgBrowsePlugin {
	slug: string;
	name: string;
	version: string;
	author: string;
	homepage?: string;
	short_description: string;
	rating: number;
	num_ratings: number;
	active_installs: number;
	last_updated: string;
	tested: string;
	requires_php?: string;
	icons?: Record< string, string >;
}

export interface WpOrgPluginInfo extends WpOrgBrowsePlugin {
	sections?: Record< string, string >;
	screenshots?: Record< string, { src: string; caption: string } >;
	ratings?: Record< string, number >;
	banners?: Record< string, string >;
}

export interface FeaturedPlugin extends WpOrgBrowsePlugin {
	featured?: boolean;
}

export type BrowseFilter = 'featured' | 'popular' | 'recommended' | 'favorites' | 'new' | 'beta';

export interface PluginReview {
	author: string;
	stars: number;
	excerpt: string;
	date: string;
	url: string;
}

export interface PluginReviewsResponse {
	items: PluginReview[];
	parsed: boolean;
	reason?: string;
}

export interface UpdatePluginResult {
	update: 'plugin';
	slug: string;
	oldVersion: string;
	newVersion: string;
	plugin: string;
	pluginName: string;
}

export interface UploadPluginResult {
	plugin_file: string;
	plugin_name: string;
	plugin_version: string;
	status: 'inactive';
	messages: string[];
}

export const PLUGINS_CHANGED_TOPIC = 'os.plugin.changed';
export const PLUGINS_CHANGED_SOURCE = 'plugins-app';

export interface PluginsChangedPayload {
	source: string;
	plugin?: string;
	action?: 'activate' | 'deactivate' | 'delete' | 'install' | 'update' | 'auto-update' | 'bulk';

	ids?: number[];
}

export interface BusyState {

	updating: Set< string >;

	autoUpdating: Set< string >;

	optimistic: Map< string, PluginStatus >;
}

export interface WpOrgCaches {
	info: Map< string, WpOrgPluginInfo >;
	reviews: Map< string, PluginReviewsResponse >;
}

export interface PluginsHost {
	readonly extra: PluginsExtra;

	readonly installed: InstalledPlugin[];
	readonly rest: PluginsRest;
	readonly root: HTMLElement;
	readonly busy: BusyState;
	readonly caches: WpOrgCaches;

	dispatch: Ctx[ 'dispatch' ];

	refresh: () => Promise< boolean >;
	repaint: () => void;
	toast: ( message: string, duration?: number ) => void;
	confirm: ( opts: {
		title?: string;
		message: string;
		confirmLabel?: string;
		cancelLabel?: string;
		danger?: boolean;
	} ) => Promise< boolean >;

	refreshMenu: () => void;

	installedFor: ( slug: string ) => InstalledPlugin | undefined;

	broadcastChange: ( payload: Omit< PluginsChangedPayload, 'source' >, touched?: string[] ) => void;
}

export function indexKeyFor( plugin: InstalledPlugin ): string {
	return plugin.textdomain || plugin.plugin;
}

export function isActiveStatus( status: string | undefined ): boolean {
	return status === 'active' || status === 'network-active';
}

export function describeError( err: unknown ): string {
	if ( err instanceof Error ) {
		return err.message;
	}
	return String( err );
}

export function fullPluginFile( plugin: string ): string {
	return plugin.endsWith( '.php' ) ? plugin : plugin + '.php';
}

export function pluginChangeId( pluginFile: string ): number {
	let crc = 0xffffffff;
	for ( let i = 0; i < pluginFile.length; i++ ) {
		crc ^= pluginFile.charCodeAt( i ) & 0xff;
		for ( let bit = 0; bit < 8; bit++ ) {
			crc = crc & 1 ? ( crc >>> 1 ) ^ 0xedb88320 : crc >>> 1;
		}
	}
	return Math.max( 1, ( crc ^ 0xffffffff ) >>> 0 );
}
