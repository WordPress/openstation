<?php
/**
 * Tests for `openstation_my_wordpress_collect_preview_actions()`.
 *
 * Asserts the server-side aggregator strips entries the current
 * user can't run before shipping them to the bundle.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group desktop-mode-my-wordpress
 */
class Tests_OpenStation_MyWordpressPreviewActions extends WP_UnitTestCase {

	private $admin_id;
	private $subscriber_id;

	public function set_up() {
		parent::set_up();
		$this->admin_id      = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$this->subscriber_id = self::factory()->user->create( array( 'role' => 'subscriber' ) );
	}

	public function tear_down() {
		remove_all_filters( 'openstation_my_wordpress_preview_actions' );
		parent::tear_down();
	}

	/**
	 * @covers ::openstation_my_wordpress_collect_preview_actions
	 */
	public function test_capability_gating_drops_actions_for_subscriber() {
		add_filter(
			'openstation_my_wordpress_preview_actions',
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
		$ids = wp_list_pluck( openstation_my_wordpress_collect_preview_actions(), 'id' );
		$this->assertContains( 'a', $ids );
		$this->assertContains( 'b', $ids );

		wp_set_current_user( $this->subscriber_id );
		$ids = wp_list_pluck( openstation_my_wordpress_collect_preview_actions(), 'id' );
		$this->assertNotContains( 'a', $ids );
		$this->assertContains( 'b', $ids );
	}

	/**
	 * `sections` is the plugin's scoping contract — it must reach the
	 * bundle verbatim, post-type slugs and the `*` wildcard included
	 * (matching is client-side).
	 *
	 * @covers ::openstation_my_wordpress_collect_preview_actions
	 */
	public function test_sections_pass_through_verbatim() {
		add_filter(
			'openstation_my_wordpress_preview_actions',
			static function ( $actions ) {
				$actions[] = array(
					'id'       => 'scoped',
					'label'    => 'Scoped',
					'sections' => array( 'atf-forms', 'cpt-atf-forms', '*' ),
				);
				return $actions;
			}
		);
		wp_set_current_user( $this->admin_id );
		$actions = openstation_my_wordpress_collect_preview_actions();
		$this->assertSame(
			array( 'atf-forms', 'cpt-atf-forms', '*' ),
			$actions[0]['sections']
		);
	}

	// (The emit-time window-config refresh tests went with the legacy
	// window: the explorer app recomputes `previewActions` inside every
	// dispatch payload, so there is no snapshot to go stale.)

	/**
	 * @covers ::openstation_my_wordpress_collect_preview_actions
	 */
	public function test_invalid_entries_are_dropped() {
		add_filter(
			'openstation_my_wordpress_preview_actions',
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
		$ids = wp_list_pluck( openstation_my_wordpress_collect_preview_actions(), 'id' );
		$this->assertSame( array( 'ok' ), $ids );
	}
}
