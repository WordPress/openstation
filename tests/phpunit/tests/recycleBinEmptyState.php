<?php
/**
 * Test that `<os-table empty>` survives the Recycle Bin template's
 * own `wp_kses` pass.
 *
 * The template is escaped on output against
 * `openstation_native_window_allowed_html()`, and kses drops any
 * attribute the allowlist doesn't name — silently, so a stripped one
 * reads as working markup that quietly does nothing. Here that would
 * cost the translated "nothing matched" line and fall back to the
 * component's hardcoded "No data".
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group desktop-mode-recycle-bin
 */
class Tests_OpenStation_RecycleBinEmptyState extends WP_UnitTestCase {

	/**
	 * @covers ::openstation_recycle_bin_render_template
	 * @covers ::openstation_native_window_allowed_html
	 */
	public function test_table_keeps_its_empty_text_through_kses() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		ob_start();
		openstation_recycle_bin_render_template();
		$html = (string) ob_get_clean();

		$this->assertStringContainsString(
			'empty="No items match the current filter or search."',
			$html
		);
	}
}
