<?php
/**
 * Desktop Mode — `user` file type.
 *
 * @package WPDesktopMode
 * @since   0.9.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * @since 0.9.0
 */
class Desktop_Mode_User_File extends Desktop_Mode_File {

	public static function type(): string {
		return 'user';
	}

	public function exists(): bool {
		return $this->user() instanceof WP_User;
	}

	public function title(): string {
		$user = $this->user();
		if ( ! $user ) {
			return __( '(missing user)', 'desktop-mode' );
		}
		return (string) $user->display_name;
	}

	public function icon(): string {
		return 'dashicons-admin-users';
	}

	public function preview_url(): string {
		$user = $this->user();
		if ( ! $user ) {
			return '';
		}
		$avatar = get_avatar_url( $user->ID, array( 'size' => 96 ) );
		return is_string( $avatar ) ? $avatar : '';
	}

	public function can_read( int $user_id ): bool {
		// Reading the existence of another user is gated on
		// `list_users` to avoid leaking the user roster via shared
		// folders. Tighter than `read` (every logged-in user has
		// `read`) but looser than `edit_users`.
		return user_can( $user_id, 'list_users' );
	}

	public function serialize(): array {
		$shape       = parent::serialize();
		$user        = $this->user();
		$shape['roles'] = $user ? array_values( (array) $user->roles ) : array();
		return $shape;
	}

	private function user(): ?WP_User {
		$id = (int) $this->ref;
		if ( $id <= 0 ) {
			return null;
		}
		$user = get_userdata( $id );
		return $user instanceof WP_User ? $user : null;
	}
}
