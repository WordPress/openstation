<?php

defined( 'ABSPATH' ) || exit;

function openstation_agents_register_abilities() {
	if ( ! function_exists( 'wp_register_ability' ) ) {
		return;
	}

	wp_register_ability(
		'desktop-mode/get-post',
		array(
			'label'               => __( 'Get post by id', 'desktop-mode' ),

			'description'         => 'Return a post — title, content, excerpt, status, author, dates — by its numeric id. `content` is the RAW stored content exactly as saved, with block delimiter comments (`<!-- wp:… -->`) intact; it is never rendered output, so it is safe to edit and write back. Honours the caller\'s read capability.',
			'category'            => OPENSTATION_AI_ABILITY_CATEGORY,
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
			'output_schema'       => openstation_ai_ability_output_schema(
				array(
					'id'      => array( 'type' => 'integer' ),
					'title'   => array( 'type' => 'string' ),
					'content' => array( 'type' => 'string' ),
					'status'  => array( 'type' => 'string' ),
				)
			),
			'execute_callback'    => 'openstation_agents_ability_get_post',
			'permission_callback' => 'openstation_agents_ability_get_post_can',
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
			'category'            => OPENSTATION_AI_ABILITY_CATEGORY,
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
			'output_schema'       => openstation_ai_ability_output_schema(
				array(
					'id'   => array( 'type' => 'integer' ),
					'url'  => array( 'type' => 'string' ),
					'mime' => array( 'type' => 'string' ),
				)
			),
			'execute_callback'    => 'openstation_agents_ability_get_media',
			'permission_callback' => 'openstation_agents_ability_get_media_can',
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
		'desktop-mode/update-media',
		array(
			'label'               => __( 'Update media details', 'desktop-mode' ),
			'description'         => 'Update metadata on a media library item (attachment): alt text, title, caption, and/or description. The file itself is never touched. Honours the edit capability on the attachment.',
			'category'            => OPENSTATION_AI_ABILITY_CATEGORY,
			'input_schema'        => array(
				'type'                 => 'object',
				'additionalProperties' => false,
				'required'             => array( 'attachment_id' ),
				'properties'           => array(
					'attachment_id' => array(
						'type'        => 'integer',
						'description' => 'The attachment (media library) id.',
					),
					'alt_text'      => array(
						'type'        => 'string',
						'description' => 'New alternative text for the image (plain text, describing what the image shows).',
					),
					'title'         => array(
						'type'        => 'string',
						'description' => 'New attachment title.',
					),
					'caption'       => array(
						'type'        => 'string',
						'description' => 'New caption.',
					),
					'description'   => array(
						'type'        => 'string',
						'description' => 'New description.',
					),
				),
			),
			'output_schema'       => openstation_ai_ability_output_schema(
				array(
					'id'      => array( 'type' => 'integer' ),
					'updated' => array( 'type' => 'boolean' ),
				)
			),
			'execute_callback'    => 'openstation_agents_ability_update_media',
			'permission_callback' => 'openstation_agents_ability_update_media_can',
			'meta'                => array(
				'show_in_rest' => true,
			),
		)
	);

	wp_register_ability(
		'desktop-mode/create-post',
		array(
			'label'               => __( 'Create draft post', 'desktop-mode' ),
			'description'         => 'Create a NEW post or page as a DRAFT, authored by the calling user. The status is always draft: this ability can never publish. Use it to produce reviewable content (translations, variants, generated drafts) without touching any existing post. `content` is stored RAW, exactly as passed, so send block markup with its delimiter comments (`<!-- wp:… -->`) intact.',
			'category'            => OPENSTATION_AI_ABILITY_CATEGORY,
			'input_schema'        => array(
				'type'                 => 'object',
				'additionalProperties' => false,
				'required'             => array( 'title', 'content' ),
				'properties'           => array(
					'title'   => array(
						'type'        => 'string',
						'description' => 'Post title.',
					),
					'content' => array(
						'type'        => 'string',
						'description' => 'Post content (HTML / block markup).',
					),
					'excerpt' => array(
						'type'        => 'string',
						'description' => 'Optional excerpt.',
					),
					'type'    => array(
						'type'        => 'string',
						'enum'        => array( 'post', 'page' ),
						'description' => 'Post type. Defaults to post.',
					),
				),
			),
			'output_schema'       => openstation_ai_ability_output_schema(
				array(
					'id'     => array( 'type' => 'integer' ),
					'status' => array( 'type' => 'string' ),
				)
			),
			'execute_callback'    => 'openstation_agents_ability_create_post',
			'permission_callback' => 'openstation_agents_ability_create_post_can',
			'meta'                => array(
				'show_in_rest' => true,
			),
		)
	);

	wp_register_ability(
		'desktop-mode/update-post',
		array(
			'label'               => __( 'Update post', 'desktop-mode' ),
			'description'         => 'Update fields on an existing post. Accepts any subset of title / content / excerpt / status. `content` is stored RAW, exactly as passed, so send block markup with its delimiter comments (`<!-- wp:… -->`) intact — passing rendered HTML would flatten the post\'s blocks. Honours the edit_post capability of the calling user.',
			'category'            => OPENSTATION_AI_ABILITY_CATEGORY,
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
			'output_schema'       => openstation_ai_ability_output_schema(
				array(
					'id'      => array( 'type' => 'integer' ),
					'updated' => array( 'type' => 'boolean' ),
				)
			),
			'execute_callback'    => 'openstation_agents_ability_update_post',
			'permission_callback' => 'openstation_agents_ability_update_post_can',
			'meta'                => array(
				'show_in_rest' => true,
			),
		)
	);
}
add_action( 'wp_abilities_api_init', 'openstation_agents_register_abilities' );

function openstation_agents_ability_get_post( $args ) {
	$args    = (array) $args;
	$post_id = isset( $args['post_id'] ) ? (int) $args['post_id'] : 0;
	$post    = $post_id > 0 ? get_post( $post_id ) : null;
	if ( ! ( $post instanceof WP_Post ) ) {
		return new WP_Error( 'openstation_agent_post_not_found', __( 'Post not found.', 'desktop-mode' ) );
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

function openstation_agents_ability_get_post_can( $args ) {
	$args    = (array) $args;
	$post_id = isset( $args['post_id'] ) ? (int) $args['post_id'] : 0;
	if ( $post_id <= 0 ) {
		return false;
	}
	if ( ! current_user_can( 'read_post', $post_id ) ) {
		return false;
	}
	return openstation_ai_can_read_post( $post_id );
}

function openstation_agents_ability_get_media( $args ) {
	$args          = (array) $args;
	$attachment_id = isset( $args['attachment_id'] ) ? (int) $args['attachment_id'] : 0;
	$post          = $attachment_id > 0 ? get_post( $attachment_id ) : null;
	if ( ! ( $post instanceof WP_Post ) || 'attachment' !== $post->post_type ) {
		return new WP_Error( 'openstation_agent_media_not_found', __( 'Attachment not found.', 'desktop-mode' ) );
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

function openstation_agents_ability_get_media_can( $args ) {
	$args          = (array) $args;
	$attachment_id = isset( $args['attachment_id'] ) ? (int) $args['attachment_id'] : 0;
	if ( $attachment_id <= 0 ) {
		return false;
	}
	if ( ! current_user_can( 'upload_files' ) ) {
		return false;
	}

	$attachment = get_post( $attachment_id );
	if ( ! ( $attachment instanceof WP_Post ) || 'attachment' !== $attachment->post_type ) {

		return true;
	}

	$parent_id = (int) $attachment->post_parent;
	if ( $parent_id <= 0 || $parent_id === $attachment_id ) {
		return true;
	}
	$parent = get_post( $parent_id );
	if ( ! ( $parent instanceof WP_Post ) ) {
		return true;
	}

	if ( ! current_user_can( 'read_post', $parent->ID ) ) {
		return false;
	}
	$parent_type = get_post_type_object( $parent->post_type );
	if ( ! $parent_type || ! is_post_type_viewable( $parent_type ) ) {
		return current_user_can( 'edit_post', $parent->ID );
	}
	return true;
}

function openstation_agents_ability_update_media( $args ) {
	$args          = (array) $args;
	$attachment_id = isset( $args['attachment_id'] ) ? (int) $args['attachment_id'] : 0;
	$post          = $attachment_id > 0 ? get_post( $attachment_id ) : null;
	if ( ! ( $post instanceof WP_Post ) || 'attachment' !== $post->post_type ) {
		return new WP_Error( 'openstation_agent_media_not_found', __( 'Attachment not found.', 'desktop-mode' ) );
	}

	if ( isset( $args['alt_text'] ) ) {
		update_post_meta( $attachment_id, '_wp_attachment_image_alt', sanitize_text_field( (string) $args['alt_text'] ) );
	}

	$update = array( 'ID' => $attachment_id );
	if ( isset( $args['title'] ) ) {
		$update['post_title'] = sanitize_text_field( (string) $args['title'] );
	}
	if ( isset( $args['caption'] ) ) {
		$update['post_excerpt'] = sanitize_text_field( (string) $args['caption'] );
	}
	if ( isset( $args['description'] ) ) {
		$update['post_content'] = wp_kses_post( (string) $args['description'] );
	}
	if ( count( $update ) > 1 ) {
		$result = wp_update_post( $update, true );
		if ( is_wp_error( $result ) ) {
			return $result;
		}
	}

	return array(
		'id'      => $attachment_id,
		'updated' => true,
	);
}

function openstation_agents_ability_update_media_can( $args ) {
	$args          = (array) $args;
	$attachment_id = isset( $args['attachment_id'] ) ? (int) $args['attachment_id'] : 0;
	if ( $attachment_id <= 0 ) {
		return false;
	}
	return current_user_can( 'edit_post', $attachment_id );
}

function openstation_agents_ability_create_post( $args ) {
	$args = (array) $args;
	$type = isset( $args['type'] ) && 'page' === $args['type'] ? 'page' : 'post';

	$post_id = wp_insert_post(
		array(
			'post_type'    => $type,
			'post_status'  => 'draft',
			'post_title'   => sanitize_text_field( isset( $args['title'] ) ? (string) $args['title'] : '' ),
			'post_content' => wp_kses_post( isset( $args['content'] ) ? (string) $args['content'] : '' ),
			'post_excerpt' => sanitize_text_field( isset( $args['excerpt'] ) ? (string) $args['excerpt'] : '' ),
			'post_author'  => get_current_user_id(),
		),
		true
	);
	if ( is_wp_error( $post_id ) ) {
		return $post_id;
	}

	return array(
		'id'       => (int) $post_id,
		'type'     => $type,
		'status'   => 'draft',
		'title'    => (string) get_the_title( $post_id ),
		'editLink' => (string) get_edit_post_link( $post_id, 'raw' ),
	);
}

function openstation_agents_ability_create_post_can( $args ) {
	$args = (array) $args;
	if ( isset( $args['type'] ) && 'page' === $args['type'] ) {
		return current_user_can( 'edit_pages' );
	}
	return current_user_can( 'edit_posts' );
}

function openstation_agents_ability_update_post( $args ) {
	$args    = (array) $args;
	$post_id = isset( $args['post_id'] ) ? (int) $args['post_id'] : 0;
	if ( $post_id <= 0 || ! get_post( $post_id ) ) {
		return new WP_Error( 'openstation_agent_post_not_found', __( 'Post not found.', 'desktop-mode' ) );
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
			return new WP_Error( 'openstation_agent_invalid_status', __( 'Invalid post status.', 'desktop-mode' ) );
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

function openstation_agents_ability_update_post_can( $args ) {
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

function openstation_agents_abilities_catalogue() {
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

	$catalogue = apply_filters( 'openstation_agent_abilities_catalogue', $catalogue );
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
