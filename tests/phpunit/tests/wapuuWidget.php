<?php
/**
 * Tests for the built-in Wapuu widget registration.
 *
 * Guards the bootstrap wiring (`includes/widgets/wapuu.php` is required
 * and registers on `init`) and the payload shape the shell's widget
 * server-sync consumes. The animation itself is PixiJS and lives on the
 * JS side; this only covers the PHP registration contract.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-wapuu-widget
 */
class Tests_DesktopMode_WapuuWidget extends WP_UnitTestCase {

	/**
	 * @covers ::desktop_mode_register_wapuu_widget
	 */
	public function test_wapuu_widget_is_registered() {
		$this->assertTrue(
			function_exists( 'desktop_mode_register_wapuu_widget' ),
			'wapuu.php should be required at bootstrap.'
		);

		// Idempotent — re-run so the assertion does not depend on the
		// `init` firing order during the test bootstrap.
		desktop_mode_register_wapuu_widget();

		$entry = desktop_mode_desktop_widget_registry( 'desktop-mode/wapuu' );
		$this->assertIsArray( $entry );
		$this->assertSame( 'desktop-mode/wapuu', $entry['id'] );
		$this->assertSame( 'desktop-mode-wapuu-widget', $entry['script'] );
		// Movable so the WHOLE widget can be dragged around the desktop;
		// not resizable (the whole card is the drag surface).
		$this->assertTrue( $entry['movable'] );
		$this->assertFalse( $entry['resizable'] );
	}

	/**
	 * @covers ::desktop_mode_build_desktop_widgets_payload
	 */
	public function test_wapuu_widget_appears_in_payload() {
		desktop_mode_register_wapuu_widget();

		$payload = desktop_mode_build_desktop_widgets_payload();
		$entry   = null;
		foreach ( $payload as $row ) {
			if ( 'desktop-mode/wapuu' === $row['id'] ) {
				$entry = $row;
				break;
			}
		}

		$this->assertNotNull( $entry, 'Wapuu should be in the widgets payload.' );
		$this->assertSame( 300, $entry['defaultWidth'] );
		$this->assertSame( 340, $entry['defaultHeight'] );
		$this->assertTrue( $entry['movable'] );
		$this->assertFalse( $entry['resizable'] );
		$this->assertSame( 'desktop-mode-wapuu-widget', $entry['scriptHandle'] );
	}
}
