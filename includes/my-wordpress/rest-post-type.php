<?php
/**
 * OpenStation — My WordPress: REST bridge for non-REST post types.
 *
 * Post types registered with `show_in_rest => false` have no `wp/v2`
 * collection, so the site window cannot browse them the way it browses
 * Posts or Products. This module re-exposes them under
 * `desktop-mode/v1/post-type/<slug>` by subclassing Core's own
 * `WP_REST_Posts_Controller`, which means `_fields`, `_embed`,
 * `search`, `status`, `X-WP-Total` and `X-WP-TotalPages` all behave
 * exactly as they do on `wp/v2` — the bundle needs no special-casing,
 * only a different `restPath`.
 *
 * The controller itself lives in
 * `class-openstation-my-wordpress-post-type-controller.php`.
 *
 * ## Security
 *
 * These types opted out of REST deliberately, so the bridge is
 * deliberately narrower than Core's controller:
 *
 *   - Core's `get_items_permissions_check()` returns true for any
 *     non-`edit` context, i.e. public read. We override it (and the
 *     single-item check) to require the type's `edit_posts` capability
 *     in **every** context. Never anonymous, never subscriber-readable.
 *   - Only `GET` collection, `GET` item, and `DELETE` item (trash, for
 *     recycle-bin parity) are registered. No create, no update — a
 *     write schema the type's author never vetted is a footgun.
 *   - `openstation_my_wordpress_post_type_rest_enabled` lets a site or
 *     the owning plugin veto the bridge per type.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register a bridge controller for every eligible non-REST post type.
 *
 * Runs on `rest_api_init`, which fires well after `init`, so post type
 * discovery is complete by the time this executes.
 *
 * @return void
 */
function openstation_my_wordpress_register_post_type_routes() {
	if ( ! openstation_my_wordpress_user_can_use() ) {
		return;
	}

	foreach ( openstation_my_wordpress_eligible_post_types() as $name => $post_type ) {
		if ( ! empty( $post_type->show_in_rest ) ) {
			continue;
		}
		if ( ! openstation_my_wordpress_post_type_is_bridged( $name ) ) {
			continue;
		}
		$controller = new OpenStation_My_WordPress_Post_Type_Controller( $name );
		$controller->register_routes();
	}
}
add_action( 'rest_api_init', 'openstation_my_wordpress_register_post_type_routes' );
