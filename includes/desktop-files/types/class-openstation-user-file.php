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

	/**
	 * Get the file type identifier.
	 *
	 * @return string
	 */
	public static function type(): string {
		return 'user';
	}

	/**
	 * Whether the underlying user account still exists.
	 *
	 * @return bool
	 */
	public function exists(): bool {
		return $this->user() instanceof WP_User;
	}

	/**
	 * Get the user's display name.
	 *
	 * @return string
	 */
	public function title(): string {
		$user = $this->user();
		if ( ! $user ) {
			return __( '(missing user)', 'desktop-mode' );
		}
		return (string) $user->display_name;
	}

	/**
	 * Get the Dashicon class for user tiles.
	 *
	 * @return string
	 */
	public function icon(): string {
		return 'dashicons-admin-users';
	}

	/**
	 * Get the user's avatar URL for tile previews.
	 *
	 * @return string Empty string when no avatar is available.
	 */
	public function preview_url(): string {
		$user = $this->user();
		if ( ! $user ) {
			return '';
		}
		$avatar = get_avatar_url( $user->ID, array( 'size' => 96 ) );
		return is_string( $avatar ) ? $avatar : '';
	}

	/**
	 * Gate visibility on the `list_users` capability so shared
	 * folders don't leak the user roster.
	 *
	 * @param int $user_id
	 * @return bool
	 */
	public function can_read( int $user_id ): bool {
		// Reading the existence of another user is gated on
		// `list_users` to avoid leaking the user roster via shared
		// folders. Tighter than `read` (every logged-in user has
		// `read`) but looser than `edit_users`.
		return user_can( $user_id, 'list_users' );
	}

	/**
	 * Augment the base serialized shape with roles, author archive
	 * URL, and agent metadata when applicable.
	 *
	 * @return array
	 */
	public function serialize(): array {
		$shape          = parent::serialize();
		$user           = $this->user();
		$shape['roles'] = $user ? array_values( (array) $user->roles ) : array();
		// Author archive URL — surfaced so cross-frame drag handlers
		// can build a `<a href>` to the author's posts on drop into
		// Gutenberg without a REST roundtrip.
		$shape['link'] = $user ? (string) get_author_posts_url( (int) $user->ID ) : '';

		// OpenStation agent surface. `isAgent` marks the tile; the
		// drag-trigger entity kinds ship inline so the tile drop
		// handler can gate synchronously without an agents REST
		// roundtrip: null = no drag trigger configured (tile rejects
		// drops), [] = drag trigger with no filter (accepts every
		// entity kind).
		//
		// The two guards test DIFFERENT things and both are load-
		// bearing. `openstation_agent_is_agent()` lives in the agents
		// guard, which loads unconditionally — being an agent is a
		// property of the user row, and the row survives the feature
		// being switched off. The definition getters live in store.php,
		// which does NOT load then. Turning the `agents` extended
		// option off while an agent tile sits on someone's desktop
		// otherwise fatals the whole admin on the next boot payload.
		if (
			$user
			&& function_exists( 'openstation_agent_is_agent' )
			&& openstation_agent_is_agent( $user->ID )
		) {
			$shape['isAgent'] = true;

			// Named one by one rather than probing a single getter as
			// a proxy for "store.php loaded": the proxy reads as an
			// unguarded call at every other site, and this is a rule a
			// test has to be able to check mechanically.
			$has_definition = function_exists( 'openstation_agent_get_description' )
				&& function_exists( 'openstation_agent_get_triggers' );
			// The "when to use" line — the chat window's subtitle when
			// the tile opener starts a conversation.
			$shape['agentDescription'] = $has_definition
				? openstation_agent_get_description( (int) $user->ID )
				: '';

			// Null while the framework is off: the tile still reads as
			// an agent, but rejects every drop, because nothing can run
			// to receive it.
			$drag_kinds = null;
			$triggers   = $has_definition
				? openstation_agent_get_triggers( (int) $user->ID )
				: array();
			foreach ( $triggers as $trigger ) {
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

	/**
	 * Lazily resolve the underlying WP_User from the stored ref.
	 *
	 * @return WP_User|null Null when the user is gone or the ref is invalid.
	 */
	private function user(): ?WP_User {
		$id = (int) $this->ref;
		if ( $id <= 0 ) {
			return null;
		}
		$user = get_userdata( $id );
		return $user instanceof WP_User ? $user : null;
	}
}
