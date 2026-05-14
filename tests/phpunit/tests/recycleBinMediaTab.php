<?php
/**
 * Test that the Recycle Bin's Media filter tab only renders when
 * `MEDIA_TRASH` is enabled.
 *
 * Without MEDIA_TRASH, WP routes every attachment delete straight to
 * permanent-delete, so the Trash bin will never have anything in the
 * Media bucket — surfacing an empty tab there just confuses users.
 *
 * Note on environment: the test suite's WP install defines
 * `MEDIA_TRASH = false` inside `wp_initial_constants()` very early in
 * the boot, before plugins (or this test file) load. PHP constants
 * are immutable, so we can't flip it at runtime. Test asserts only
 * the "false / undefined → tab hidden" branch — flipping MEDIA_TRASH
 * to true requires a wp-config.php change and is covered by manual
 * QA.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-recycle-bin
 */
class Tests_DesktopMode_RecycleBinMediaTab extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	/**
	 * @covers ::desktop_mode_recycle_bin_render_template
	 */
	public function test_media_segment_hidden_when_media_trash_is_off() {
		// Guard: this test only makes sense in the default MEDIA_TRASH=false
		// environment. If a future tests-env starts defining it true, the
		// branch we care about is no longer reachable here and we can skip
		// rather than emit a misleading pass.
		if ( defined( 'MEDIA_TRASH' ) && MEDIA_TRASH ) {
			$this->markTestSkipped(
				'Environment has MEDIA_TRASH enabled; this branch is exercised by manual QA.'
			);
		}

		ob_start();
		desktop_mode_recycle_bin_render_template();
		$html = (string) ob_get_clean();

		$this->assertStringNotContainsString(
			'value="attachment"',
			$html,
			'The Media segment must not render when MEDIA_TRASH is off.'
		);
		// Sibling segments stay so a regression on the conditional
		// doesn't silently chop the rest of the toolbar.
		$this->assertStringContainsString( 'value="post"', $html );
		$this->assertStringContainsString( 'value="page"', $html );
		$this->assertStringContainsString( 'value="comment"', $html );
		$this->assertStringContainsString( 'value="desktop"', $html );
	}
}
