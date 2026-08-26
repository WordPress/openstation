<?php
/**
 * Tests for the chromeless bridge's top-frame escape hatch.
 *
 * A chromeless page normally only exists inside an OpenStation window
 * iframe, so a *top-level* one is treated as an accident — a stale
 * bookmark, a bad redirect — and rescued by stripping the flag and
 * reloading as classic admin.
 *
 * `window.openStationChromelessHost` is the opt-out for an embedder
 * that hosts such a page deliberately. The native desktop host sets it
 * on every window a user sets free; without it, a freed window strips
 * its own flag three seconds after opening, bounces through the portal,
 * and paints an entire second OpenStation desktop inside a window that
 * was meant to hold one screen. That bug shipped, and this is what
 * catches it coming back.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-chromeless
 */
class Tests_OpenStation_ChromelessTopFrame extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		wp_set_current_user( self::$admin_id );
		$_GET['openstation_chromeless'] = '1';
	}

	public function tear_down() {
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		unset( $_GET['openstation_chromeless'] );
		parent::tear_down();
	}

	/**
	 * Capture the inline bridge script the footer emits.
	 *
	 * @return string Script markup.
	 */
	private function bridge_markup() {
		ob_start();
		openstation_chromeless_bridge_script();
		$printed = (string) ob_get_clean();

		// The bridge code ships as a built bundle now; PHP enqueues it
		// and attaches per-request data instead of printing the script
		// inline. Behaviour assertions read the bundle's source.
		if ( ! openstation_is_chromeless_request() ) {
			return $printed;
		}

		return $printed . (string) file_get_contents(
			OPENSTATION_DIR . 'src/chromeless-bridge.js'
		);
	}

	/**
	 * @covers ::openstation_chromeless_bridge_script
	 */
	public function test_the_bridge_is_emitted_on_a_chromeless_request() {
		// The bridge used to identify itself by a `//# sourceURL=`
		// comment in the inline script. It is a real bundle now, so the
		// contract is that the handle gets enqueued.
		openstation_chromeless_bridge_script();

		$this->assertTrue( wp_script_is( 'os-chromeless-bridge', 'enqueued' ) );
	}

	/**
	 * The rescue itself has to stay: a user who lands on a chromeless
	 * URL by accident has no admin bar and therefore no way out.
	 *
	 * @covers ::openstation_chromeless_bridge_script
	 */
	public function test_a_stranded_top_level_page_still_strips_the_flag() {
		$markup = $this->bridge_markup();

		$this->assertStringContainsString( 'window.parent === window', $markup );
		$this->assertStringContainsString( "searchParams.delete( 'openstation_chromeless' )", $markup );
		$this->assertStringContainsString( 'window.location.replace', $markup );
	}

	/**
	 * …but only when nothing claims the page.
	 *
	 * @covers ::openstation_chromeless_bridge_script
	 */
	public function test_a_hosted_top_level_page_is_left_alone() {
		$markup = $this->bridge_markup();

		$this->assertStringContainsString(
			'! window.openStationChromelessHost',
			$markup,
			'The escape hatch must check for a host before rescuing a top-level chromeless page.'
		);

		// Order matters as much as presence: the host check has to gate
		// the navigation, not sit somewhere harmlessly after it.
		$host_check = strpos( $markup, '! window.openStationChromelessHost' );
		$replace    = strpos( $markup, 'window.location.replace' );
		$this->assertNotFalse( $host_check );
		$this->assertNotFalse( $replace );
		$this->assertLessThan(
			$replace,
			$host_check,
			'The host check must come before the navigation it guards.'
		);
	}
}
