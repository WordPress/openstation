<?php
/**
 * Desktop Mode — Extensions marketplace: REST routes.
 *
 * Routes under `wp-desktop/v1/marketplace/`:
 *
 *   GET  /extensions   — merged manifest + installed-state list
 *   POST /install      — { slug }
 *   POST /update       — { slug }
 *   POST /activate     — { slug }
 *   POST /deactivate   — { slug }
 *   POST /delete       — { slug }
 *   POST /refresh      — bust the manifest cache
 *
 * The list endpoint is gated by `read` so subsite admins on multisite
 * (who lack `install_plugins`) can browse the catalog read-only —
 * mutations are gated by the full plugin-management capability set.
 *
 * @since 0.6.0
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Permission: any logged-in user with admin access (we surface this
 * tab only to admins client-side; on multisite this still admits a
 * subsite admin who can read but not write).
 *
 * @since 0.6.0
 */
function desktop_mode_marketplace_rest_read_permission() {
	if ( ! is_user_logged_in() || ! current_user_can( 'manage_options' ) ) {
		return new WP_Error(
			'desktop_mode_marketplace_forbidden',
			__( 'Only administrators can browse the extensions marketplace.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}
	return true;
}

/**
 * Permission: full plugin-management cap — gates mutations.
 *
 * @since 0.6.0
 */
function desktop_mode_marketplace_rest_write_permission() {
	if ( ! is_user_logged_in() || ! desktop_mode_marketplace_user_can_modify() ) {
		return new WP_Error(
			'desktop_mode_marketplace_forbidden',
			__( 'You do not have permission to install or modify extensions.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}
	return true;
}

/**
 * Standard slug arg shape — single string, sanitized.
 *
 * @since 0.6.0
 */
function desktop_mode_marketplace_slug_arg() {
	return array(
		'required'          => true,
		'type'              => 'string',
		'sanitize_callback' => 'sanitize_key',
	);
}

/**
 * Registers the marketplace REST namespace.
 *
 * @since 0.6.0
 */
function desktop_mode_marketplace_register_rest_routes() {
	$ns = 'wp-desktop/v1';

	register_rest_route(
		$ns,
		'/marketplace/extensions',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'desktop_mode_marketplace_rest_list',
			'permission_callback' => 'desktop_mode_marketplace_rest_read_permission',
		)
	);

	register_rest_route(
		$ns,
		'/marketplace/refresh',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'desktop_mode_marketplace_rest_refresh',
			'permission_callback' => 'desktop_mode_marketplace_rest_read_permission',
		)
	);

	$mutations = array(
		'install'    => 'desktop_mode_marketplace_install_extension',
		'update'     => 'desktop_mode_marketplace_update_extension',
		'activate'   => 'desktop_mode_marketplace_activate_extension',
		'deactivate' => 'desktop_mode_marketplace_deactivate_extension',
		'delete'     => 'desktop_mode_marketplace_delete_extension',
	);
	foreach ( $mutations as $route => $handler ) {
		register_rest_route(
			$ns,
			'/marketplace/' . $route,
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => function ( WP_REST_Request $request ) use ( $handler ) {
					$slug = (string) $request->get_param( 'slug' );
					$result = call_user_func( $handler, $slug );
					if ( is_wp_error( $result ) ) {
						return $result;
					}
					return rest_ensure_response(
						array(
							'extension' => $result,
						)
					);
				},
				'permission_callback' => 'desktop_mode_marketplace_rest_write_permission',
				'args'                => array(
					'slug' => desktop_mode_marketplace_slug_arg(),
				),
			)
		);
	}
}
add_action( 'rest_api_init', 'desktop_mode_marketplace_register_rest_routes' );

/**
 * GET /marketplace/extensions
 *
 * @since 0.6.0
 *
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_marketplace_rest_list() {
	$result = desktop_mode_marketplace_get_extensions();
	if ( is_wp_error( $result ) ) {
		return $result;
	}
	$result['can_modify'] = desktop_mode_marketplace_user_can_modify();
	$result['manifest_url'] = desktop_mode_marketplace_manifest_url();
	return rest_ensure_response( $result );
}

/**
 * POST /marketplace/refresh
 *
 * @since 0.6.0
 *
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_marketplace_rest_refresh() {
	desktop_mode_marketplace_clear_cache();
	$manifest = desktop_mode_marketplace_fetch_manifest( true );
	if ( is_wp_error( $manifest ) ) {
		return $manifest;
	}
	return desktop_mode_marketplace_rest_list();
}
