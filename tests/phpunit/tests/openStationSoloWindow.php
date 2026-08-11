<?php
/**
 * Tests for the solo window rendering mode.
 *
 * `?openstation_solo=<id>` boots the whole shell and paints exactly one
 * window. It is a **rendering mode, not an access grant** — the tests
 * that matter most here are the ones proving a query string cannot
 * reshape the admin for someone who never opted into OpenStation.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-solo-window
 */
class Tests_OpenStation_SoloWindow extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		// `wp_styles()` is a global registry, and inline styles added by
		// one test would otherwise be read by the next.
		$GLOBALS['wp_styles'] = null;
	}

	public function tear_down() {
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		unset( $_GET[ OPENSTATION_SOLO_FLAG ] );
		remove_all_filters( 'openstation_solo_window_id' );
		$GLOBALS['wp_styles'] = null;
		parent::tear_down();
	}

	/**
	 * @covers ::openstation_solo_window_id
	 * @covers ::openstation_is_solo_request
	 */
	public function test_no_flag_means_no_solo_request() {
		wp_set_current_user( self::$admin_id );

		$this->assertSame( '', openstation_solo_window_id() );
		$this->assertFalse( openstation_is_solo_request() );
	}

	/**
	 * @covers ::openstation_solo_window_id
	 * @covers ::openstation_is_solo_request
	 */
	public function test_flag_is_read_for_an_enabled_user() {
		wp_set_current_user( self::$admin_id );
		$_GET[ OPENSTATION_SOLO_FLAG ] = 'os-files';

		$this->assertSame( 'os-files', openstation_solo_window_id() );
		$this->assertTrue( openstation_is_solo_request() );
	}

	/**
	 * @covers ::openstation_solo_window_id
	 */
	public function test_value_is_sanitized_to_a_safe_key() {
		wp_set_current_user( self::$admin_id );

		// The exact residue of double-sanitization is not the contract —
		// "whatever comes out is a safe key" is.
		$_GET[ OPENSTATION_SOLO_FLAG ] = '<script>alert(1)</script>';
		$this->assertMatchesRegularExpression( '/^[a-z0-9_\-]*$/', openstation_solo_window_id() );

		$_GET[ OPENSTATION_SOLO_FLAG ] = 'Edit PHP';
		$this->assertMatchesRegularExpression( '/^[a-z0-9_\-]*$/', openstation_solo_window_id() );
	}

	/**
	 * @covers ::openstation_solo_window_id
	 */
	public function test_an_array_shaped_value_is_rejected_outright() {
		wp_set_current_user( self::$admin_id );
		$_GET[ OPENSTATION_SOLO_FLAG ] = array( 'os-files' );

		$this->assertSame( '', openstation_solo_window_id() );
	}

	/**
	 * Solo mode is a rendering mode, not an access grant: a user who has
	 * not turned OpenStation on must not be able to reshape their admin
	 * with a query string.
	 *
	 * @covers ::openstation_solo_window_id
	 */
	public function test_flag_is_ignored_when_openstation_is_off() {
		$plain_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $plain_id );
		$_GET[ OPENSTATION_SOLO_FLAG ] = 'os-files';

		$this->assertSame( '', openstation_solo_window_id() );
		$this->assertFalse( openstation_is_solo_request() );
	}

	/**
	 * @covers ::openstation_solo_window_id
	 */
	public function test_flag_is_ignored_for_a_logged_out_visitor() {
		wp_set_current_user( 0 );
		$_GET[ OPENSTATION_SOLO_FLAG ] = 'os-files';

		$this->assertSame( '', openstation_solo_window_id() );
	}

	/**
	 * @covers ::openstation_solo_window_id
	 */
	public function test_filter_can_turn_solo_mode_off() {
		wp_set_current_user( self::$admin_id );
		$_GET[ OPENSTATION_SOLO_FLAG ] = 'os-files';

		add_filter( 'openstation_solo_window_id', '__return_empty_string' );

		$this->assertSame( '', openstation_solo_window_id() );
		$this->assertFalse( openstation_is_solo_request() );
	}

	/**
	 * @covers ::openstation_solo_window_id
	 */
	public function test_filter_receives_the_sanitized_id_and_the_request_value() {
		wp_set_current_user( self::$admin_id );
		$_GET[ OPENSTATION_SOLO_FLAG ] = 'os-files';

		$seen = array();
		add_filter(
			'openstation_solo_window_id',
			static function ( $id, $raw ) use ( &$seen ) {
				$seen = array( $id, $raw );
				return $id;
			},
			10,
			2
		);

		openstation_solo_window_id();

		$this->assertSame( array( 'os-files', 'os-files' ), $seen );
	}

	/**
	 * The shell reads `soloWindow` off its config blob to decide whether
	 * to suppress session restore, so the key has to be there.
	 *
	 * @covers ::openstation_solo_window_id
	 */
	public function test_shell_config_carries_the_solo_window_id() {
		wp_set_current_user( self::$admin_id );
		$_GET[ OPENSTATION_SOLO_FLAG ] = 'os-files';

		$config = apply_filters(
			'openstation_shell_config',
			array( 'soloWindow' => openstation_solo_window_id() )
		);

		$this->assertSame( 'os-files', $config['soloWindow'] );
	}

	/**
	 * Solo mode promises one window, and the promise has to hold from
	 * the first frame.
	 *
	 * A second window — a game launched from a freed Games hub — would
	 * otherwise land on top of the first, because solo's CSS stretches
	 * every window to fill the viewport. Hiding it from JavaScript is a
	 * frame too late: the user sees it flash before it is dealt with.
	 * So the rule is inline CSS with the window's id baked in.
	 *
	 * @covers ::openstation_enqueue_assets
	 */
	public function test_solo_mode_emits_a_rule_hiding_every_other_window() {
		wp_set_current_user( self::$admin_id );
		$_GET[ OPENSTATION_SOLO_FLAG ] = 'os-game-inkfall';

		openstation_register_assets();
		set_current_screen( 'dashboard' );
		openstation_enqueue_assets();

		$inline = wp_styles()->get_data( 'os-solo', 'after' );
		$css    = is_array( $inline ) ? implode( '', $inline ) : (string) $inline;

		$this->assertStringContainsString(
			'.os-window:not(#wp-window-os-game-inkfall)',
			$css,
			'Solo mode must hide every window but its own, by id.'
		);
		// `visibility`, not `display`: a hidden-but-laid-out window still
		// has a size, which canvas windows need to initialise without
		// dividing by zero on the way to being closed.
		$this->assertStringContainsString( 'visibility:hidden', $css );
		$this->assertStringNotContainsString( 'display:none', $css );
	}

	/**
	 * @covers ::openstation_enqueue_assets
	 */
	public function test_a_normal_shell_gets_no_such_rule() {
		wp_set_current_user( self::$admin_id );

		openstation_register_assets();
		set_current_screen( 'dashboard' );
		openstation_enqueue_assets();

		$inline = wp_styles()->get_data( 'os-solo', 'after' );
		$css    = is_array( $inline ) ? implode( '', $inline ) : (string) $inline;

		$this->assertStringNotContainsString( '.os-window:not(', $css );
	}

	/**
	 * @covers ::openstation_admin_body_classes
	 */
	public function test_body_gets_the_solo_class_in_solo_mode() {
		wp_set_current_user( self::$admin_id );
		$_GET[ OPENSTATION_SOLO_FLAG ] = 'os-files';

		$classes = openstation_admin_body_classes( '' );

		// Still `os-active`: the palette, every component and every
		// registry are scoped to that class. Solo mode is the same
		// shell with the desk hidden, not a different one.
		$this->assertStringContainsString( 'os-active', $classes );
		$this->assertStringContainsString( 'os-solo', $classes );
	}

	/**
	 * @covers ::openstation_admin_body_classes
	 */
	public function test_body_has_no_solo_class_on_a_normal_request() {
		wp_set_current_user( self::$admin_id );

		$classes = openstation_admin_body_classes( '' );

		$this->assertStringContainsString( 'os-active', $classes );
		$this->assertStringNotContainsString( 'os-solo', $classes );
	}
}
