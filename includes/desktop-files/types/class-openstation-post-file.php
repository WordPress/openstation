<?php
/**
 * OpenStation — `post` file type.
 *
 * Adapts any public post type (post, page, CPT) to the file
 * surface. The concrete post type is read from `get_post_type()`
 * and exposed in the serialized shape so plugins can theme tiles
 * differently per post type via `openstation_file_serialize`.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * The `post` desktop file type.
 */
class OpenStation_Post_File extends OpenStation_File {

	/**
	 * Get the file type identifier.
	 *
	 * @return string
	 */
	public static function type(): string {
		return 'post';
	}

	/**
	 * Whether the underlying post still exists.
	 *
	 * @return bool
	 */
	public function exists(): bool {
		return $this->post() instanceof WP_Post;
	}

	/**
	 * Get a human-readable label, falling back to a placeholder
	 * when the post is missing or has no title.
	 *
	 * @return string
	 */
	public function title(): string {
		$post = $this->post();
		if ( ! $post ) {
			return __( '(missing post)', 'desktop-mode' );
		}
		$title = wp_strip_all_tags( get_the_title( $post ) );
		// Auto-drafts and brand-new posts often have empty titles.
		// Surface a placeholder so the tile shows something readable
		// instead of an icon with no label under it.
		return '' !== $title ? $title : __( '(no title)', 'desktop-mode' );
	}

	/**
	 * Resolve a Dashicon class for the post, preferring the
	 * post-type's registered menu icon.
	 *
	 * @return string
	 */
	public function icon(): string {
		$post = $this->post();
		if ( ! $post ) {
			return 'dashicons-warning';
		}
		$post_type_object = get_post_type_object( $post->post_type );
		if ( $post_type_object && ! empty( $post_type_object->menu_icon ) ) {
			return (string) $post_type_object->menu_icon;
		}
		return 'page' === $post->post_type ? 'dashicons-page' : 'dashicons-admin-post';
	}

	/**
	 * Get the post's featured-image thumbnail URL, if any.
	 *
	 * @return string Empty string when no thumbnail is set.
	 */
	public function preview_url(): string {
		$post = $this->post();
		if ( ! $post ) {
			return '';
		}
		$thumb_id = get_post_thumbnail_id( $post );
		if ( ! $thumb_id ) {
			return '';
		}
		$src = wp_get_attachment_image_src( $thumb_id, 'thumbnail' );
		return is_array( $src ) ? (string) $src[0] : '';
	}

	/**
	 * Check whether the given user can read this post.
	 *
	 * @param int $user_id
	 * @return bool
	 */
	public function can_read( int $user_id ): bool {
		$post = $this->post();
		if ( ! $post ) {
			return false;
		}
		return user_can( $user_id, 'read_post', $post->ID );
	}

	/**
	 * Augment the base serialized shape with post type, status,
	 * and permalink for cross-frame drag handlers.
	 *
	 * @return array
	 */
	public function serialize(): array {
		$shape             = parent::serialize();
		$post              = $this->post();
		$shape['postType'] = $post ? (string) $post->post_type : '';
		$shape['status']   = $post ? (string) $post->post_status : '';
		// Permalink — surfaced on the serialized shape so cross-frame
		// drag handlers can build a `<a href>` block on drop without
		// a synchronous REST roundtrip. Empty string when the post is
		// gone or has no permalink (drafts of certain post types).
		$shape['link'] = $post ? (string) get_permalink( $post ) : '';
		return $shape;
	}

	/**
	 * Lazily resolve the underlying WP_Post from the stored ref.
	 *
	 * @return WP_Post|null Null when the post is gone or the ref is invalid.
	 */
	private function post(): ?WP_Post {
		$id = (int) $this->ref;
		if ( $id <= 0 ) {
			return null;
		}
		$post = get_post( $id );
		return $post instanceof WP_Post ? $post : null;
	}
}
