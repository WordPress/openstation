<?php
/**
 * Tests for the desktop file-opener registry —
 * `open_station_register_file_opener()`,
 * `open_station_resolve_file_opener_id()`, and
 * `open_station_get_user_file_associations()`.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-files
 */
class Tests_OpenStation_FileOpeners extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	public function tear_down() {
		remove_all_filters( 'open_station_file_openers' );
		remove_all_filters( 'open_station_resolve_file_opener' );
		remove_all_actions( 'open_station_file_opener_registered' );
		delete_user_meta( self::$admin_id, OPEN_STATION_FILE_ASSOCIATIONS_META );
		parent::tear_down();
	}

	/**
	 * @covers ::open_station_register_file_opener
	 */
	public function test_built_in_openers_are_registered() {
		$ids = wp_list_pluck( open_station_get_file_openers(), 'id' );
		$expected = array(
			'wp-post-editor',
			'wp-media-editor',
			'wp-user-profile',
			'wp-term-editor',
			'wp-comment-editor',
			'browser-navigate',
		);
		foreach ( $expected as $id ) {
			$this->assertContains( $id, $ids );
		}
	}

	/**
	 * @covers ::open_station_register_file_opener
	 */
	public function test_register_with_missing_id_returns_wp_error() {
		$result = open_station_register_file_opener( '', array(
			'label' => 'X',
			'types' => array( 'post' ),
		) );
		$this->assertWPError( $result );
		$this->assertSame( 'open_station_missing_id', $result->get_error_code() );
	}

	/**
	 * @covers ::open_station_register_file_opener
	 */
	public function test_register_with_missing_label_returns_wp_error() {
		$result = open_station_register_file_opener( 'no-label', array(
			'types' => array( 'post' ),
		) );
		$this->assertWPError( $result );
		$this->assertSame( 'open_station_missing_label', $result->get_error_code() );
	}

	/**
	 * @covers ::open_station_register_file_opener
	 */
	public function test_register_with_no_types_returns_wp_error() {
		$result = open_station_register_file_opener( 'no-types', array(
			'label' => 'X',
			'types' => array(),
		) );
		$this->assertWPError( $result );
		$this->assertSame( 'open_station_missing_types', $result->get_error_code() );
	}

	/**
	 * @covers ::open_station_resolve_file_opener_id
	 */
	public function test_resolve_returns_default_when_no_user_override() {
		$id = open_station_resolve_file_opener_id( 'post', self::$admin_id );
		$this->assertSame( 'wp-post-editor', $id );
	}

	/**
	 * @covers ::open_station_resolve_file_opener_id
	 */
	public function test_resolve_honors_user_override() {
		open_station_register_file_opener( 'alt-post', array(
			'label' => 'Alt post editor',
			'types' => array( 'post' ),
		) );
		update_user_meta( self::$admin_id, OPEN_STATION_FILE_ASSOCIATIONS_META, array(
			'post' => 'alt-post',
		) );
		$id = open_station_resolve_file_opener_id( 'post', self::$admin_id );
		$this->assertSame( 'alt-post', $id );
	}

	/**
	 * @covers ::open_station_resolve_file_opener_id
	 */
	public function test_resolve_ignores_unknown_user_override() {
		update_user_meta( self::$admin_id, OPEN_STATION_FILE_ASSOCIATIONS_META, array(
			'post' => 'plugin-deactivated',
		) );
		$id = open_station_resolve_file_opener_id( 'post', self::$admin_id );
		// Falls back to is_default opener.
		$this->assertSame( 'wp-post-editor', $id );
	}

	/**
	 * @covers ::open_station_resolve_file_opener_id
	 */
	public function test_resolve_returns_empty_string_for_unknown_type() {
		$id = open_station_resolve_file_opener_id( 'never-registered', self::$admin_id );
		$this->assertSame( '', $id );
	}

	/**
	 * @covers ::open_station_resolve_file_opener_id
	 */
	public function test_resolve_filter_can_override() {
		add_filter( 'open_station_resolve_file_opener', static function ( $id, $type ) {
			return 'forced-' . $type;
		}, 10, 2 );
		$id = open_station_resolve_file_opener_id( 'post', self::$admin_id );
		$this->assertSame( 'forced-post', $id );
	}

	/**
	 * @covers ::open_station_get_user_file_associations
	 */
	public function test_user_associations_drop_unknown_opener_ids() {
		update_user_meta( self::$admin_id, OPEN_STATION_FILE_ASSOCIATIONS_META, array(
			'post' => 'wp-post-editor',
			'user' => 'plugin-gone',
		) );
		$assoc = open_station_get_user_file_associations( self::$admin_id );
		$this->assertSame( array( 'post' => 'wp-post-editor' ), $assoc );
	}

	/**
	 * @covers ::open_station_get_user_file_associations
	 */
	public function test_user_associations_drop_type_mismatches() {
		// `wp-post-editor` only handles `post`, not `user`. The
		// pair should be dropped from the resolved map.
		update_user_meta( self::$admin_id, OPEN_STATION_FILE_ASSOCIATIONS_META, array(
			'user' => 'wp-post-editor',
		) );
		$assoc = open_station_get_user_file_associations( self::$admin_id );
		$this->assertSame( array(), $assoc );
	}

	/**
	 * @covers ::open_station_build_file_openers_payload
	 */
	public function test_payload_shape() {
		$payload = open_station_build_file_openers_payload();
		$this->assertNotEmpty( $payload );
		foreach ( $payload as $entry ) {
			$this->assertArrayHasKey( 'id', $entry );
			$this->assertArrayHasKey( 'label', $entry );
			$this->assertArrayHasKey( 'types', $entry );
			$this->assertArrayHasKey( 'isDefault', $entry );
			$this->assertArrayHasKey( 'sort', $entry );
		}
	}

	/**
	 * @covers ::open_station_register_file_opener
	 */
	public function test_registered_action_fires_on_success() {
		$calls = array();
		add_action( 'open_station_file_opener_registered', static function ( $id ) use ( &$calls ) {
			$calls[] = $id;
		} );
		$result = open_station_register_file_opener( 'fires', array(
			'label' => 'Fires',
			'types' => array( 'post' ),
		) );
		$this->assertTrue( $result );
		$this->assertContains( 'fires', $calls );
	}
}
