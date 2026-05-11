<?php
/**
 * Desktop Mode — Content Graph: per-user preferences.
 *
 * Persists per-user UI state for the Content Graph window: which
 * lens is active, which taxonomy drives Galaxy clustering, and per-
 * lens edge-toggle + post-type-chip state. Backs the toolbar's
 * "remember my last view" behavior so reopening the window doesn't
 * reset choices.
 *
 * Mirrors the os-settings.php pattern: defaults helper, getter that
 * always returns a fully-shaped array, sanitizer that merges client
 * payload with defaults, REST GET/POST routes under
 * `desktop-mode/v1/content-graph/preferences`. State is stored in a
 * single user-meta entry so a single `update_user_meta` call writes
 * the whole snapshot.
 *
 * @package WPDesktopMode
 * @since   0.9.0
 */

defined( 'ABSPATH' ) || exit;

/** User-meta key for Content Graph preferences. */
const DESKTOP_MODE_CONTENT_GRAPH_PREFS_META_KEY = 'desktop_mode_content_graph_prefs';

/** Lens IDs the front end recognises. */
const DESKTOP_MODE_CONTENT_GRAPH_LENSES = array( 'constellation', 'galaxy' );

/**
 * Default preferences for a fresh user.
 *
 * Mirrors the per-lens default-edge-visibility decision in the plan:
 * Constellation defaults to hyperlinks only (preserves today's
 * behavior). Galaxy defaults to hyperlinks plus co-tag (the bridge-
 * highlighting story).
 *
 * @since 0.9.0
 *
 * @return array
 */
function desktop_mode_content_graph_default_prefs() {
	return array(
		'lens'   => 'constellation',
		'byLens' => array(
			'constellation' => array(
				'types' => array(),
				'edges' => array( 'link' ),
			),
			'galaxy'        => array(
				'types'    => array(),
				'edges'    => array( 'link', 'co_tag' ),
				'taxonomy' => 'category',
			),
		),
	);
}

/**
 * Load and return a fully-shaped preferences array for a user.
 *
 * @since 0.9.0
 *
 * @param int $user_id
 * @return array
 */
function desktop_mode_content_graph_get_prefs( $user_id ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return desktop_mode_content_graph_default_prefs();
	}
	$raw = get_user_meta( $user_id, DESKTOP_MODE_CONTENT_GRAPH_PREFS_META_KEY, true );
	if ( ! is_array( $raw ) ) {
		return desktop_mode_content_graph_default_prefs();
	}
	return desktop_mode_content_graph_sanitize_prefs( $raw );
}

/**
 * Sanitize and persist a partial or full preferences payload, merging
 * with whatever is currently stored so a partial save (e.g., only
 * `lens`) doesn't wipe the rest.
 *
 * @since 0.9.0
 *
 * @param int   $user_id
 * @param mixed $patch Raw client payload.
 * @return array Merged + sanitized prefs (the new authoritative value).
 */
function desktop_mode_content_graph_save_prefs( $user_id, $patch ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return desktop_mode_content_graph_default_prefs();
	}
	$current = desktop_mode_content_graph_get_prefs( $user_id );
	$merged  = desktop_mode_content_graph_merge_prefs( $current, is_array( $patch ) ? $patch : array() );
	$clean   = desktop_mode_content_graph_sanitize_prefs( $merged );
	update_user_meta( $user_id, DESKTOP_MODE_CONTENT_GRAPH_PREFS_META_KEY, $clean );
	return $clean;
}

/**
 * Shallow merge that preserves per-lens sub-fields not present in the
 * patch. Per-lens entries on `byLens` are merged at one level deeper
 * so a patch like `{ byLens: { galaxy: { taxonomy: 'post_tag' } } }`
 * does not wipe `galaxy.types` or `galaxy.edges`.
 *
 * @since 0.9.0
 *
 * @param array $current
 * @param array $patch
 * @return array
 */
function desktop_mode_content_graph_merge_prefs( array $current, array $patch ) {
	$out = $current;
	if ( isset( $patch['lens'] ) ) {
		$out['lens'] = $patch['lens'];
	}
	if ( isset( $patch['byLens'] ) && is_array( $patch['byLens'] ) ) {
		foreach ( $patch['byLens'] as $lens_id => $lens_patch ) {
			if ( ! is_array( $lens_patch ) ) {
				continue;
			}
			$existing = isset( $out['byLens'][ $lens_id ] ) && is_array( $out['byLens'][ $lens_id ] )
				? $out['byLens'][ $lens_id ]
				: array();
			$out['byLens'][ $lens_id ] = array_merge( $existing, $lens_patch );
		}
	}
	return $out;
}

/**
 * Sanitize a (possibly malicious) preferences payload back to a
 * known-good shape. Unknown lens IDs, unknown edge kinds, unknown
 * post-type slugs, and unknown taxonomies are dropped silently.
 *
 * @since 0.9.0
 *
 * @param array $raw
 * @return array
 */
function desktop_mode_content_graph_sanitize_prefs( $raw ) {
	$defaults = desktop_mode_content_graph_default_prefs();
	if ( ! is_array( $raw ) ) {
		return $defaults;
	}

	// Lens.
	$lens = $defaults['lens'];
	if (
		isset( $raw['lens'] )
		&& is_string( $raw['lens'] )
		&& in_array( $raw['lens'], DESKTOP_MODE_CONTENT_GRAPH_LENSES, true )
	) {
		$lens = (string) $raw['lens'];
	}

	$allowed_kinds = array_flip( desktop_mode_content_graph_edge_kinds() );

	$registered_post_types = array_flip(
		(array) wp_list_pluck( desktop_mode_content_graph_post_types(), 'slug' )
	);

	$registered_taxonomies = array_flip(
		(array) get_taxonomies( array( 'public' => true ), 'names' )
	);

	$by_lens = $defaults['byLens'];

	if ( isset( $raw['byLens'] ) && is_array( $raw['byLens'] ) ) {
		foreach ( $raw['byLens'] as $lens_id => $lens_state ) {
			if ( ! is_string( $lens_id ) || ! in_array( $lens_id, DESKTOP_MODE_CONTENT_GRAPH_LENSES, true ) ) {
				continue;
			}
			if ( ! is_array( $lens_state ) ) {
				continue;
			}
			$entry = isset( $by_lens[ $lens_id ] ) ? $by_lens[ $lens_id ] : array();

			// Post-type slugs.
			if ( isset( $lens_state['types'] ) && is_array( $lens_state['types'] ) ) {
				$cleaned = array();
				foreach ( $lens_state['types'] as $slug ) {
					if ( ! is_string( $slug ) ) {
						continue;
					}
					$slug = sanitize_key( $slug );
					if ( '' !== $slug && isset( $registered_post_types[ $slug ] ) ) {
						$cleaned[ $slug ] = true;
					}
					if ( count( $cleaned ) >= 32 ) {
						break;
					}
				}
				$entry['types'] = array_keys( $cleaned );
			}

			// Edge kinds.
			if ( isset( $lens_state['edges'] ) && is_array( $lens_state['edges'] ) ) {
				$cleaned = array();
				foreach ( $lens_state['edges'] as $kind ) {
					if ( ! is_string( $kind ) ) {
						continue;
					}
					$kind = sanitize_key( $kind );
					if ( '' !== $kind && isset( $allowed_kinds[ $kind ] ) ) {
						$cleaned[ $kind ] = true;
					}
				}
				$entry['edges'] = array_keys( $cleaned );
			}

			// Galaxy-only: taxonomy slug.
			if ( 'galaxy' === $lens_id && isset( $lens_state['taxonomy'] ) && is_string( $lens_state['taxonomy'] ) ) {
				$slug = sanitize_key( $lens_state['taxonomy'] );
				if ( '' !== $slug && isset( $registered_taxonomies[ $slug ] ) ) {
					$entry['taxonomy'] = $slug;
				}
			}

			$by_lens[ $lens_id ] = $entry;
		}
	}

	return array(
		'lens'   => $lens,
		'byLens' => $by_lens,
	);
}

/**
 * Permission callback for the prefs REST routes. Mirrors the broader
 * Content Graph capability gate so users who can't see the window
 * can't write preferences for it either.
 *
 * @since 0.9.0
 *
 * @return bool
 */
function desktop_mode_content_graph_prefs_rest_permission() {
	return is_user_logged_in() && desktop_mode_content_graph_user_can_use();
}

/**
 * Register the prefs REST routes.
 *
 * @since 0.9.0
 */
function desktop_mode_content_graph_register_prefs_routes() {
	register_rest_route(
		'desktop-mode/v1',
		'/content-graph/preferences',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => 'desktop_mode_content_graph_rest_get_prefs',
				'permission_callback' => 'desktop_mode_content_graph_prefs_rest_permission',
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => 'desktop_mode_content_graph_rest_save_prefs',
				'permission_callback' => 'desktop_mode_content_graph_prefs_rest_permission',
				'args'                => array(
					'preferences' => array(
						'required' => true,
						'type'     => 'object',
					),
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'desktop_mode_content_graph_register_prefs_routes' );

/**
 * GET /desktop-mode/v1/content-graph/preferences
 *
 * @since 0.9.0
 *
 * @return WP_REST_Response
 */
function desktop_mode_content_graph_rest_get_prefs() {
	return rest_ensure_response( desktop_mode_content_graph_get_prefs( get_current_user_id() ) );
}

/**
 * POST /desktop-mode/v1/content-graph/preferences
 *
 * @since 0.9.0
 *
 * @param WP_REST_Request $request
 * @return WP_REST_Response
 */
function desktop_mode_content_graph_rest_save_prefs( WP_REST_Request $request ) {
	$user_id = get_current_user_id();
	$payload = $request->get_param( 'preferences' );
	return rest_ensure_response( desktop_mode_content_graph_save_prefs( $user_id, $payload ) );
}

/**
 * Build a descriptor list of public taxonomies eligible for Galaxy
 * clustering. Mirrors the post-types descriptor shape so the JS side
 * can render dropdown options without an extra REST round-trip.
 *
 * @since 0.9.0
 *
 * @return array[] Each entry: `array( 'slug', 'label', 'hierarchical', 'post_types' )`.
 */
function desktop_mode_content_graph_taxonomies() {
	$taxes  = get_taxonomies( array( 'public' => true ), 'objects' );
	$result = array();
	foreach ( $taxes as $tax ) {
		$result[] = array(
			'slug'         => (string) $tax->name,
			'label'        => (string) $tax->labels->name,
			'hierarchical' => (bool) $tax->hierarchical,
			'post_types'   => array_values( (array) $tax->object_type ),
		);
	}

	/**
	 * Filter the list of taxonomies offered as Galaxy clustering keys.
	 * Each entry must declare `slug`, `label`, `hierarchical`, and
	 * `post_types`. Removing an entry hides it from the dropdown AND
	 * from the prefs sanitizer's allow-list.
	 *
	 * @since 0.9.0
	 *
	 * @param array[] $result Default: every public taxonomy.
	 */
	$filtered = apply_filters( 'desktop_mode_content_graph_taxonomies', $result );
	return is_array( $filtered ) ? array_values( $filtered ) : $result;
}

/**
 * Build a descriptor list of edge kinds offered to the toolbar's edges
 * multi-toggle. Each entry carries display metadata and the wire slug
 * used by the REST layer.
 *
 * @since 0.9.0
 *
 * @return array[] Each entry: `array( 'slug', 'label', 'color', 'weight' )`.
 */
function desktop_mode_content_graph_edge_kind_descriptors() {
	$result = array(
		array(
			'slug'   => 'link',
			'label'  => __( 'Hyperlinks', 'desktop-mode' ),
			'color'  => '#6b7280',
			'weight' => 0.7,
		),
		array(
			'slug'   => 'co_tag',
			'label'  => __( 'Shared terms', 'desktop-mode' ),
			'color'  => '#2c6be5',
			'weight' => 0.7,
		),
		array(
			'slug'   => 'co_author',
			'label'  => __( 'Same author', 'desktop-mode' ),
			'color'  => '#7c3aed',
			'weight' => 0.7,
		),
		array(
			'slug'   => 'hierarchy',
			'label'  => __( 'Page hierarchy', 'desktop-mode' ),
			'color'  => '#059669',
			'weight' => 0.7,
		),
		array(
			'slug'   => 'menu',
			'label'  => __( 'Menu structure', 'desktop-mode' ),
			'color'  => '#d97706',
			'weight' => 0.7,
		),
	);

	/**
	 * Filter the edge-kind descriptors offered to the toolbar's edges
	 * multi-toggle. Removing an entry hides it from the toggle UI but
	 * does NOT prevent the server-side build from emitting that kind.
	 *
	 * @since 0.9.0
	 *
	 * @param array[] $result Default: link, co_tag, co_author, hierarchy, menu.
	 */
	$filtered = apply_filters( 'desktop_mode_content_graph_edge_kind_descriptors', $result );
	return is_array( $filtered ) ? array_values( $filtered ) : $result;
}
