<?php

defined( 'ABSPATH' ) || exit;

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

		return user_can( $user_id, 'list_users' );
	}

	public function serialize(): array {
		$shape          = parent::serialize();
		$user           = $this->user();
		$shape['roles'] = $user ? array_values( (array) $user->roles ) : array();

		$shape['link'] = $user ? (string) get_author_posts_url( (int) $user->ID ) : '';

		if (
			$user
			&& function_exists( 'openstation_agent_is_agent' )
			&& openstation_agent_is_agent( $user->ID )
		) {
			$shape['isAgent'] = true;

			$has_definition = function_exists( 'openstation_agent_get_description' )
				&& function_exists( 'openstation_agent_get_triggers' );

			$shape['agentDescription'] = $has_definition
				? openstation_agent_get_description( (int) $user->ID )
				: '';

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

	private function user(): ?WP_User {
		$id = (int) $this->ref;
		if ( $id <= 0 ) {
			return null;
		}
		$user = get_userdata( $id );
		return $user instanceof WP_User ? $user : null;
	}
}
