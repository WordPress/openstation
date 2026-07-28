<?php
/**
 * Remove Background — the `media-tools/remove-background` ability.
 *
 * Mutating (no `readonly` annotation): the AI Copilot never sees it;
 * only a Desktop Mode agent whose allowlist includes it (or another
 * Abilities API consumer) can call it. Execution runs as the calling
 * user — for agents, the agent's synthetic account — so the new
 * attachment is attributed to the agent in the media library.
 *
 * @package DesktopModeRemoveBackground
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the `media-tools` category.
 *
 * @return void
 */
function desktop_mode_remove_bg_register_category() {
	if ( ! function_exists( 'wp_register_ability_category' ) ) {
		return;
	}
	wp_register_ability_category(
		'media-tools',
		array(
			'label'       => __( 'Media tools', 'desktop-mode-remove-background' ),
			'description' => __( 'Abilities that process media library items.', 'desktop-mode-remove-background' ),
		)
	);
}
add_action( 'wp_abilities_api_categories_init', 'desktop_mode_remove_bg_register_category' );

/**
 * Register the ability.
 *
 * @return void
 */
function desktop_mode_remove_bg_register_ability() {
	if ( ! function_exists( 'wp_register_ability' ) ) {
		return;
	}

	wp_register_ability(
		'media-tools/remove-background',
		array(
			'label'               => __( 'Remove image background', 'desktop-mode-remove-background' ),
			'description'         => 'Remove the background from a media library image. Creates a NEW attachment containing the subject on a transparent background and returns its id and URL. The original image is never modified. Use media-tools/remove-background after resolving the attachment id (e.g. via desktop-mode/get-media).',
			'category'            => 'media-tools',
			'input_schema'        => array(
				'type'                 => 'object',
				'additionalProperties' => false,
				'required'             => array( 'attachment_id' ),
				'properties'           => array(
					'attachment_id' => array(
						'type'        => 'integer',
						'description' => 'The attachment (media library) id of the image to process.',
					),
				),
			),
			'output_schema'       => array(
				'type'                 => 'object',
				'additionalProperties' => true,
				'properties'           => array(
					'id'  => array( 'type' => 'integer' ),
					'url' => array( 'type' => 'string' ),
				),
			),
			'execute_callback'    => 'desktop_mode_remove_bg_execute',
			'permission_callback' => 'desktop_mode_remove_bg_can',
			'meta'                => array(
				'show_in_rest' => true,
			),
		)
	);
}
add_action( 'wp_abilities_api_init', 'desktop_mode_remove_bg_register_ability' );

/**
 * Permission: `upload_files` — the caller must be allowed to add
 * media, because success creates a new attachment.
 *
 * @param array $args Input args.
 * @return bool
 */
function desktop_mode_remove_bg_can( $args ) {
	$args          = (array) $args;
	$attachment_id = isset( $args['attachment_id'] ) ? (int) $args['attachment_id'] : 0;
	if ( $attachment_id <= 0 ) {
		return false;
	}
	return current_user_can( 'upload_files' );
}

/**
 * Execute: validate, run the configured backend, sideload the result
 * as a new PNG attachment next to the original.
 *
 * @param array $args Validated input.
 * @return array|WP_Error
 */
function desktop_mode_remove_bg_execute( $args ) {
	$args          = (array) $args;
	$attachment_id = isset( $args['attachment_id'] ) ? (int) $args['attachment_id'] : 0;
	$post          = $attachment_id > 0 ? get_post( $attachment_id ) : null;
	if ( ! ( $post instanceof WP_Post ) || 'attachment' !== $post->post_type ) {
		return new WP_Error( 'desktop_mode_remove_bg_not_found', __( 'Attachment not found.', 'desktop-mode-remove-background' ) );
	}

	$mime = (string) get_post_mime_type( $post );
	if ( ! in_array( $mime, array( 'image/jpeg', 'image/png', 'image/webp' ), true ) ) {
		return new WP_Error(
			'desktop_mode_remove_bg_unsupported_type',
			sprintf(
				/* translators: %s is the attachment mime type. */
				__( 'Background removal supports JPEG, PNG, and WebP images; this attachment is %s.', 'desktop-mode-remove-background' ),
				$mime
			)
		);
	}

	$path = get_attached_file( $attachment_id );
	if ( ! is_string( $path ) || '' === $path || ! file_exists( $path ) ) {
		return new WP_Error( 'desktop_mode_remove_bg_no_file', __( 'The attachment has no readable file on disk.', 'desktop-mode-remove-background' ) );
	}

	/**
	 * Short-circuit the processing backend. Return binary PNG bytes
	 * (or a WP_Error) to skip the configured backend entirely — the
	 * seam PHPUnit and bespoke integrations plug into.
	 *
	 * @since 0.1.0
	 *
	 * @param string|WP_Error|null $png           Null to run the configured backend.
	 * @param string               $path          Image file path.
	 * @param string               $mime          Image mime type.
	 * @param int                  $attachment_id Attachment id.
	 */
	$png = apply_filters( 'desktop_mode_remove_background_pre', null, $path, $mime, $attachment_id );
	if ( null === $png ) {
		$settings = desktop_mode_remove_bg_get_settings();
		$backends = desktop_mode_remove_bg_backends();
		if ( ! isset( $backends[ $settings['backend'] ] ) || ! is_callable( $backends[ $settings['backend'] ] ) ) {
			return new WP_Error( 'desktop_mode_remove_bg_no_backend', __( 'No background-removal backend is configured.', 'desktop-mode-remove-background' ) );
		}
		$png = call_user_func( $backends[ $settings['backend'] ], $path, $mime, $attachment_id );
	}
	if ( is_wp_error( $png ) ) {
		return $png;
	}
	if ( ! is_string( $png ) || '' === $png ) {
		return new WP_Error( 'desktop_mode_remove_bg_empty_result', __( 'The backend returned no image data.', 'desktop-mode-remove-background' ) );
	}

	$filename = pathinfo( $path, PATHINFO_FILENAME ) . '-no-bg.png';
	$upload   = wp_upload_bits( $filename, null, $png );
	if ( ! empty( $upload['error'] ) ) {
		return new WP_Error( 'desktop_mode_remove_bg_upload_failed', (string) $upload['error'] );
	}

	$new_id = wp_insert_attachment(
		array(
			'post_mime_type' => 'image/png',
			'post_title'     => sprintf(
				/* translators: %s is the original attachment title. */
				__( '%s (no background)', 'desktop-mode-remove-background' ),
				(string) $post->post_title
			),
			'post_parent'    => (int) $post->post_parent,
			'post_status'    => 'inherit',
		),
		$upload['file'],
		(int) $post->post_parent,
		true
	);
	if ( is_wp_error( $new_id ) ) {
		return $new_id;
	}

	$alt = (string) get_post_meta( $attachment_id, '_wp_attachment_image_alt', true );
	if ( '' !== $alt ) {
		update_post_meta( $new_id, '_wp_attachment_image_alt', $alt );
	}

	if ( ! function_exists( 'wp_generate_attachment_metadata' ) ) {
		require_once ABSPATH . 'wp-admin/includes/image.php';
	}
	$meta = wp_generate_attachment_metadata( $new_id, $upload['file'] );
	if ( is_array( $meta ) && ! empty( $meta ) ) {
		wp_update_attachment_metadata( $new_id, $meta );
	}

	return array(
		'id'         => (int) $new_id,
		'url'        => (string) $upload['url'],
		'title'      => (string) get_the_title( $new_id ),
		'sourceId'   => (int) $attachment_id,
		'attachedTo' => (int) $post->post_parent,
	);
}
