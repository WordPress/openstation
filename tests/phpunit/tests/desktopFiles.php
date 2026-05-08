<?php
/**
 * Tests for the desktop files registry — `desktop_mode_register_file_type()`,
 * `desktop_mode_resolve_file()`, and the seven built-in `Desktop_Mode_File`
 * subclasses.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-files
 */
class Tests_DesktopMode_Files extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	public function tear_down() {
		remove_all_filters( 'desktop_mode_file_types' );
		remove_all_filters( 'desktop_mode_file_serialize' );
		remove_all_actions( 'desktop_mode_file_type_registered' );
		parent::tear_down();
	}

	/**
	 * @covers ::desktop_mode_register_file_type
	 */
	public function test_built_in_types_are_registered() {
		$types = wp_list_pluck( desktop_mode_get_file_types(), 'type' );
		foreach ( array( 'post', 'attachment', 'user', 'term', 'comment', 'folder', 'bookmark', 'link', 'embed' ) as $expected ) {
			$this->assertContains( $expected, $types );
		}
	}

	/**
	 * @covers ::desktop_mode_register_file_type
	 */
	public function test_register_with_missing_id_returns_wp_error() {
		$result = desktop_mode_register_file_type( '', array(
			'label' => 'X',
			'class' => 'Desktop_Mode_Post_File',
		) );
		$this->assertWPError( $result );
		$this->assertSame( 'desktop_mode_missing_id', $result->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_register_file_type
	 */
	public function test_register_with_missing_label_returns_wp_error() {
		$result = desktop_mode_register_file_type( 'no-label', array(
			'class' => 'Desktop_Mode_Post_File',
		) );
		$this->assertWPError( $result );
		$this->assertSame( 'desktop_mode_missing_label', $result->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_register_file_type
	 */
	public function test_register_with_unknown_class_returns_wp_error() {
		$result = desktop_mode_register_file_type( 'broken', array(
			'label' => 'Broken',
			'class' => 'Definitely_Not_A_Class',
		) );
		$this->assertWPError( $result );
		$this->assertSame( 'desktop_mode_invalid_class', $result->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_register_file_type
	 */
	public function test_register_with_class_not_extending_base_returns_wp_error() {
		$result = desktop_mode_register_file_type( 'wrong-base', array(
			'label' => 'Wrong base',
			'class' => 'WP_Post', // Real class, not a Desktop_Mode_File.
		) );
		$this->assertWPError( $result );
		$this->assertSame( 'desktop_mode_invalid_class', $result->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_resolve_file
	 */
	public function test_resolve_returns_instance_of_correct_class() {
		$post_id = self::factory()->post->create();
		$file    = desktop_mode_resolve_file( 'post', $post_id );
		$this->assertInstanceOf( 'Desktop_Mode_Post_File', $file );
		$this->assertSame( (string) $post_id, $file->ref() );
	}

	/**
	 * @covers ::desktop_mode_resolve_file
	 */
	public function test_resolve_unknown_type_returns_null() {
		$this->assertNull( desktop_mode_resolve_file( 'never-registered', 1 ) );
	}

	/**
	 * @covers Desktop_Mode_Post_File
	 */
	public function test_post_file_serializes_known_post() {
		$post_id = self::factory()->post->create( array( 'post_title' => 'Hello' ) );
		$file    = desktop_mode_resolve_file( 'post', $post_id );
		$shape   = $file->serialize();
		$this->assertSame( 'post', $shape['type'] );
		$this->assertSame( (string) $post_id, $shape['ref'] );
		$this->assertSame( 'Hello', $shape['title'] );
		$this->assertTrue( $shape['exists'] );
	}

	/**
	 * @covers Desktop_Mode_Post_File
	 */
	public function test_post_file_handles_missing_post() {
		$file  = desktop_mode_resolve_file( 'post', 999999 );
		$shape = $file->serialize();
		$this->assertFalse( $shape['exists'] );
	}

	/**
	 * @covers Desktop_Mode_User_File
	 */
	public function test_user_file_serializes_known_user() {
		$user_id = self::factory()->user->create( array( 'display_name' => 'Tony' ) );
		$file    = desktop_mode_resolve_file( 'user', $user_id );
		$shape   = $file->serialize();
		$this->assertSame( 'user', $shape['type'] );
		$this->assertSame( 'Tony', $shape['title'] );
	}

	/**
	 * @covers Desktop_Mode_Term_File
	 */
	public function test_term_file_uses_taxonomy_id_ref() {
		$term_id = self::factory()->term->create( array( 'taxonomy' => 'category', 'name' => 'Avengers' ) );
		$file    = desktop_mode_resolve_file( 'term', "category:{$term_id}" );
		$shape   = $file->serialize();
		$this->assertSame( 'Avengers', $shape['title'] );
		$this->assertSame( 'category', $shape['taxonomy'] );
	}

	/**
	 * @covers Desktop_Mode_Bookmark_File
	 */
	public function test_bookmark_file_uses_url_as_ref() {
		$file  = desktop_mode_resolve_file( 'bookmark', 'https://example.com/page' );
		$shape = $file->serialize();
		$this->assertSame( 'bookmark', $shape['type'] );
		$this->assertSame( 'example.com', $shape['title'] );
		$this->assertSame( 'https://example.com/page', $shape['url'] );
	}

	/**
	 * @covers Desktop_Mode_Bookmark_File
	 */
	public function test_bookmark_file_rejects_javascript_url() {
		$file = desktop_mode_resolve_file( 'bookmark', 'javascript:alert(1)' );
		$this->assertFalse( $file->exists() );
	}

	/**
	 * @covers Desktop_Mode_Link_File
	 */
	public function test_link_file_serializes_url_and_host_title() {
		$file  = desktop_mode_resolve_file( 'link', 'https://example.com/path' );
		$shape = $file->serialize();
		$this->assertSame( 'link', $shape['type'] );
		$this->assertSame( 'example.com', $shape['title'] );
		$this->assertSame( 'https://example.com/path', $shape['url'] );
		$this->assertSame( 'dashicons-admin-links', $shape['icon'] );
		$this->assertTrue( $shape['exists'] );
	}

	/**
	 * @covers Desktop_Mode_Link_File
	 */
	public function test_link_file_rejects_javascript_url() {
		$file = desktop_mode_resolve_file( 'link', 'javascript:alert(1)' );
		$this->assertFalse( $file->exists() );
	}

	/**
	 * @covers Desktop_Mode_Embed_File
	 */
	public function test_embed_file_serializes_url_and_host_title() {
		$file  = desktop_mode_resolve_file( 'embed', 'https://example.com/dashboard' );
		$shape = $file->serialize();
		$this->assertSame( 'embed', $shape['type'] );
		$this->assertSame( 'example.com', $shape['title'] );
		$this->assertSame( 'https://example.com/dashboard', $shape['url'] );
		$this->assertSame( 'dashicons-welcome-view-site', $shape['icon'] );
		$this->assertTrue( $shape['exists'] );
	}

	/**
	 * @covers Desktop_Mode_Embed_File
	 */
	public function test_embed_file_rejects_empty_ref() {
		$file = desktop_mode_resolve_file( 'embed', '' );
		$this->assertFalse( $file->exists() );
	}

	/**
	 * @covers ::desktop_mode_register_file_type
	 */
	public function test_registered_action_fires_on_success() {
		$calls = array();
		add_action( 'desktop_mode_file_type_registered', static function ( $type, $entry ) use ( &$calls ) {
			$calls[] = array( 'type' => $type, 'entry' => $entry );
		}, 10, 2 );

		// Use a one-off subclass so we don't pollute the built-in registry with a fake.
		eval( 'class Tests_Custom_File extends Desktop_Mode_File { public static function type(): string { return "custom"; } public function title(): string { return "x"; } }' );

		$result = desktop_mode_register_file_type( 'custom', array(
			'label' => 'Custom',
			'class' => 'Tests_Custom_File',
		) );

		$this->assertTrue( $result );
		$this->assertCount( 1, $calls );
		$this->assertSame( 'custom', $calls[0]['type'] );
	}

	/**
	 * @covers ::desktop_mode_get_file_types
	 */
	public function test_filter_can_remove_file_type() {
		add_filter( 'desktop_mode_file_types', static function ( $registry ) {
			unset( $registry['comment'] );
			return $registry;
		} );

		$ids = wp_list_pluck( desktop_mode_get_file_types(), 'type' );
		$this->assertNotContains( 'comment', $ids );
	}

	/**
	 * @covers Desktop_Mode_File::serialize
	 */
	public function test_serialize_filter_can_attach_extra_fields() {
		add_filter( 'desktop_mode_file_serialize', static function ( $shape, $file ) {
			$shape['badge'] = 'NEW';
			return $shape;
		}, 10, 2 );

		$post_id = self::factory()->post->create();
		$shape   = desktop_mode_resolve_file( 'post', $post_id )->serialize();
		$this->assertSame( 'NEW', $shape['badge'] );
	}

	/**
	 * @covers ::desktop_mode_build_file_types_payload
	 */
	public function test_payload_shape() {
		$payload = desktop_mode_build_file_types_payload();
		$this->assertNotEmpty( $payload );
		foreach ( $payload as $entry ) {
			$this->assertArrayHasKey( 'id', $entry );
			$this->assertArrayHasKey( 'label', $entry );
			$this->assertArrayHasKey( 'sort', $entry );
			$this->assertArrayHasKey( 'scriptUrl', $entry );
		}
	}
}
