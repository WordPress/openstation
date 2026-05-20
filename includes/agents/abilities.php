<?php
/**
 * Desktop Mode — Agents: Desktop-Mode-specific Core abilities.
 *
 * Two abilities registered against Core's WordPress 6.9 Abilities API
 * so they show up in every agent runtime that reads the registry
 * (Dolly, Intelligence, this plugin's agents). Prefixed `dm_` per the
 * convention agreed on for Desktop-Mode-contributed primitives.
 *
 *   - dm/get-post-by-id  — read a post's full record by numeric id.
 *   - dm/update-post     — update title / content / excerpt / status
 *                          on an existing post.
 *
 * Both gate execution on the standard `read_post` / `edit_post` caps —
 * an agent can only call them with the access its synthetic user is
 * granted. No `current_user_can()` short-circuits, no parallel ACL.
 *
 * @package WPDesktopMode
 * @since   0.23.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the `dm_*` abilities on the Core API's init action.
 *
 * Core's `wp_register_ability()` does_it_wrong's any caller outside
 * `wp_abilities_api_init`, so we always wait for the hook.
 *
 * @since 0.23.0
 *
 * @return void
 */
/**
 * Register the `desktop-mode` ability category. Core requires every
 * ability to declare a category, and categories must be registered
 * on `wp_abilities_api_categories_init` — separate from the ability
 * registration action.
 *
 * @since 0.23.0
 *
 * @return void
 */
function desktop_mode_agents_register_dm_ability_category() {
	if ( ! function_exists( 'wp_register_ability_category' ) ) {
		return;
	}
	wp_register_ability_category(
		'desktop-mode',
		array(
			'label'       => __( 'Desktop Mode', 'desktop-mode' ),
			'description' => __( 'Abilities contributed by the Desktop Mode plugin.', 'desktop-mode' ),
		)
	);
}
add_action( 'wp_abilities_api_categories_init', 'desktop_mode_agents_register_dm_ability_category' );

function desktop_mode_agents_register_dm_abilities() {
	if ( ! function_exists( 'wp_register_ability' ) ) {
		return;
	}

	wp_register_ability(
		'dm/get-post-by-id',
		array(
			'label'               => __( 'Get post by id', 'desktop-mode' ),
			'description'         => __(
				'Return a post — title, content, excerpt, status, author, dates — by its numeric id. Honours the caller\'s read capability.',
				'desktop-mode'
			),
			'category'            => 'desktop-mode',
			'input_schema'        => array(
				'type'       => 'object',
				'properties' => array(
					'post_id' => array(
						'type'        => 'integer',
						'description' => __( 'The post id to fetch.', 'desktop-mode' ),
					),
				),
				'required'   => array( 'post_id' ),
			),
			'output_schema'       => array(
				'type'       => 'object',
				'properties' => array(
					'id'       => array( 'type' => 'integer' ),
					'title'    => array( 'type' => 'string' ),
					'content'  => array( 'type' => 'string' ),
					'excerpt'  => array( 'type' => 'string' ),
					'status'   => array( 'type' => 'string' ),
					'type'     => array( 'type' => 'string' ),
					'author'   => array( 'type' => 'integer' ),
					'date'     => array( 'type' => 'string' ),
					'modified' => array( 'type' => 'string' ),
					'link'     => array( 'type' => 'string' ),
				),
			),
			'execute_callback'    => 'desktop_mode_agents_ability_get_post_by_id',
			'permission_callback' => 'desktop_mode_agents_ability_get_post_by_id_can',
		)
	);

	wp_register_ability(
		'dm/update-post',
		array(
			'label'               => __( 'Update post', 'desktop-mode' ),
			'description'         => __(
				'Update fields on an existing post. Accepts any subset of title / content / excerpt / status. Honours edit_post capability.',
				'desktop-mode'
			),
			'category'            => 'desktop-mode',
			'input_schema'        => array(
				'type'       => 'object',
				'properties' => array(
					'post_id' => array(
						'type'        => 'integer',
						'description' => __( 'The post id to update.', 'desktop-mode' ),
					),
					'title'   => array(
						'type'        => 'string',
						'description' => __( 'New post title.', 'desktop-mode' ),
					),
					'content' => array(
						'type'        => 'string',
						'description' => __( 'New post content (HTML / block markup).', 'desktop-mode' ),
					),
					'excerpt' => array(
						'type'        => 'string',
						'description' => __( 'New post excerpt.', 'desktop-mode' ),
					),
					'status'  => array(
						'type'        => 'string',
						'enum'        => array( 'publish', 'draft', 'pending', 'private', 'future' ),
						'description' => __( 'New post status.', 'desktop-mode' ),
					),
				),
				'required'   => array( 'post_id' ),
			),
			'output_schema'       => array(
				'type'       => 'object',
				'properties' => array(
					'id'      => array( 'type' => 'integer' ),
					'updated' => array( 'type' => 'boolean' ),
				),
			),
			'execute_callback'    => 'desktop_mode_agents_ability_update_post',
			'permission_callback' => 'desktop_mode_agents_ability_update_post_can',
		)
	);
}
add_action( 'wp_abilities_api_init', 'desktop_mode_agents_register_dm_abilities' );

/**
 * `dm/get-post-by-id` execute callback.
 *
 * @since 0.23.0
 *
 * @param array $args Validated input (already passed through the schema).
 * @return array|WP_Error
 */
function desktop_mode_agents_ability_get_post_by_id( $args ) {
	$post_id = isset( $args['post_id'] ) ? (int) $args['post_id'] : 0;
	if ( $post_id <= 0 ) {
		return new WP_Error( 'dm_invalid_post_id', __( 'A positive post id is required.', 'desktop-mode' ) );
	}
	$post = get_post( $post_id );
	if ( ! ( $post instanceof WP_Post ) ) {
		return new WP_Error( 'dm_post_not_found', __( 'Post not found.', 'desktop-mode' ) );
	}
	return array(
		'id'       => (int) $post->ID,
		'title'    => (string) $post->post_title,
		'content'  => (string) $post->post_content,
		'excerpt'  => (string) $post->post_excerpt,
		'status'   => (string) $post->post_status,
		'type'     => (string) $post->post_type,
		'author'   => (int) $post->post_author,
		'date'     => (string) $post->post_date_gmt,
		'modified' => (string) $post->post_modified_gmt,
		'link'     => (string) get_permalink( $post ),
	);
}

/**
 * `dm/get-post-by-id` permission callback.
 *
 * @since 0.23.0
 *
 * @param array $args Input args.
 * @return bool
 */
function desktop_mode_agents_ability_get_post_by_id_can( $args ) {
	$post_id = isset( $args['post_id'] ) ? (int) $args['post_id'] : 0;
	if ( $post_id <= 0 ) {
		return false;
	}
	return current_user_can( 'read_post', $post_id );
}

/**
 * `dm/update-post` execute callback.
 *
 * @since 0.23.0
 *
 * @param array $args Validated input.
 * @return array|WP_Error
 */
function desktop_mode_agents_ability_update_post( $args ) {
	$post_id = isset( $args['post_id'] ) ? (int) $args['post_id'] : 0;
	if ( $post_id <= 0 ) {
		return new WP_Error( 'dm_invalid_post_id', __( 'A positive post id is required.', 'desktop-mode' ) );
	}
	if ( ! get_post( $post_id ) ) {
		return new WP_Error( 'dm_post_not_found', __( 'Post not found.', 'desktop-mode' ) );
	}

	$update = array( 'ID' => $post_id );
	if ( isset( $args['title'] ) ) {
		$update['post_title'] = sanitize_text_field( (string) $args['title'] );
	}
	if ( isset( $args['content'] ) ) {
		$update['post_content'] = wp_kses_post( (string) $args['content'] );
	}
	if ( isset( $args['excerpt'] ) ) {
		$update['post_excerpt'] = sanitize_text_field( (string) $args['excerpt'] );
	}
	if ( isset( $args['status'] ) ) {
		$status = sanitize_key( (string) $args['status'] );
		if ( ! in_array( $status, array( 'publish', 'draft', 'pending', 'private', 'future' ), true ) ) {
			return new WP_Error( 'dm_invalid_status', __( 'Invalid status.', 'desktop-mode' ) );
		}
		$update['post_status'] = $status;
	}

	$result = wp_update_post( $update, true );
	if ( is_wp_error( $result ) ) {
		return $result;
	}
	return array(
		'id'      => (int) $result,
		'updated' => true,
	);
}

/**
 * `dm/update-post` permission callback.
 *
 * @since 0.23.0
 *
 * @param array $args Input args.
 * @return bool
 */
function desktop_mode_agents_ability_update_post_can( $args ) {
	$post_id = isset( $args['post_id'] ) ? (int) $args['post_id'] : 0;
	if ( $post_id <= 0 ) {
		return false;
	}
	return current_user_can( 'edit_post', $post_id );
}
