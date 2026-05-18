<?php
/**
 * Tests for `desktop_mode_my_wordpress_collect_preview_actions()`.
 *
 * Asserts the server-side aggregator strips entries the current
 * user can't run before shipping them to the bundle.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-my-wordpress
 */
class Tests_DesktopMode_MyWordpressPreviewActions extends WP_UnitTestCase {

	private $admin_id;
	private $subscriber_id;

	public function set_up() {
		parent::set_up();
		$this->admin_id      = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$this->subscriber_id = self::factory()->user->create( array( 'role' => 'subscriber' ) );
	}

	public function tear_down() {
		remove_all_filters( 'desktop_mode_my_wordpress_preview_actions' );
		parent::tear_down();
	}

	/**
	 * @covers ::desktop_mode_my_wordpress_collect_preview_actions
	 */
	public function test_capability_gating_drops_actions_for_subscriber() {
		add_filter(
			'desktop_mode_my_wordpress_preview_actions',
			static function ( $actions ) {
				$actions[] = array(
					'id'         => 'a',
					'label'      => 'A',
					'capability' => 'upload_files',
				);
				$actions[] = array(
					'id'         => 'b',
					'label'      => 'B',
					'capability' => 'read',
				);
				return $actions;
			}
		);

		wp_set_current_user( $this->admin_id );
		$ids = wp_list_pluck( desktop_mode_my_wordpress_collect_preview_actions(), 'id' );
		$this->assertContains( 'a', $ids );
		$this->assertContains( 'b', $ids );

		wp_set_current_user( $this->subscriber_id );
		$ids = wp_list_pluck( desktop_mode_my_wordpress_collect_preview_actions(), 'id' );
		$this->assertNotContains( 'a', $ids );
		$this->assertContains( 'b', $ids );
	}

	/**
	 * @covers ::desktop_mode_my_wordpress_collect_preview_actions
	 */
	public function test_invalid_entries_are_dropped() {
		add_filter(
			'desktop_mode_my_wordpress_preview_actions',
			static function () {
				return array(
					array( 'id' => '', 'label' => 'Empty id' ),
					array( 'id' => 'no-label' ),
					'not even an array',
					array( 'id' => 'ok', 'label' => 'Good' ),
				);
			}
		);
		wp_set_current_user( $this->admin_id );
		$ids = wp_list_pluck( desktop_mode_my_wordpress_collect_preview_actions(), 'id' );
		$this->assertSame( array( 'ok' ), $ids );
	}
}
