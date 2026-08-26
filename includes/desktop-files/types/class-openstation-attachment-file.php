<?php
/**
 * OpenStation — `attachment` file type.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * The `attachment` desktop file type.
 */
class OpenStation_Attachment_File extends OpenStation_File {

	/**
	 * Get the file type identifier.
	 *
	 * @return string
	 */
	public static function type(): string {
		return 'attachment';
	}

	/**
	 * Whether the attachment post still exists.
	 *
	 * @return bool
	 */
	public function exists(): bool {
		return $this->attachment() instanceof WP_Post;
	}

	/**
	 * Get a label from the attachment title or fall back to the
	 * filename.
	 *
	 * @return string
	 */
	public function title(): string {
		$post = $this->attachment();
		if ( ! $post ) {
			return __( '(missing media)', 'desktop-mode' );
		}
		$title = get_the_title( $post );
		return wp_strip_all_tags( '' !== $title ? $title : basename( (string) get_attached_file( $post->ID ) ) );
	}

	/**
	 * Resolve a Dashicon class based on the attachment's mime-type
	 * category.
	 *
	 * @return string
	 */
	public function icon(): string {
		$post = $this->attachment();
		if ( ! $post ) {
			return 'dashicons-warning';
		}
		$type = strtok( (string) $post->post_mime_type, '/' );
		switch ( $type ) {
			case 'image':
				return 'dashicons-format-image';
			case 'video':
				return 'dashicons-format-video';
			case 'audio':
				return 'dashicons-format-audio';
			default:
				return 'dashicons-media-default';
		}
	}

	/**
	 * Get the attachment's thumbnail URL for tile previews.
	 *
	 * @return string Empty string when no image source is available.
	 */
	public function preview_url(): string {
		$post = $this->attachment();
		if ( ! $post ) {
			return '';
		}
		$src = wp_get_attachment_image_src( $post->ID, 'thumbnail' );
		return is_array( $src ) ? (string) $src[0] : '';
	}

	/**
	 * Check whether the given user can read this attachment.
	 *
	 * @param int $user_id
	 * @return bool
	 */
	public function can_read( int $user_id ): bool {
		$post = $this->attachment();
		if ( ! $post ) {
			return false;
		}
		return user_can( $user_id, 'read_post', $post->ID );
	}

	/**
	 * Augment the base serialized shape with mime type, source URL,
	 * and alt text for block-editor drag handlers.
	 *
	 * @return array
	 */
	public function serialize(): array {
		$shape         = parent::serialize();
		$post          = $this->attachment();
		$shape['mime'] = $post ? (string) $post->post_mime_type : '';
		// Full-size source URL + alt text — surfaced so cross-frame
		// drag handlers can build `core/image` / `core/video` /
		// `core/audio` / `core/file` blocks on drop into Gutenberg
		// without a REST roundtrip. `previewUrl` is a thumbnail and
		// not the right attribute for the inserted block.
		$shape['sourceUrl'] = $post ? (string) wp_get_attachment_url( $post->ID ) : '';
		$shape['alt']       = $post ? (string) get_post_meta( $post->ID, '_wp_attachment_image_alt', true ) : '';
		return $shape;
	}

	/**
	 * Lazily resolve the underlying WP_Post, verifying it is an
	 * attachment.
	 *
	 * @return WP_Post|null Null when the attachment is gone or the ref is invalid.
	 */
	private function attachment(): ?WP_Post {
		$id = (int) $this->ref;
		if ( $id <= 0 ) {
			return null;
		}
		$post = get_post( $id );
		if ( ! $post instanceof WP_Post || 'attachment' !== $post->post_type ) {
			return null;
		}
		return $post;
	}
}
