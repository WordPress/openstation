<?php
/**
 * Tests for the Agents identity layer — synthetic users, login block,
 * password-reset block, cascade delete, custom Users-list column.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-agents
 */
class Tests_DesktopMode_Agents_Identity extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );

		// Register a stub `wp_guideline` post type so cascade tests
		// have a real post to delete. Mirrors the Gutenberg substrate
		// shape closely enough for our purposes.
		if ( ! post_type_exists( 'wp_guideline' ) ) {
			register_post_type(
				'wp_guideline',
				array(
					'public'       => false,
					'show_in_rest' => true,
					'rest_base'    => 'guidelines',
					'supports'     => array( 'title', 'editor', 'excerpt', 'author' ),
				)
			);
			register_taxonomy(
				'wp_guideline_type',
				'wp_guideline',
				array(
					'hierarchical' => true,
					'show_in_rest' => true,
				)
			);
		}
	}

	public function tear_down() {
		// Hard-delete every agent user created by the test.
		$users = get_users(
			array(
				'meta_key'   => DESKTOP_MODE_AGENT_USER_MARKER_META, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
				'meta_value' => '1', // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
				'fields'     => 'ID',
				'number'     => 200,
			)
		);
		if ( ! function_exists( 'wp_delete_user' ) ) {
			require_once ABSPATH . 'wp-admin/includes/user.php';
		}
		foreach ( $users as $uid ) {
			wp_delete_user( $uid );
		}
		parent::tear_down();
	}

	/**
	 * @covers ::desktop_mode_agent_create_user
	 */
	public function test_create_user_succeeds_with_valid_args() {
		$user = desktop_mode_agent_create_user(
			array(
				'name' => 'Remove BG',
				'role' => 'editor',
			)
		);

		$this->assertInstanceOf( 'WP_User', $user );
		$this->assertSame( 'Remove BG', $user->display_name );
		$this->assertContains( 'editor', $user->roles );
		$this->assertSame( 'agent-remove-bg', $user->user_login );
		$this->assertTrue( desktop_mode_agent_is_agent( $user ) );
	}

	/**
	 * @covers ::desktop_mode_agent_create_user
	 */
	public function test_create_user_rejects_invalid_role() {
		$result = desktop_mode_agent_create_user(
			array(
				'name' => 'Bad Role',
				'role' => 'this_role_does_not_exist',
			)
		);
		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'desktop_mode_agent_invalid_role', $result->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_agent_create_user
	 */
	public function test_create_user_rejects_empty_name() {
		$result = desktop_mode_agent_create_user(
			array(
				'name' => '',
				'role' => 'editor',
			)
		);
		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'desktop_mode_agent_invalid_name', $result->get_error_code() );
	}

	/**
	 * Same display name → unique login resolved via suffix.
	 *
	 * @covers ::desktop_mode_agent_resolve_unique_login
	 */
	public function test_unique_login_appends_suffix_on_collision() {
		$a = desktop_mode_agent_create_user( array( 'name' => 'Alpha', 'role' => 'editor' ) );
		$b = desktop_mode_agent_create_user( array( 'name' => 'Alpha', 'role' => 'editor' ) );
		$this->assertSame( 'agent-alpha', $a->user_login );
		$this->assertSame( 'agent-alpha-2', $b->user_login );
	}

	/**
	 * @covers ::desktop_mode_agent_block_authentication
	 */
	public function test_authenticate_filter_rejects_agent_users() {
		$user = desktop_mode_agent_create_user(
			array(
				'name' => 'Login Blocked',
				'role' => 'editor',
			)
		);
		$result = desktop_mode_agent_block_authentication( $user, $user->user_login, 'anything' );
		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'desktop_mode_agent_login_blocked', $result->get_error_code() );
	}

	/**
	 * Filter must pass through non-agent users unchanged.
	 *
	 * @covers ::desktop_mode_agent_block_authentication
	 */
	public function test_authenticate_filter_passes_human_users_through() {
		$human = new WP_User( self::$admin_id );
		$result = desktop_mode_agent_block_authentication( $human, $human->user_login, 'whatever' );
		$this->assertSame( $human, $result );
	}

	/**
	 * @covers ::desktop_mode_agent_block_password_reset
	 */
	public function test_password_reset_blocked_for_agents() {
		$user = desktop_mode_agent_create_user(
			array(
				'name' => 'Reset Blocked',
				'role' => 'editor',
			)
		);
		$this->assertFalse( desktop_mode_agent_block_password_reset( true, $user->ID ) );
		$this->assertTrue( desktop_mode_agent_block_password_reset( true, self::$admin_id ) );
	}

	/**
	 * @covers ::desktop_mode_agent_delete
	 */
	public function test_delete_removes_user_and_guideline() {
		$user = desktop_mode_agent_create_user(
			array(
				'name' => 'Cascade Me',
				'role' => 'editor',
			)
		);
		$guideline_id = wp_insert_post(
			array(
				'post_type'   => 'wp_guideline',
				'post_status' => 'publish',
				'post_title'  => 'Cascade Me',
				'post_author' => $user->ID,
			)
		);
		desktop_mode_agent_link_guideline( $user->ID, $guideline_id );

		$result = desktop_mode_agent_delete( $user->ID );
		$this->assertTrue( $result );
		$this->assertFalse( get_user_by( 'ID', $user->ID ) );
		$this->assertNull( get_post( $guideline_id ) );
	}

	/**
	 * Deleting an agent user via the standard WP path also tears down
	 * the linked guideline (cascade via `delete_user` hook).
	 *
	 * @covers ::desktop_mode_agent_cascade_pre_delete_user
	 */
	public function test_cascade_pre_delete_removes_guideline() {
		$user = desktop_mode_agent_create_user(
			array(
				'name' => 'Cascade Two',
				'role' => 'author',
			)
		);
		$guideline_id = wp_insert_post(
			array(
				'post_type'   => 'wp_guideline',
				'post_status' => 'publish',
				'post_title'  => 'Cascade Two',
				'post_author' => $user->ID,
			)
		);
		desktop_mode_agent_link_guideline( $user->ID, $guideline_id );

		if ( ! function_exists( 'wp_delete_user' ) ) {
			require_once ABSPATH . 'wp-admin/includes/user.php';
		}
		wp_delete_user( $user->ID );

		$this->assertNull( get_post( $guideline_id ) );
	}

	/**
	 * @covers ::desktop_mode_agent_delete
	 */
	public function test_delete_rejects_non_agent_users() {
		$result = desktop_mode_agent_delete( self::$admin_id );
		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'desktop_mode_agent_not_an_agent', $result->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_agent_avatar
	 */
	public function test_avatar_filter_swaps_bot_glyph_for_agents() {
		$user = desktop_mode_agent_create_user(
			array(
				'name' => 'Avatar Test',
				'role' => 'editor',
			)
		);
		$args = desktop_mode_agent_avatar( array( 'url' => 'about:blank', 'found_avatar' => false ), $user->ID );
		$this->assertStringStartsWith( 'data:image/svg+xml;base64,', (string) $args['url'] );
		$this->assertTrue( (bool) $args['found_avatar'] );
	}

	/**
	 * @covers ::desktop_mode_agent_avatar
	 */
	public function test_avatar_filter_leaves_humans_alone() {
		$args = desktop_mode_agent_avatar( array( 'url' => 'about:blank', 'found_avatar' => false ), self::$admin_id );
		$this->assertSame( 'about:blank', $args['url'] );
		$this->assertFalse( (bool) $args['found_avatar'] );
	}

	/**
	 * @covers ::desktop_mode_agent_users_columns
	 * @covers ::desktop_mode_agent_users_custom_column
	 */
	public function test_users_list_column_renders_agent_label() {
		$user = desktop_mode_agent_create_user(
			array(
				'name' => 'Column Test',
				'role' => 'editor',
			)
		);
		$columns = desktop_mode_agent_users_columns( array() );
		$this->assertArrayHasKey( 'desktop_mode_agent_type', $columns );

		$rendered = desktop_mode_agent_users_custom_column( '', 'desktop_mode_agent_type', $user->ID );
		$this->assertStringContainsString( 'Agent', $rendered );
		$this->assertStringContainsString( 'dashicons-superhero', $rendered );

		$rendered_human = desktop_mode_agent_users_custom_column( '', 'desktop_mode_agent_type', self::$admin_id );
		$this->assertStringContainsString( 'Person', $rendered_human );
	}
}
