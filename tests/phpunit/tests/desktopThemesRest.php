<?php
/**
 * Tests for the desktop-theme REST routes.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-themes
 */
class Tests_OpenStation_DesktopThemesRest extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $editor_id;

	/** @var WP_REST_Server */
	protected $server;

	/** @var string[] */
	private $temp_files = array();

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id  = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$editor_id = $factory->user->create( array( 'role' => 'editor' ) );
	}

	public function set_up() {
		parent::set_up();
		if ( ! class_exists( 'ZipArchive' ) ) {
			$this->markTestSkipped( 'ZipArchive is required for the theme installer.' );
		}
		global $wp_rest_server;
		$wp_rest_server = new WP_REST_Server();
		$this->server   = $wp_rest_server;
		do_action( 'rest_api_init' );

		// Both routes sit behind `openstation_rest_require_enabled()`
		// on top of the capability check.
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		update_user_meta( self::$editor_id, 'desktop_mode_mode', '1' );
		wp_set_current_user( self::$admin_id );
		delete_option( OPENSTATION_DESKTOP_THEMES_OPTION );
	}

	public function tear_down() {
		foreach ( $this->temp_files as $file ) {
			if ( file_exists( $file ) ) {
				unlink( $file );
			}
		}
		$this->temp_files = array();
		$base = openstation_desktop_themes_dir();
		if ( is_dir( $base ) ) {
			$this->rrmdir( $base );
		}
		delete_option( OPENSTATION_DESKTOP_THEMES_OPTION );
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		delete_user_meta( self::$editor_id, 'desktop_mode_mode' );
		unset( $_SERVER['CONTENT_LENGTH'] );
		remove_all_filters( 'openstation_desktop_theme_upload_capability' );
		global $wp_rest_server;
		$wp_rest_server = null;
		parent::tear_down();
	}

	/**
	 * Recursive delete for test fixtures. `scandir`, not `glob()` with
	 * `GLOB_BRACE` — that flag is absent on the musl/Alpine PHP builds
	 * wp-env uses, and dotfiles (`.htaccess`) have to be swept too.
	 */
	private function rrmdir( $dir ) {
		if ( ! is_dir( $dir ) ) {
			return;
		}
		foreach ( (array) scandir( $dir ) as $item ) {
			if ( '.' === $item || '..' === $item ) {
				continue;
			}
			$path = $dir . '/' . $item;
			is_dir( $path ) ? $this->rrmdir( $path ) : unlink( $path );
		}
		@rmdir( $dir );
	}

	private function make_zip() {
		$path = get_temp_dir() . 'dm-theme-' . wp_generate_uuid4() . '.zip';
		$zip  = new ZipArchive();
		$zip->open( $path, ZipArchive::CREATE );
		$zip->addFromString( 'theme.json', wp_json_encode( array(
			'manifestVersion' => 1,
			'id'              => 'acme/neon',
			'name'            => 'Neon',
			'version'         => '1.0.0',
		) ) );
		$zip->close();
		$this->temp_files[] = $path;
		return $path;
	}

	/**
	 * Build an upload request whose file part points at a real file.
	 */
	private function upload_request( $zip_path, $filename = 'neon.zip' ) {
		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/desktop-themes' );
		$request->set_file_params( array(
			'file' => array(
				'name'     => $filename,
				'type'     => 'application/zip',
				'tmp_name' => $zip_path,
				'error'    => 0,
				'size'     => filesize( $zip_path ),
			),
		) );
		return $request;
	}

	// ------------------------------------------------------------------
	// Permissions.
	// ------------------------------------------------------------------

	/**
	 * @covers ::openstation_desktop_themes_rest_permission
	 */
	public function test_non_admin_cannot_upload() {
		wp_set_current_user( self::$editor_id );
		$response = $this->server->dispatch( $this->upload_request( $this->make_zip() ) );
		$this->assertSame( 403, $response->get_status() );
	}

	/**
	 * @covers ::openstation_desktop_themes_rest_permission
	 */
	public function test_logged_out_is_401() {
		wp_set_current_user( 0 );
		$response = $this->server->dispatch( $this->upload_request( $this->make_zip() ) );
		$this->assertSame( 401, $response->get_status() );
	}

	/**
	 * The `read` capability alone is insufficient by design — the
	 * gate also requires OpenStation to be enabled for the user.
	 *
	 * @covers ::openstation_desktop_themes_rest_permission
	 */
	public function test_admin_without_openstation_is_403() {
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		$response = $this->server->dispatch( $this->upload_request( $this->make_zip() ) );
		$this->assertSame( 403, $response->get_status() );
	}

	/**
	 * @covers ::openstation_desktop_theme_upload_capability
	 */
	public function test_upload_capability_is_filterable() {
		add_filter( 'openstation_desktop_theme_upload_capability', static function () {
			return 'edit_posts';
		} );
		wp_set_current_user( self::$editor_id );
		$response = $this->server->dispatch( $this->upload_request( $this->make_zip() ) );
		$this->assertSame( 200, $response->get_status() );
	}

	// ------------------------------------------------------------------
	// Upload.
	// ------------------------------------------------------------------

	/**
	 * @covers ::openstation_rest_upload_desktop_theme
	 */
	public function test_upload_returns_the_payload_shaped_entry() {
		$response = $this->server->dispatch( $this->upload_request( $this->make_zip() ) );
		$this->assertSame( 200, $response->get_status() );

		$data = $response->get_data();
		foreach ( array( 'id', 'slug', 'name', 'version', 'previewUrl', 'cssUrl', 'cssText', 'tokens', 'icons', 'source' ) as $key ) {
			$this->assertArrayHasKey( $key, $data, "Missing payload key: {$key}" );
		}
		$this->assertSame( 'acme-neon', $data['slug'] );
		$this->assertSame( 'upload', $data['source'] );
		$this->assertStringContainsString( 'theme.css', $data['cssUrl'] );
		$this->assertSame( '', $data['cssText'], 'Uploaded themes link a file; they do not inline.' );
	}

	/**
	 * An oversize body reaches PHP with $_FILES empty but
	 * CONTENT_LENGTH set. Answer 413, not a "missing parameter" 400.
	 *
	 * @covers ::openstation_rest_upload_desktop_theme
	 */
	public function test_empty_files_with_content_length_is_413() {
		$_SERVER['CONTENT_LENGTH'] = '999999999';
		$request  = new WP_REST_Request( 'POST', '/desktop-mode/v1/desktop-themes' );
		$response = $this->server->dispatch( $request );
		$this->assertSame( 413, $response->get_status() );
	}

	/**
	 * @covers ::openstation_rest_upload_desktop_theme
	 */
	public function test_no_file_at_all_is_400() {
		unset( $_SERVER['CONTENT_LENGTH'] );
		$request  = new WP_REST_Request( 'POST', '/desktop-mode/v1/desktop-themes' );
		$response = $this->server->dispatch( $request );
		$this->assertSame( 400, $response->get_status() );
	}

	/**
	 * @covers ::openstation_rest_upload_desktop_theme
	 */
	public function test_non_zip_filename_is_rejected() {
		$response = $this->server->dispatch(
			$this->upload_request( $this->make_zip(), 'neon.tar.gz' )
		);
		$this->assertSame( 400, $response->get_status() );
		$this->assertSame(
			'openstation_desktop_theme_not_zip',
			$response->get_data()['code']
		);
	}

	/**
	 * OWASP double-extension: the final extension is fine but an
	 * inner segment is executable.
	 *
	 * @covers ::openstation_rest_upload_desktop_theme
	 */
	public function test_double_extension_filename_is_rejected() {
		$response = $this->server->dispatch(
			$this->upload_request( $this->make_zip(), 'neon.php.zip' )
		);
		$this->assertSame( 400, $response->get_status() );
	}

	// ------------------------------------------------------------------
	// Delete.
	// ------------------------------------------------------------------

	/**
	 * @covers ::openstation_rest_delete_desktop_theme
	 */
	public function test_delete_success() {
		$this->server->dispatch( $this->upload_request( $this->make_zip() ) );

		$request  = new WP_REST_Request( 'DELETE', '/desktop-mode/v1/desktop-themes/acme-neon' );
		$response = $this->server->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertTrue( $response->get_data()['deleted'] );
		$this->assertSame( array(), openstation_desktop_themes_index() );
	}

	/**
	 * @covers ::openstation_rest_delete_desktop_theme
	 */
	public function test_delete_unknown_slug_is_404() {
		$request  = new WP_REST_Request( 'DELETE', '/desktop-mode/v1/desktop-themes/nope' );
		$response = $this->server->dispatch( $request );
		$this->assertSame( 404, $response->get_status() );
	}

	/**
	 * @covers ::openstation_desktop_themes_rest_permission
	 */
	public function test_non_admin_cannot_delete() {
		$this->server->dispatch( $this->upload_request( $this->make_zip() ) );
		wp_set_current_user( self::$editor_id );

		$request  = new WP_REST_Request( 'DELETE', '/desktop-mode/v1/desktop-themes/acme-neon' );
		$response = $this->server->dispatch( $request );

		$this->assertSame( 403, $response->get_status() );
		$this->assertArrayHasKey( 'acme-neon', openstation_desktop_themes_index() );
	}

	/**
	 * The library rides the payload; a GET route would be a second
	 * source of truth to keep in sync for no gain.
	 *
	 * @covers ::openstation_register_desktop_themes_rest_routes
	 */
	public function test_there_is_no_get_route() {
		$request  = new WP_REST_Request( 'GET', '/desktop-mode/v1/desktop-themes' );
		$response = $this->server->dispatch( $request );
		$this->assertSame( 404, $response->get_status() );
	}
}
