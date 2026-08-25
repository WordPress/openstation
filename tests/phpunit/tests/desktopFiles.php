<?php
/**
 * Tests for the desktop files registry — `openstation_register_file_type()`,
 * `openstation_resolve_file()`, and the seven built-in `OpenStation_File`
 * subclasses.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-files
 */
class Tests_OpenStation_Files extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	public function tear_down() {
		remove_all_filters( 'openstation_file_types' );
		remove_all_filters( 'openstation_file_serialize' );
		remove_all_actions( 'openstation_file_type_registered' );
		parent::tear_down();
	}

	/**
	 * @covers ::openstation_register_file_type
	 */
	public function test_built_in_types_are_registered() {
		$types = wp_list_pluck( openstation_get_file_types(), 'type' );
		foreach ( array( 'post', 'attachment', 'user', 'term', 'comment', 'folder', 'bookmark', 'link', 'embed' ) as $expected ) {
			$this->assertContains( $expected, $types );
		}
	}

	/**
	 * @covers ::openstation_register_file_type
	 */
	public function test_register_with_missing_id_returns_wp_error() {
		$result = openstation_register_file_type( '', array(
			'label' => 'X',
			'class' => 'OpenStation_Post_File',
		) );
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_missing_id', $result->get_error_code() );
	}

	/**
	 * @covers ::openstation_register_file_type
	 */
	public function test_register_with_missing_label_returns_wp_error() {
		$result = openstation_register_file_type( 'no-label', array(
			'class' => 'OpenStation_Post_File',
		) );
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_missing_label', $result->get_error_code() );
	}

	/**
	 * @covers ::openstation_register_file_type
	 */
	public function test_register_with_unknown_class_returns_wp_error() {
		$result = openstation_register_file_type( 'broken', array(
			'label' => 'Broken',
			'class' => 'Definitely_Not_A_Class',
		) );
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_invalid_class', $result->get_error_code() );
	}

	/**
	 * @covers ::openstation_register_file_type
	 */
	public function test_register_with_class_not_extending_base_returns_wp_error() {
		$result = openstation_register_file_type( 'wrong-base', array(
			'label' => 'Wrong base',
			'class' => 'WP_Post', // Real class, not a OpenStation_File.
		) );
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_invalid_class', $result->get_error_code() );
	}

	/**
	 * @covers ::openstation_resolve_file
	 */
	public function test_resolve_returns_instance_of_correct_class() {
		$post_id = self::factory()->post->create();
		$file    = openstation_resolve_file( 'post', $post_id );
		$this->assertInstanceOf( 'OpenStation_Post_File', $file );
		$this->assertSame( (string) $post_id, $file->ref() );
	}

	/**
	 * @covers ::openstation_resolve_file
	 */
	public function test_resolve_unknown_type_returns_null() {
		$this->assertNull( openstation_resolve_file( 'never-registered', 1 ) );
	}

	/**
	 * @covers OpenStation_Post_File
	 */
	public function test_post_file_serializes_known_post() {
		$post_id = self::factory()->post->create( array( 'post_title' => 'Hello' ) );
		$file    = openstation_resolve_file( 'post', $post_id );
		$shape   = $file->serialize();
		$this->assertSame( 'post', $shape['type'] );
		$this->assertSame( (string) $post_id, $shape['ref'] );
		$this->assertSame( 'Hello', $shape['title'] );
		$this->assertTrue( $shape['exists'] );
	}

	/**
	 * @covers OpenStation_Post_File
	 */
	public function test_post_file_handles_missing_post() {
		$file  = openstation_resolve_file( 'post', 999999 );
		$shape = $file->serialize();
		$this->assertFalse( $shape['exists'] );
	}

	/**
	 * The tile writes this string with `textContent`, so an entity
	 * left encoded is read by the user as itself.
	 *
	 * @covers OpenStation_File::serialize
	 * @covers ::openstation_plain_text_title
	 */
	public function test_serialized_title_is_plain_text_not_entities() {
		$post_id = self::factory()->post->create(
			array( 'post_title' => "Alder & Oak's \"Best\" Insulation" )
		);
		$shape = openstation_resolve_file( 'post', $post_id )->serialize();

		$this->assertStringNotContainsString( '&#', $shape['title'] );
		$this->assertStringContainsString( 'Alder & Oak', $shape['title'] );
	}

	/**
	 * Decoding runs before the tag strip, so an encoded tag cannot be
	 * decoded back into live markup on the way out.
	 *
	 * @covers ::openstation_plain_text_title
	 */
	public function test_plain_text_title_cannot_resurrect_markup() {
		$this->assertStringNotContainsString(
			'<',
			openstation_plain_text_title( '&lt;script&gt;alert(1)&lt;/script&gt;' )
		);
		$this->assertSame( 'Bold', openstation_plain_text_title( '<b>Bold</b>' ) );
		$this->assertSame( 'Ben & Jerry', openstation_plain_text_title( 'Ben &#038; Jerry' ) );
	}

	/**
	 * @covers OpenStation_User_File
	 */
	public function test_user_file_serializes_known_user() {
		$user_id = self::factory()->user->create( array( 'display_name' => 'Tony' ) );
		$file    = openstation_resolve_file( 'user', $user_id );
		$shape   = $file->serialize();
		$this->assertSame( 'user', $shape['type'] );
		$this->assertSame( 'Tony', $shape['title'] );
	}

	/**
	 * @covers OpenStation_Term_File
	 */
	public function test_term_file_uses_taxonomy_id_ref() {
		$term_id = self::factory()->term->create( array( 'taxonomy' => 'category', 'name' => 'Avengers' ) );
		$file    = openstation_resolve_file( 'term', "category:{$term_id}" );
		$shape   = $file->serialize();
		$this->assertSame( 'Avengers', $shape['title'] );
		$this->assertSame( 'category', $shape['taxonomy'] );
	}

	/**
	 * @covers OpenStation_Bookmark_File
	 */
	public function test_bookmark_file_uses_url_as_ref() {
		$file  = openstation_resolve_file( 'bookmark', 'https://example.com/page' );
		$shape = $file->serialize();
		$this->assertSame( 'bookmark', $shape['type'] );
		$this->assertSame( 'example.com', $shape['title'] );
		$this->assertSame( 'https://example.com/page', $shape['url'] );
	}

	/**
	 * @covers OpenStation_Bookmark_File
	 */
	public function test_bookmark_file_rejects_javascript_url() {
		$file = openstation_resolve_file( 'bookmark', 'javascript:alert(1)' );
		$this->assertFalse( $file->exists() );
	}

	/**
	 * @covers OpenStation_Link_File
	 */
	public function test_link_file_serializes_url_and_host_title() {
		$file  = openstation_resolve_file( 'link', 'https://example.com/path' );
		$shape = $file->serialize();
		$this->assertSame( 'link', $shape['type'] );
		$this->assertSame( 'example.com', $shape['title'] );
		$this->assertSame( 'https://example.com/path', $shape['url'] );
		$this->assertSame( 'dashicons-admin-links', $shape['icon'] );
		$this->assertTrue( $shape['exists'] );
	}

	/**
	 * @covers OpenStation_Link_File
	 */
	public function test_link_file_rejects_javascript_url() {
		$file = openstation_resolve_file( 'link', 'javascript:alert(1)' );
		$this->assertFalse( $file->exists() );
	}

	/**
	 * @covers OpenStation_Embed_File
	 */
	public function test_embed_file_serializes_url_and_host_title() {
		$file  = openstation_resolve_file( 'embed', 'https://example.com/dashboard' );
		$shape = $file->serialize();
		$this->assertSame( 'embed', $shape['type'] );
		$this->assertSame( 'example.com', $shape['title'] );
		$this->assertSame( 'https://example.com/dashboard', $shape['url'] );
		$this->assertSame( 'dashicons-welcome-view-site', $shape['icon'] );
		$this->assertTrue( $shape['exists'] );
	}

	/**
	 * @covers OpenStation_Embed_File
	 */
	public function test_embed_file_rejects_empty_ref() {
		$file = openstation_resolve_file( 'embed', '' );
		$this->assertFalse( $file->exists() );
	}

	/**
	 * @covers ::openstation_register_file_type
	 */
	public function test_registered_action_fires_on_success() {
		$calls = array();
		add_action( 'openstation_file_type_registered', static function ( $type, $entry ) use ( &$calls ) {
			$calls[] = array( 'type' => $type, 'entry' => $entry );
		}, 10, 2 );

		// Use a one-off subclass so we don't pollute the built-in registry with a fake.
		eval( 'class Tests_Custom_File extends OpenStation_File { public static function type(): string { return "custom"; } public function title(): string { return "x"; } }' );

		$result = openstation_register_file_type( 'custom', array(
			'label' => 'Custom',
			'class' => 'Tests_Custom_File',
		) );

		$this->assertTrue( $result );
		$this->assertCount( 1, $calls );
		$this->assertSame( 'custom', $calls[0]['type'] );
	}

	/**
	 * @covers ::openstation_get_file_types
	 */
	public function test_filter_can_remove_file_type() {
		add_filter( 'openstation_file_types', static function ( $registry ) {
			unset( $registry['comment'] );
			return $registry;
		} );

		$ids = wp_list_pluck( openstation_get_file_types(), 'type' );
		$this->assertNotContains( 'comment', $ids );
	}

	/**
	 * @covers OpenStation_File::serialize
	 */
	public function test_serialize_filter_can_attach_extra_fields() {
		add_filter( 'openstation_file_serialize', static function ( $shape, $file ) {
			$shape['badge'] = 'NEW';
			return $shape;
		}, 10, 2 );

		$post_id = self::factory()->post->create();
		$shape   = openstation_resolve_file( 'post', $post_id )->serialize();
		$this->assertSame( 'NEW', $shape['badge'] );
	}

	/**
	 * @covers ::openstation_build_file_types_payload
	 */
	public function test_payload_shape() {
		$payload = openstation_build_file_types_payload();
		$this->assertNotEmpty( $payload );
		foreach ( $payload as $entry ) {
			$this->assertArrayHasKey( 'id', $entry );
			$this->assertArrayHasKey( 'label', $entry );
			$this->assertArrayHasKey( 'sort', $entry );
			$this->assertArrayHasKey( 'scriptUrl', $entry );
		}
	}
}
