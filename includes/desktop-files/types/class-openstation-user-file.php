<?php
/**
 * OpenStation — `user` file type.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * The `user` desktop file type.
 */
class OpenStation_User_File extends OpenStation_File {

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
		$shape          = parent::serialize();
		$user           = $this->user();
		$shape['roles'] = $user ? array_values( (array) $user->roles ) : array();
		// Author archive URL — surfaced so cross-frame drag handlers
		// can build a `<a href>` to the author's posts on drop into
		// Gutenberg without a REST roundtrip.
		$shape['link']  = $user ? (string) get_author_posts_url( (int) $user->ID ) : '';

		// OpenStation agent surface. `isAgent` marks the tile; the
		// drag-trigger entity kinds ship inline so the tile drop
		// handler can gate synchronously without an agents REST
		// roundtrip: null = no drag trigger configured (tile rejects
		// drops), [] = drag trigger with no filter (accepts every
		// entity kind). Guarded — the agents module is behind the
		// `agents` extended option.
		if (
			$user
			&& function_exists( 'openstation_agent_is_agent' )
			&& openstation_agent_is_agent( $user->ID )
		) {
			$shape['isAgent'] = true;
			// The "when to use" line — the chat window's subtitle when
			// the tile opener starts a conversation.
			$shape['agentDescription'] = openstation_agent_get_description( (int) $user->ID );
			$drag_kinds                = null;
			foreach ( openstation_agent_get_triggers( (int) $user->ID ) as $trigger ) {
				if ( 'drag' !== ( isset( $trigger['kind'] ) ? $trigger['kind'] : '' ) ) {
					continue;
				}
				$kinds      = isset( $trigger['config']['entityKinds'] ) && is_array( $trigger['config']['entityKinds'] )
					? $trigger['config']['entityKinds']
					: array();
				$drag_kinds = array_values( array_map( 'strval', $kinds ) );
				break;
			}
			$shape['agentDragKinds'] = $drag_kinds;
		}

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
