<?php
/**
 * Desktop Mode — Agents: abilities bridge.
 *
 * Two halves:
 *
 * 1. Registers the agent-oriented abilities against Core's Abilities
 *    API: `desktop-mode/get-post` and `desktop-mode/get-media`
 *    (read-only) plus `desktop-mode/update-post` (mutating). The
 *    `desktop-mode` category ships from the AI Copilot module
 *    (always loaded), so this file only adds abilities to it. The
 *    read abilities carry the `readonly` annotation and therefore
 *    also become available to the AI Copilot assistant; the update
 *    ability does not — it is reachable only through an agent whose
 *    allowlist includes it.
 *
 * 2. Provides the abilities catalogue the picker UI consumes: every
 *    ability registered on the site, projected to
 *    `{ slug, label, description, category, readonly }`. Unlike the
 *    Copilot (which advertises only read-only abilities), agents may
 *    be granted mutating abilities — that is the point. The
 *    compensating controls are the explicit per-agent allowlist set by
 *    an `edit_users` human, the agent's role, and each ability's own
 *    `permission_callback` evaluated against the agent user.
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Registers the agent-oriented abilities.
 *
 * @return void
 */
function desktop_mode_agents_register_abilities() {
	if ( ! function_exists( 'wp_register_ability' ) ) {
		return;
	}

	wp_register_ability(
		'desktop-mode/get-post',
		array(
			'label'               => __( 'Get post by id', 'desktop-mode' ),
			'description'         => 'Return a post — title, content, excerpt, status, author, dates — by its numeric id. Honours the caller\'s read capability.',
			'category'            => DESKTOP_MODE_AI_ABILITY_CATEGORY,
			'input_schema'        => array(
				'type'                 => 'object',
				'additionalProperties' => false,
				'required'             => array( 'post_id' ),
				'properties'           => array(
					'post_id' => array(
						'type'        => 'integer',
						'description' => 'The post id to fetch.',
					),
				),
			),
			'output_schema'       => desktop_mode_ai_ability_output_schema(
				array(
					'id'      => array( 'type' => 'integer' ),
					'title'   => array( 'type' => 'string' ),
					'content' => array( 'type' => 'string' ),
					'status'  => array( 'type' => 'string' ),
				)
			),
			'execute_callback'    => 'desktop_mode_agents_ability_get_post',
			'permission_callback' => 'desktop_mode_agents_ability_get_post_can',
			'meta'                => array(
				'annotations'  => array(
					'readonly'   => true,
					'idempotent' => true,
				),
				'show_in_rest' => true,
			),
		)
	);

	wp_register_ability(
		'desktop-mode/get-media',
		array(
			'label'               => __( 'Get media details', 'desktop-mode' ),
			'description'         => 'Return details for a media library item (attachment) by numeric id: file URL, mime type, dimensions, alt text, caption, and the post it is attached to. Use this to read images or other media referenced by posts.',
			'category'            => DESKTOP_MODE_AI_ABILITY_CATEGORY,
			'input_schema'        => array(
				'type'                 => 'object',
				'additionalProperties' => false,
				'required'             => array( 'attachment_id' ),
				'properties'           => array(
					'attachment_id' => array(
						'type'        => 'integer',
						'description' => 'The attachment (media library) id.',
					),
				),
			),
			'output_schema'       => desktop_mode_ai_ability_output_schema(
				array(
					'id'   => array( 'type' => 'integer' ),
					'url'  => array( 'type' => 'string' ),
					'mime' => array( 'type' => 'string' ),
				)
			),
			'execute_callback'    => 'desktop_mode_agents_ability_get_media',
			'permission_callback' => 'desktop_mode_agents_ability_get_media_can',
			'meta'                => array(
				'annotations'  => array(
					'readonly'   => true,
					'idempotent' => true,
				),
				'show_in_rest' => true,
			),
		)
	);

	wp_register_ability(
		'desktop-mode/update-post',
		array(
			'label'               => __( 'Update post', 'desktop-mode' ),
			'description'         => 'Update fields on an existing post. Accepts any subset of title / content / excerpt / status. Honours the edit_post capability of the calling user.',
			'category'            => DESKTOP_MODE_AI_ABILITY_CATEGORY,
			'input_schema'        => array(
				'type'                 => 'object',
				'additionalProperties' => false,
				'required'             => array( 'post_id' ),
				'properties'           => array(
					'post_id' => array(
						'type'        => 'integer',
						'description' => 'The post id to update.',
					),
					'title'   => array(
						'type'        => 'string',
						'description' => 'New post title.',
					),
					'content' => array(
						'type'        => 'string',
						'description' => 'New post content (HTML / block markup).',
					),
					'excerpt' => array(
						'type'        => 'string',
						'description' => 'New post excerpt.',
					),
					'status'  => array(
						'type'        => 'string',
						'enum'        => array( 'publish', 'draft', 'pending', 'private' ),
						'description' => 'New post status.',
					),
				),
			),
			'output_schema'       => desktop_mode_ai_ability_output_schema(
				array(
					'id'      => array( 'type' => 'integer' ),
					'updated' => array( 'type' => 'boolean' ),
				)
			),
			'execute_callback'    => 'desktop_mode_agents_ability_update_post',
			'permission_callback' => 'desktop_mode_agents_ability_update_post_can',
			'meta'                => array(
				'show_in_rest' => true,
			),
		)
	);
}
add_action( 'wp_abilities_api_init', 'desktop_mode_agents_register_abilities' );

/**
 * `desktop-mode/get-post` execute callback.
 *
 * @param array $args Validated input.
 * @return array|WP_Error
 */
function desktop_mode_agents_ability_get_post( $args ) {
	$args    = (array) $args;
	$post_id = isset( $args['post_id'] ) ? (int) $args['post_id'] : 0;
	$post    = $post_id > 0 ? get_post( $post_id ) : null;
	if ( ! ( $post instanceof WP_Post ) ) {
		return new WP_Error( 'desktop_mode_agent_post_not_found', __( 'Post not found.', 'desktop-mode' ) );
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
 * `desktop-mode/get-post` permission callback.
 *
 * @param array $args Input args.
 * @return bool
 */
function desktop_mode_agents_ability_get_post_can( $args ) {
	$args    = (array) $args;
	$post_id = isset( $args['post_id'] ) ? (int) $args['post_id'] : 0;
	if ( $post_id <= 0 ) {
		return false;
	}
	return current_user_can( 'read_post', $post_id );
}

/**
 * `desktop-mode/get-media` execute callback.
 *
 * @param array $args Validated input.
 * @return array|WP_Error
 */
function desktop_mode_agents_ability_get_media( $args ) {
	$args          = (array) $args;
	$attachment_id = isset( $args['attachment_id'] ) ? (int) $args['attachment_id'] : 0;
	$post          = $attachment_id > 0 ? get_post( $attachment_id ) : null;
	if ( ! ( $post instanceof WP_Post ) || 'attachment' !== $post->post_type ) {
		return new WP_Error( 'desktop_mode_agent_media_not_found', __( 'Attachment not found.', 'desktop-mode' ) );
	}

	$meta = wp_get_attachment_metadata( $attachment_id );
	if ( ! is_array( $meta ) ) {
		$meta = array();
	}

	return array(
		'id'         => (int) $post->ID,
		'title'      => (string) $post->post_title,
		'url'        => (string) wp_get_attachment_url( $attachment_id ),
		'mime'       => (string) get_post_mime_type( $post ),
		'width'      => isset( $meta['width'] ) ? (int) $meta['width'] : null,
		'height'     => isset( $meta['height'] ) ? (int) $meta['height'] : null,
		'filesize'   => isset( $meta['filesize'] ) ? (int) $meta['filesize'] : null,
		'alt'        => (string) get_post_meta( $attachment_id, '_wp_attachment_image_alt', true ),
		'caption'    => (string) $post->post_excerpt,
		'date'       => (string) $post->post_date_gmt,
		'attachedTo' => (int) $post->post_parent,
	);
}

/**
 * `desktop-mode/get-media` permission callback.
 *
 * Gates on `upload_files` (author+), deliberately NOT on `read_post`:
 * for `inherit`-status attachments that check defers to the parent
 * post (and effectively requires edit rights when unattached), which
 * wrongly blocks read-only access to media whose file URL is public
 * on a standard site anyway.
 *
 * @param array $args Input args.
 * @return bool
 */
function desktop_mode_agents_ability_get_media_can( $args ) {
	$args          = (array) $args;
	$attachment_id = isset( $args['attachment_id'] ) ? (int) $args['attachment_id'] : 0;
	if ( $attachment_id <= 0 ) {
		return false;
	}
	return current_user_can( 'upload_files' );
}

/**
 * `desktop-mode/update-post` execute callback.
 *
 * @param array $args Validated input.
 * @return array|WP_Error
 */
function desktop_mode_agents_ability_update_post( $args ) {
	$args    = (array) $args;
	$post_id = isset( $args['post_id'] ) ? (int) $args['post_id'] : 0;
	if ( $post_id <= 0 || ! get_post( $post_id ) ) {
		return new WP_Error( 'desktop_mode_agent_post_not_found', __( 'Post not found.', 'desktop-mode' ) );
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
		if ( ! in_array( $status, array( 'publish', 'draft', 'pending', 'private' ), true ) ) {
			return new WP_Error( 'desktop_mode_agent_invalid_status', __( 'Invalid post status.', 'desktop-mode' ) );
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
 * `desktop-mode/update-post` permission callback.
 *
 * Publishing needs `publish_posts` on top of `edit_post` — the same
 * split wp-admin enforces on a human editor.
 *
 * @param array $args Input args.
 * @return bool
 */
function desktop_mode_agents_ability_update_post_can( $args ) {
	$args    = (array) $args;
	$post_id = isset( $args['post_id'] ) ? (int) $args['post_id'] : 0;
	if ( $post_id <= 0 || ! current_user_can( 'edit_post', $post_id ) ) {
		return false;
	}
	if ( isset( $args['status'] ) && 'publish' === $args['status'] && ! current_user_can( 'publish_posts' ) ) {
		return false;
	}
	return true;
}

/**
 * Catalogue of abilities exposed to the agents picker.
 *
 * Primary source: Core's Abilities API (`wp_get_abilities()`) — every
 * ability the site registered, Core's, this plugin's, or any third
 * party's, projected into the picker shape with an honest
 * readonly/mutating badge derived from `meta.annotations.readonly`.
 *
 * @return array<int, array{slug:string, label:string, description:string, category:string, readonly:bool}>
 */
function desktop_mode_agents_abilities_catalogue() {
	$catalogue = array();

	if ( function_exists( 'wp_get_abilities' ) ) {
		foreach ( wp_get_abilities() as $ability ) {
			if ( ! $ability instanceof WP_Ability ) {
				continue;
			}
			$meta        = (array) $ability->get_meta();
			$annotations = isset( $meta['annotations'] ) && is_array( $meta['annotations'] ) ? $meta['annotations'] : array();

			$catalogue[] = array(
				'slug'        => (string) $ability->get_name(),
				'label'       => (string) $ability->get_label(),
				'description' => (string) $ability->get_description(),
				'category'    => (string) $ability->get_category(),
				'readonly'    => ! empty( $annotations['readonly'] ),
			);
		}
	}

	/**
	 * Filter the catalogue of abilities exposed to the agents picker.
	 *
	 * Sites can narrow the pickable set (drop rows) or append
	 * Desktop-Mode-only entries. The preferred extension path stays
	 * `wp_register_ability()` so every agent runtime sees the same
	 * registry.
	 *
	 * @param array $catalogue Abilities projected from `wp_get_abilities()`.
	 */
	$catalogue = apply_filters( 'desktop_mode_agent_abilities_catalogue', $catalogue );
	if ( ! is_array( $catalogue ) ) {
		return array();
	}

	$seen = array();
	$out  = array();
	foreach ( $catalogue as $row ) {
		if ( ! is_array( $row ) || empty( $row['slug'] ) ) {
			continue;
		}
		$slug = sanitize_text_field( (string) $row['slug'] );
		if ( '' === $slug || isset( $seen[ $slug ] ) ) {
			continue;
		}
		$seen[ $slug ] = true;
		$out[]         = array(
			'slug'        => $slug,
			'label'       => isset( $row['label'] ) && '' !== (string) $row['label'] ? (string) $row['label'] : $slug,
			'description' => isset( $row['description'] ) ? (string) $row['description'] : '',
			'category'    => isset( $row['category'] ) ? (string) $row['category'] : '',
			'readonly'    => ! empty( $row['readonly'] ),
		);
	}
	return $out;
}
