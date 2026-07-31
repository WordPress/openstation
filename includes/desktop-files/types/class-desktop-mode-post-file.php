<?php
/**
 * Desktop Mode — `post` file type.
 *
 * Adapts any public post type (post, page, CPT) to the file
 * surface. The concrete post type is read from `get_post_type()`
 * and exposed in the serialized shape so plugins can theme tiles
 * differently per post type via `desktop_mode_file_serialize`.
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * The `post` desktop file type.
 */
class Desktop_Mode_Post_File extends Desktop_Mode_File {

	public static function type(): string {
		return 'post';
	}

	public function exists(): bool {
		return $this->post() instanceof WP_Post;
	}

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

	public function can_read( int $user_id ): bool {
		$post = $this->post();
		if ( ! $post ) {
			return false;
		}
		return user_can( $user_id, 'read_post', $post->ID );
	}

	public function serialize(): array {
		$shape             = parent::serialize();
		$post              = $this->post();
		$shape['postType'] = $post ? (string) $post->post_type : '';
		$shape['status']   = $post ? (string) $post->post_status : '';
		// Permalink — surfaced on the serialized shape so cross-frame
		// drag handlers can build a `<a href>` block on drop without
		// a synchronous REST roundtrip. Empty string when the post is
		// gone or has no permalink (drafts of certain post types).
		$shape['link']     = $post ? (string) get_permalink( $post ) : '';
		return $shape;
	}

	private function post(): ?WP_Post {
		$id = (int) $this->ref;
		if ( $id <= 0 ) {
			return null;
		}
		$post = get_post( $id );
		return $post instanceof WP_Post ? $post : null;
	}
}
