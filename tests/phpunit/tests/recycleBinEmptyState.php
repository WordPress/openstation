<?php
/**
 * Test that the Recycle Bin's two text-carrying attributes survive
 * the template's own `wp_kses` pass.
 *
 * The template is escaped on output against
 * `openstation_native_window_allowed_html()`, and kses drops any
 * attribute the allowlist doesn't name — silently, so a stripped one
 * reads as working markup that quietly does nothing. `empty` and
 * `heading` were both missing, which would have cost the translated
 * "nothing matched" line (falling back to the component's hardcoded
 * "No data") and the empty state's whole first line.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group desktop-mode-recycle-bin
 */
class Tests_OpenStation_RecycleBinEmptyState extends WP_UnitTestCase {

	/**
	 * @dataProvider data_text_attributes
	 *
	 * @covers ::openstation_recycle_bin_render_template
	 * @covers ::openstation_native_window_allowed_html
	 *
	 * @param string $needle Attribute markup that must survive kses.
	 */
	public function test_text_attributes_survive_kses( $needle ) {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		ob_start();
		openstation_recycle_bin_render_template();
		$html = (string) ob_get_clean();

		$this->assertStringContainsString( $needle, $html );
	}

	/**
	 * @return array<string,array{0:string}>
	 */
	public function data_text_attributes() {
		return array(
			'table no-match text' => array( 'empty="No items match the current filter or search."' ),
			'empty state heading' => array( 'heading="The Trash is empty."' ),
		);
	}
}
