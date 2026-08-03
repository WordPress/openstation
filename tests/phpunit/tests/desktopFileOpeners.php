<?php
/**
 * Tests for the desktop file-opener registry —
 * `openstation_register_file_opener()`,
 * `openstation_resolve_file_opener_id()`, and
 * `openstation_get_user_file_associations()`.
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
		remove_all_filters( 'openstation_file_openers' );
		remove_all_filters( 'openstation_resolve_file_opener' );
		remove_all_actions( 'openstation_file_opener_registered' );
		delete_user_meta( self::$admin_id, OPENSTATION_FILE_ASSOCIATIONS_META );
		parent::tear_down();
	}

	/**
	 * @covers ::openstation_register_file_opener
	 */
	public function test_built_in_openers_are_registered() {
		$ids = wp_list_pluck( openstation_get_file_openers(), 'id' );
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
	 * @covers ::openstation_register_file_opener
	 */
	public function test_register_with_missing_id_returns_wp_error() {
		$result = openstation_register_file_opener( '', array(
			'label' => 'X',
			'types' => array( 'post' ),
		) );
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_missing_id', $result->get_error_code() );
	}

	/**
	 * @covers ::openstation_register_file_opener
	 */
	public function test_register_with_missing_label_returns_wp_error() {
		$result = openstation_register_file_opener( 'no-label', array(
			'types' => array( 'post' ),
		) );
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_missing_label', $result->get_error_code() );
	}

	/**
	 * @covers ::openstation_register_file_opener
	 */
	public function test_register_with_no_types_returns_wp_error() {
		$result = openstation_register_file_opener( 'no-types', array(
			'label' => 'X',
			'types' => array(),
		) );
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_missing_types', $result->get_error_code() );
	}

	/**
	 * @covers ::openstation_resolve_file_opener_id
	 */
	public function test_resolve_returns_default_when_no_user_override() {
		$id = openstation_resolve_file_opener_id( 'post', self::$admin_id );
		$this->assertSame( 'wp-post-editor', $id );
	}

	/**
	 * @covers ::openstation_resolve_file_opener_id
	 */
	public function test_resolve_honors_user_override() {
		openstation_register_file_opener( 'alt-post', array(
			'label' => 'Alt post editor',
			'types' => array( 'post' ),
		) );
		update_user_meta( self::$admin_id, OPENSTATION_FILE_ASSOCIATIONS_META, array(
			'post' => 'alt-post',
		) );
		$id = openstation_resolve_file_opener_id( 'post', self::$admin_id );
		$this->assertSame( 'alt-post', $id );
	}

	/**
	 * @covers ::openstation_resolve_file_opener_id
	 */
	public function test_resolve_ignores_unknown_user_override() {
		update_user_meta( self::$admin_id, OPENSTATION_FILE_ASSOCIATIONS_META, array(
			'post' => 'plugin-deactivated',
		) );
		$id = openstation_resolve_file_opener_id( 'post', self::$admin_id );
		// Falls back to is_default opener.
		$this->assertSame( 'wp-post-editor', $id );
	}

	/**
	 * @covers ::openstation_resolve_file_opener_id
	 */
	public function test_resolve_returns_empty_string_for_unknown_type() {
		$id = openstation_resolve_file_opener_id( 'never-registered', self::$admin_id );
		$this->assertSame( '', $id );
	}

	/**
	 * @covers ::openstation_resolve_file_opener_id
	 */
	public function test_resolve_filter_can_override() {
		add_filter( 'openstation_resolve_file_opener', static function ( $id, $type ) {
			return 'forced-' . $type;
		}, 10, 2 );
		$id = openstation_resolve_file_opener_id( 'post', self::$admin_id );
		$this->assertSame( 'forced-post', $id );
	}

	/**
	 * @covers ::openstation_get_user_file_associations
	 */
	public function test_user_associations_drop_unknown_opener_ids() {
		update_user_meta( self::$admin_id, OPENSTATION_FILE_ASSOCIATIONS_META, array(
			'post' => 'wp-post-editor',
			'user' => 'plugin-gone',
		) );
		$assoc = openstation_get_user_file_associations( self::$admin_id );
		$this->assertSame( array( 'post' => 'wp-post-editor' ), $assoc );
	}

	/**
	 * @covers ::openstation_get_user_file_associations
	 */
	public function test_user_associations_drop_type_mismatches() {
		// `wp-post-editor` only handles `post`, not `user`. The
		// pair should be dropped from the resolved map.
		update_user_meta( self::$admin_id, OPENSTATION_FILE_ASSOCIATIONS_META, array(
			'user' => 'wp-post-editor',
		) );
		$assoc = openstation_get_user_file_associations( self::$admin_id );
		$this->assertSame( array(), $assoc );
	}

	/**
	 * @covers ::openstation_build_file_openers_payload
	 */
	public function test_payload_shape() {
		$payload = openstation_build_file_openers_payload();
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
	 * @covers ::openstation_register_file_opener
	 */
	public function test_registered_action_fires_on_success() {
		$calls = array();
		add_action( 'openstation_file_opener_registered', static function ( $id ) use ( &$calls ) {
			$calls[] = $id;
		} );
		$result = openstation_register_file_opener( 'fires', array(
			'label' => 'Fires',
			'types' => array( 'post' ),
		) );
		$this->assertTrue( $result );
		$this->assertContains( 'fires', $calls );
	}
}
