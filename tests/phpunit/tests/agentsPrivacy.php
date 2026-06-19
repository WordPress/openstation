<?php
/**
 * Tests for the Agents Personal Data Export + Erasure hooks.
 *
 * Aligns with the wp_guideline-as-Core-memory vision (Gutenberg PR
 * #78296 + issue #77230): the memory store integrates with WP's
 * existing personal-data flows the same way posts and comments do.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-agents
 */
class Tests_DesktopMode_Agents_Privacy extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
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
		}
		if ( ! taxonomy_exists( 'wp_guideline_type' ) ) {
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
	 * @covers ::desktop_mode_agents_register_personal_data_exporter
	 */
	public function test_exporter_is_registered() {
		$exporters = apply_filters( 'wp_privacy_personal_data_exporters', array() );
		$this->assertArrayHasKey( 'desktop-mode-agents', $exporters );
		$this->assertSame(
			'desktop_mode_agents_personal_data_exporter',
			$exporters['desktop-mode-agents']['callback']
		);
	}

	/**
	 * @covers ::desktop_mode_agents_register_personal_data_eraser
	 */
	public function test_eraser_is_registered() {
		$erasers = apply_filters( 'wp_privacy_personal_data_erasers', array() );
		$this->assertArrayHasKey( 'desktop-mode-agents', $erasers );
		$this->assertSame(
			'desktop_mode_agents_personal_data_eraser',
			$erasers['desktop-mode-agents']['callback']
		);
	}

	/**
	 * @covers ::desktop_mode_agents_personal_data_exporter
	 */
	public function test_exporter_returns_agent_data_for_synthetic_email() {
		$user = desktop_mode_agent_create_user(
			array(
				'name' => 'Privacy Test',
				'role' => 'editor',
			)
		);
		$guideline_id = wp_insert_post(
			array(
				'post_type'    => 'wp_guideline',
				'post_status'  => 'publish',
				'post_title'   => 'Privacy Test',
				'post_excerpt' => 'A test agent.',
				'post_content' => 'You are a test agent.',
				'post_author'  => $user->ID,
			)
		);
		desktop_mode_agent_link_guideline( $user->ID, $guideline_id );
		desktop_mode_agents_set_abilities( $guideline_id, array( 'media/upload' ) );

		$result = desktop_mode_agents_personal_data_exporter( $user->user_email );

		$this->assertTrue( $result['done'] );
		$this->assertCount( 1, $result['data'] );
		$entry = $result['data'][0];
		$this->assertSame( 'desktop-mode-agents', $entry['group_id'] );
		$this->assertStringStartsWith( 'agent-', (string) $entry['item_id'] );

		$values = wp_list_pluck( $entry['data'], 'value', 'name' );
		$this->assertSame( 'Privacy Test', $values['Agent display name'] );
		$this->assertSame( 'A test agent.', $values['Description'] );
		$this->assertSame( 'You are a test agent.', $values['Instructions (system prompt)'] );
		$this->assertSame( 'editor', $values['Role'] );
		$this->assertStringContainsString( 'media/upload', $values['Enabled abilities'] );
	}

	/**
	 * Non-agent emails (real human users) are not represented in our
	 * export. Agents are admin-managed assets, not personal data of
	 * the humans authoring them.
	 *
	 * @covers ::desktop_mode_agents_personal_data_exporter
	 */
	public function test_exporter_is_noop_for_human_email() {
		$human = $this->factory()->user->create_and_get( array( 'role' => 'editor' ) );
		$result = desktop_mode_agents_personal_data_exporter( $human->user_email );
		$this->assertSame( array(), $result['data'] );
		$this->assertTrue( $result['done'] );
	}

	/**
	 * @covers ::desktop_mode_agents_personal_data_eraser
	 */
	public function test_eraser_removes_agent_and_linked_guideline() {
		$user = desktop_mode_agent_create_user(
			array(
				'name' => 'Erase Me',
				'role' => 'editor',
			)
		);
		$guideline_id = wp_insert_post(
			array(
				'post_type'   => 'wp_guideline',
				'post_status' => 'publish',
				'post_title'  => 'Erase Me',
				'post_author' => $user->ID,
			)
		);
		desktop_mode_agent_link_guideline( $user->ID, $guideline_id );

		$result = desktop_mode_agents_personal_data_eraser( $user->user_email );

		$this->assertTrue( $result['done'] );
		$this->assertTrue( $result['items_removed'] );
		$this->assertFalse( $result['items_retained'] );
		$this->assertFalse( get_user_by( 'ID', $user->ID ) );
		$this->assertNull( get_post( $guideline_id ) );
	}

	/**
	 * @covers ::desktop_mode_agents_personal_data_eraser
	 */
	public function test_eraser_is_noop_for_human_email() {
		$human = $this->factory()->user->create_and_get( array( 'role' => 'editor' ) );
		$result = desktop_mode_agents_personal_data_eraser( $human->user_email );
		$this->assertFalse( $result['items_removed'] );
		$this->assertFalse( $result['items_retained'] );
		$this->assertTrue( $result['done'] );
		// Human user is untouched.
		$this->assertNotFalse( get_user_by( 'ID', $human->ID ) );
	}
}
