/**
 * Shared types for the Extensions marketplace settings section.
 *
 * These mirror the shapes the PHP REST endpoints emit
 * (`includes/marketplace/manifest.php` →
 * `desktop_mode_marketplace_get_extensions()`). Keep in sync with that
 * function's return value.
 */

export interface MarketplaceExtension {
	slug: string;
	name: string;
	short_description: string;
	icon: string | null;
	homepage: string;
	environments?: string[];
	version?: string;
	requires_wp?: string;
	requires_php?: string;
	download_url?: string;

	// Augmented server-side from get_plugins().
	installed: boolean;
	active: boolean;
	installed_version: string | null;
	needs_update: boolean;
	plugin_file: string | null;
	incompatible_environment: boolean;
}

export interface MarketplaceListResponse {
	generated_at: string;
	release_tag: string;
	current_environment: string;
	extensions: MarketplaceExtension[];
	can_modify: boolean;
	manifest_url: string;
}

/** Action verbs accepted by `/wp-desktop/v1/marketplace/<verb>`. */
export type MarketplaceAction =
	| 'install'
	| 'update'
	| 'activate'
	| 'deactivate'
	| 'delete';

export interface MarketplaceState {
	loading: boolean;
	error: string;
	data: MarketplaceListResponse | null;
	/** Set of slugs with an in-flight mutation. */
	busy: Set< string >;
}
