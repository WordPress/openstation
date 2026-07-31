<?php
/**
 * Tests for the agents identity layer — synthetic user rows and the
 * login-path blocks.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-agents
 */
class Tests_DesktopMode_AgentsIdentity extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	private function create_agent_user( $name = 'Remove BG' ) {
		$user = desktop_mode_agent_create_user(
			array(
				'name' => $name,
				'role' => 'author',
			)
		);
		$this->assertNotWPError( $user );
		return $user;
	}

	/**
	 * @covers ::desktop_mode_agent_create_user
	 */
	public function test_create_user_shape() {
		$user = $this->create_agent_user();

		$this->assertTrue( desktop_mode_agent_is_agent( $user ) );
		$this->assertSame( 'agent-remove-bg', $user->user_login );
		$this->assertStringContainsString( '@agents.', $user->user_email );
		$this->assertSame( 'Remove BG', $user->display_name );
		$this->assertContains( 'author', (array) $user->roles );
	}

	/**
	 * Two agents with the same name get unique logins and emails.
	 *
	 * @covers ::desktop_mode_agent_resolve_unique_login
	 * @covers ::desktop_mode_agent_synthetic_email
	 */
	public function test_duplicate_names_stay_unique() {
		$first  = $this->create_agent_user();
		$second = $this->create_agent_user();

		$this->assertNotSame( $first->user_login, $second->user_login );
		$this->assertNotSame( $first->user_email, $second->user_email );
		$this->assertSame( 'agent-remove-bg-2', $second->user_login );
	}

	/**
	 * @covers ::desktop_mode_agent_is_agent
	 */
	public function test_is_agent_false_for_humans() {
		$this->assertFalse( desktop_mode_agent_is_agent( self::$admin_id ) );
		$this->assertFalse( desktop_mode_agent_is_agent( 0 ) );
		$this->assertFalse( desktop_mode_agent_is_agent( null ) );
	}

	/**
	 * Password authentication is rejected even with the correct password.
	 *
	 * @covers ::desktop_mode_agent_block_authentication
	 */
	public function test_authenticate_filter_blocks_agents() {
		$agent = $this->create_agent_user();
		wp_set_password( 'known-password-123', $agent->ID );

		$result = wp_authenticate( $agent->user_login, 'known-password-123' );
		$this->assertWPError( $result );
		$this->assertSame( 'desktop_mode_agent_login_blocked', $result->get_error_code() );

		// Humans still authenticate through the same chain.
		wp_set_password( 'human-password-123', self::$admin_id );
		$human = wp_authenticate( get_userdata( self::$admin_id )->user_login, 'human-password-123' );
		$this->assertInstanceOf( 'WP_User', $human );
	}

	/**
	 * @covers ::desktop_mode_agent_block_password_reset
	 */
	public function test_password_reset_blocked() {
		$agent = $this->create_agent_user();
		$this->assertFalse( apply_filters( 'allow_password_reset', true, $agent->ID ) );
		$this->assertTrue( apply_filters( 'allow_password_reset', true, self::$admin_id ) );
	}

	/**
	 * @covers ::desktop_mode_agent_block_application_passwords
	 */
	public function test_application_passwords_blocked() {
		$agent = $this->create_agent_user();
		$this->assertFalse(
			apply_filters( 'wp_is_application_passwords_available_for_user', true, $agent )
		);
		$this->assertTrue(
			apply_filters(
				'wp_is_application_passwords_available_for_user',
				true,
				get_userdata( self::$admin_id )
			)
		);
	}

	/**
	 * The avatar must be a real file URL — and must survive
	 * `esc_url()`, because wp-admin's `get_avatar()` and the desktop
	 * user-tile renderer both escape it (`data:` URIs are stripped to
	 * an empty string there).
	 *
	 * @covers ::desktop_mode_agent_avatar
	 * @covers ::desktop_mode_agent_avatar_url
	 */
	public function test_agent_avatar_is_escapable_file_url() {
		$agent = $this->create_agent_user();
		$url   = get_avatar_url( $agent->ID );
		$this->assertStringContainsString( 'assets/images/agent-avatar.svg', $url );
		$this->assertNotSame( '', esc_url( $url ) );
	}

	/**
	 * @covers ::desktop_mode_agent_users_custom_column
	 */
	public function test_users_column_labels_agents() {
		$agent = $this->create_agent_user();

		$agent_cell = desktop_mode_agent_users_custom_column( '', 'desktop_mode_agent_type', $agent->ID );
		$this->assertStringContainsString( 'Agent', $agent_cell );

		$human_cell = desktop_mode_agent_users_custom_column( '', 'desktop_mode_agent_type', self::$admin_id );
		$this->assertStringContainsString( 'Person', $human_cell );

		$other = desktop_mode_agent_users_custom_column( 'existing', 'posts', $agent->ID );
		$this->assertSame( 'existing', $other );
	}

	/**
	 * @covers ::desktop_mode_agent_delete
	 */
	public function test_delete_removes_user_and_meta() {
		$agent = $this->create_agent_user();
		$id    = (int) $agent->ID;

		$fired = null;
		add_action(
			'desktop_mode_agent_deleted',
			static function ( $user_id, $actor_id ) use ( &$fired ) {
				$fired = array( $user_id, $actor_id );
			},
			10,
			2
		);

		$result = desktop_mode_agent_delete( $id );
		$this->assertTrue( $result );
		$this->assertFalse( get_userdata( $id ) );
		$this->assertSame( array( $id, self::$admin_id ), $fired );
	}

	/**
	 * @covers ::desktop_mode_agent_delete
	 */
	public function test_delete_refuses_non_agents() {
		$result = desktop_mode_agent_delete( self::$admin_id );
		$this->assertWPError( $result );
		$this->assertSame( 'desktop_mode_agent_not_an_agent', $result->get_error_code() );
		$this->assertInstanceOf( 'WP_User', get_userdata( self::$admin_id ) );
	}
}
