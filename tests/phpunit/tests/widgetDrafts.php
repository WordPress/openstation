<?php
/**
 * Tests for the Drafts widget (`includes/widgets/widget-drafts.php`) —
 * asset registration and the `edit_posts` capability gate that keeps the
 * widget out of the picker for users whose REST query would only ever
 * return a permission error.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 */
class Tests_DesktopMode_WidgetDrafts extends WP_UnitTestCase {

	/**
	 * User who can edit posts.
	 *
	 * @var int
	 */
	protected static $editor_id;

	/**
	 * User who cannot.
	 *
	 * @var int
	 */
	protected static $subscriber_id;

	public static function wpSetUpBeforeClass( $factory ) {
		self::$editor_id     = $factory->user->create( array( 'role' => 'editor' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
	}

	/**
	 * @covers ::desktop_mode_register_drafts_widget
	 */
	public function test_registers_for_a_user_who_can_edit_posts() {
		wp_set_current_user( self::$editor_id );

		$this->assertTrue( desktop_mode_register_drafts_widget() );

		$entry = desktop_mode_desktop_widget_registry( 'desktop-mode/drafts' );
		$this->assertIsArray( $entry );
		$this->assertSame( 'desktop-mode-drafts-widget', $entry['script'] );
		$this->assertTrue( $entry['movable'] );
		$this->assertTrue( $entry['resizable'] );
	}

	/**
	 * A subscriber's `/wp/v2/posts?status=draft&context=edit` request is
	 * rejected by core, so the widget must not be offered at all.
	 *
	 * @covers ::desktop_mode_register_drafts_widget
	 */
	public function test_is_denied_for_a_user_who_cannot_edit_posts() {
		wp_set_current_user( self::$subscriber_id );

		$result = desktop_mode_register_drafts_widget();

		$this->assertWPError( $result );
		$this->assertSame( 'desktop_mode_capability_denied', $result->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_register_drafts_widget_assets
	 */
	public function test_registers_its_script_and_style() {
		desktop_mode_register_drafts_widget_assets();

		$this->assertTrue( wp_script_is( 'desktop-mode-drafts-widget', 'registered' ) );
		$this->assertTrue( wp_style_is( 'desktop-mode-drafts-widget', 'registered' ) );

		$script = wp_scripts()->registered['desktop-mode-drafts-widget'];
		$this->assertContains( 'wp-api-fetch', $script->deps );
		$this->assertTrue( (bool) $script->extra['group'], 'script loads in the footer' );
	}
}
