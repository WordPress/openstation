<?php
/**
 * Tests for Phase-6 sharing visibility + Heartbeat delta.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-files
 */
class Tests_DesktopMode_FilesSharing extends WP_UnitTestCase {

	protected static $owner_id;
	protected static $editor_id;
	protected static $subscriber_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$owner_id      = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$editor_id     = $factory->user->create( array( 'role' => 'editor' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
	}

	public function set_up() {
		parent::set_up();
		desktop_mode_files_install_schema();
	}

	public function tear_down() {
		global $wpdb;
		$tables = desktop_mode_files_table_names();
		foreach ( $tables as $t ) {
			$wpdb->query( "TRUNCATE TABLE $t" );
		}
		parent::tear_down();
	}

	/**
	 * @covers ::desktop_mode_files_compute_visible_folders
	 */
	public function test_private_folder_is_invisible_to_non_owner() {
		desktop_mode_files_create_folder( self::$owner_id, array( 'name' => 'Private' ) );
		$visible = desktop_mode_files_get_visible_folders( self::$editor_id );
		$this->assertSame( array(), $visible );
	}

	/**
	 * @covers ::desktop_mode_files_compute_visible_folders
	 */
	public function test_all_share_mode_is_visible_to_anyone() {
		$id = desktop_mode_files_create_folder( self::$owner_id, array(
			'name'       => 'Public',
			'share_mode' => 'all',
		) );
		$visible = desktop_mode_files_get_visible_folders( self::$editor_id );
		$ids     = wp_list_pluck( $visible, 'id' );
		$this->assertContains( $id, $ids );
	}

	/**
	 * @covers ::desktop_mode_files_compute_visible_folders
	 */
	public function test_users_share_mode_filters_by_id() {
		$id = desktop_mode_files_create_folder( self::$owner_id, array(
			'name'       => 'Shared with editor',
			'share_mode' => 'users',
			'share_meta' => array( 'users' => array( self::$editor_id ) ),
		) );
		$visible_to_editor = wp_list_pluck( desktop_mode_files_get_visible_folders( self::$editor_id ), 'id' );
		$visible_to_sub    = wp_list_pluck( desktop_mode_files_get_visible_folders( self::$subscriber_id ), 'id' );
		$this->assertContains( $id, $visible_to_editor );
		$this->assertNotContains( $id, $visible_to_sub );
	}

	/**
	 * @covers ::desktop_mode_files_compute_visible_folders
	 */
	public function test_roles_share_mode_filters_by_role() {
		$id = desktop_mode_files_create_folder( self::$owner_id, array(
			'name'       => 'Editors only',
			'share_mode' => 'roles',
			'share_meta' => array( 'roles' => array( 'editor' ) ),
		) );
		$visible_to_editor = wp_list_pluck( desktop_mode_files_get_visible_folders( self::$editor_id ), 'id' );
		$visible_to_sub    = wp_list_pluck( desktop_mode_files_get_visible_folders( self::$subscriber_id ), 'id' );
		$this->assertContains( $id, $visible_to_editor );
		$this->assertNotContains( $id, $visible_to_sub );
	}

	/**
	 * @covers ::desktop_mode_files_compute_visible_folders
	 */
	public function test_owner_always_sees_their_own() {
		$id = desktop_mode_files_create_folder( self::$owner_id, array(
			'name'       => 'My folder',
			'share_mode' => 'private',
		) );
		$visible = wp_list_pluck( desktop_mode_files_get_visible_folders( self::$owner_id ), 'id' );
		$this->assertContains( $id, $visible );
	}

	/**
	 * @covers ::desktop_mode_files_compute_heartbeat_delta
	 */
	public function test_heartbeat_delta_returns_new_folders_since_version() {
		$id = desktop_mode_files_create_folder( self::$owner_id, array(
			'name'       => 'Public',
			'share_mode' => 'all',
		) );
		$folder = desktop_mode_files_get_folder( $id );
		$delta = desktop_mode_files_compute_heartbeat_delta(
			self::$editor_id,
			array(),
			0,
			200
		);
		$folder_ids = wp_list_pluck( $delta['folders'], 'id' );
		$this->assertContains( $id, $folder_ids );

		// Pretend the client has now seen this folder.
		$delta2 = desktop_mode_files_compute_heartbeat_delta(
			self::$editor_id,
			array( (string) $id => (int) $folder['updated_at_ms'] ),
			$delta['serverTimeMs'],
			200
		);
		$this->assertSame( array(), $delta2['folders'] );
	}

	/**
	 * @covers ::desktop_mode_files_compute_heartbeat_delta
	 */
	public function test_heartbeat_delta_includes_tombstones_after_remove() {
		$post_id = self::factory()->post->create();
		$pid = desktop_mode_files_place( self::$owner_id, 0, 'post', (string) $post_id );
		desktop_mode_files_remove( $pid, self::$owner_id );

		$delta = desktop_mode_files_compute_heartbeat_delta(
			self::$owner_id,
			array(),
			0,
			200
		);
		$this->assertContains( $pid, $delta['removed']['placements'] );
	}

	/**
	 * @covers ::desktop_mode_files_compute_heartbeat_delta
	 */
	public function test_heartbeat_delta_truncated_flag() {
		// Create more folders than the cap of 5.
		for ( $i = 0; $i < 7; $i++ ) {
			desktop_mode_files_create_folder( self::$owner_id, array(
				'name'       => 'F' . $i,
				'share_mode' => 'all',
			) );
		}
		$delta = desktop_mode_files_compute_heartbeat_delta(
			self::$editor_id,
			array(),
			0,
			5
		);
		$this->assertTrue( $delta['truncated'] );
		$this->assertCount( 5, $delta['folders'] );
	}
}
