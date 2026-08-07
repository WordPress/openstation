<?php
/**
 * OpenStation — `comment` file type.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * The `comment` desktop file type.
 */
class OpenStation_Comment_File extends OpenStation_File {

	public static function type(): string {
		return 'comment';
	}

	public function exists(): bool {
		return $this->comment() instanceof WP_Comment;
	}

	public function title(): string {
		$c = $this->comment();
		if ( ! $c ) {
			return __( '(missing comment)', 'desktop-mode' );
		}
		$author  = '' !== $c->comment_author ? $c->comment_author : __( 'Anonymous', 'desktop-mode' );
		$excerpt = wp_trim_words( wp_strip_all_tags( $c->comment_content ), 8, '…' );
		return sprintf( '%s — %s', $author, $excerpt );
	}

	public function icon(): string {
		return 'dashicons-admin-comments';
	}

	public function can_read( int $user_id ): bool {
		$c = $this->comment();
		if ( ! $c ) {
			return false;
		}
		// Approved comments are public; non-approved gated on
		// moderation cap.
		if ( '1' === (string) $c->comment_approved ) {
			return true;
		}
		return user_can( $user_id, 'moderate_comments' );
	}

	public function serialize(): array {
		$shape             = parent::serialize();
		$c                 = $this->comment();
		$shape['postId']   = $c ? (int) $c->comment_post_ID : 0;
		$shape['approved'] = $c ? '1' === (string) $c->comment_approved : false;
		return $shape;
	}

	private function comment(): ?WP_Comment {
		$id = (int) $this->ref;
		if ( $id <= 0 ) {
			return null;
		}
		$c = get_comment( $id );
		return $c instanceof WP_Comment ? $c : null;
	}
}
