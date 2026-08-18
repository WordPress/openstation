<?php
/**
 * Tests for Station Home's role-aware snapshot and native registration.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group station-home
 */
class Tests_OpenStation_StationHome extends WP_UnitTestCase {

	private $admin_id;
	private $subscriber_id;

	public function set_up() {
		parent::set_up();
		$this->admin_id      = self::factory()->user->create(
			array(
				'role'         => 'administrator',
				'display_name' => 'Station Operator',
				'first_name'   => 'Nick',
			)
		);
		$this->subscriber_id = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		wp_set_current_user( $this->admin_id );
	}

	/**
	 * @covers ::openstation_station_home_build_snapshot
	 * @covers ::openstation_station_home_recent_work
	 * @covers ::openstation_station_home_quick_actions
	 */
	public function test_snapshot_is_personal_and_contains_classic_escape() {
		$draft_id = self::factory()->post->create(
			array(
				'post_author' => $this->admin_id,
				'post_status' => 'draft',
				'post_title'  => 'Flight notes',
			)
		);
		self::factory()->post->create(
			array(
				'post_author' => $this->subscriber_id,
				'post_status' => 'publish',
				'post_title'  => 'Someone else\'s work',
			)
		);

		$snapshot = openstation_station_home_build_snapshot();
		$this->assertSame( 'Nick', $snapshot['userName'] );
		$this->assertSame( $draft_id, $snapshot['work'][0]['id'] );
		$this->assertSame( 'Flight notes', $snapshot['work'][0]['title'] );

		$actions = array_column( $snapshot['quickActions'], null, 'id' );
		$this->assertArrayHasKey( 'new-post', $actions );
		$this->assertArrayHasKey( 'upload-media', $actions );
		$this->assertArrayHasKey( 'classic-dashboard', $actions );
		$this->assertStringContainsString(
			OPENSTATION_CLASSIC_FLAG . '=1',
			$actions['classic-dashboard']['url']
		);
	}

	/**
	 * @covers ::openstation_station_home_quick_actions
	 */
	public function test_quick_actions_follow_current_user_capabilities() {
		wp_set_current_user( $this->subscriber_id );
		$actions = array_column( openstation_station_home_quick_actions(), null, 'id' );

		$this->assertArrayNotHasKey( 'new-post', $actions );
		$this->assertArrayNotHasKey( 'upload-media', $actions );
		$this->assertArrayHasKey( 'view-site', $actions );
		$this->assertArrayHasKey( 'classic-dashboard', $actions );
	}

	/**
	 * @covers ::openstation_station_home_register_window
	 */
	public function test_window_registers_as_edge_to_edge_native_dashboard() {
		openstation_station_home_register_window();
		$entry = openstation_native_window_registry( OPENSTATION_STATION_HOME_WINDOW_ID );

		$this->assertIsArray( $entry );
		$this->assertSame( 'os-station-home', $entry['script'] );
		$this->assertSame( 'os-station-home', $entry['style'] );
		$this->assertSame( 0, $entry['main_tab_padding'] );
		$this->assertStringContainsString( '/desktop-mode/v1/station-home', $entry['config']['endpoint'] );
	}

	/**
	 * @covers ::openstation_station_home_render_template
	 */
	public function test_template_exposes_accessible_render_mounts() {
		ob_start();
		openstation_station_home_render_template();
		$html = (string) ob_get_clean();

		$this->assertStringContainsString( 'data-os-station-home-root', $html );
		$this->assertStringContainsString( 'aria-label="Station Home"', $html );
		$this->assertStringContainsString( 'aria-label="Quick actions"', $html );
		$this->assertStringContainsString( 'aria-labelledby="os-station-home-work-heading"', $html );
		$this->assertStringContainsString( 'Continue working', $html );
		$this->assertStringContainsString( 'Needs attention', $html );
	}
}
