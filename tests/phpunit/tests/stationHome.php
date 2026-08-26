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
		openstation_station_home_card_registry( '__flush__' );
		delete_user_meta( $this->admin_id, OPENSTATION_STATION_HOME_CARD_PREFERENCES_META );
	}

	public function tear_down() {
		openstation_station_home_card_registry( '__flush__' );
		parent::tear_down();
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
		// The sheet rides the `styles` companion list (loaded on
		// first open), not `style` (injected at boot).
		$this->assertSame( '', $entry['style'] );
		$this->assertSame( array( 'os-station-home' ), $entry['styles'] );
		$this->assertSame( 0, $entry['main_tab_padding'] );
		$this->assertStringContainsString( '/desktop-mode/v1/station-home', $entry['config']['endpoint'] );
		$this->assertStringContainsString( '/desktop-mode/v1/station-home/cards', $entry['config']['cardsEndpoint'] );
	}

	/**
	 * @covers ::openstation_register_station_home_card
	 * @covers ::openstation_station_home_build_cards
	 * @covers ::openstation_station_home_card_is_enabled
	 */
	public function test_contributed_cards_are_user_controlled_and_lazy() {
		$calls  = 0;
		$result = openstation_register_station_home_card(
			'my-plugin-orders',
			array(
				'label'           => 'Orders',
				'description'     => 'Orders waiting to be fulfilled.',
				'provider'        => 'My Plugin',
				'icon'            => 'dashicons-cart',
				'default_enabled' => false,
				'callback'        => static function () use ( &$calls ) {
					++$calls;
					return array(
						'value'        => '4',
						'detail'       => 'Ready to fulfil',
						'url'          => admin_url( 'admin.php?page=my-plugin-orders' ),
						'action_label' => 'Open orders',
						'tone'         => 'warning',
					);
				},
			)
		);

		$this->assertTrue( $result );
		$snapshot = openstation_station_home_build_snapshot();
		$this->assertSame( 0, $calls, 'An opted-out card must not run its callback.' );
		$this->assertSame( array(), $snapshot['cards'] );
		$this->assertCount( 1, $snapshot['cardPreferences'] );
		$this->assertFalse( $snapshot['cardPreferences'][0]['enabled'] );

		update_user_meta(
			$this->admin_id,
			OPENSTATION_STATION_HOME_CARD_PREFERENCES_META,
			array( 'my-plugin-orders' => true )
		);
		$snapshot = openstation_station_home_build_snapshot();
		$this->assertSame( 1, $calls );
		$this->assertSame( 'my-plugin-orders', $snapshot['cards'][0]['id'] );
		$this->assertSame( '4', $snapshot['cards'][0]['value'] );
		$this->assertSame( 'warning', $snapshot['cards'][0]['tone'] );
		$this->assertTrue( $snapshot['cardPreferences'][0]['enabled'] );

		update_user_meta(
			$this->admin_id,
			OPENSTATION_STATION_HOME_CARD_PREFERENCES_META,
			array( 'my-plugin-orders' => false )
		);
		$snapshot = openstation_station_home_build_snapshot();
		$this->assertSame( 1, $calls, 'An explicit opt-out must stop future callback work.' );
		$this->assertSame( array(), $snapshot['cards'] );
	}

	/**
	 * @covers ::openstation_station_home_rest_update_card_preference
	 * @covers ::openstation_station_home_get_card_preferences
	 */
	public function test_card_preference_route_saves_an_explicit_choice() {
		openstation_register_station_home_card(
			'my-plugin-health',
			array(
				'label'    => 'Site health',
				'callback' => static function () {
					return array( 'value' => 'Good' );
				},
			)
		);

		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/station-home/cards' );
		$request->set_param( 'id', 'my-plugin-health' );
		$request->set_param( 'enabled', true );
		$response = openstation_station_home_rest_update_card_preference( $request );

		$this->assertInstanceOf( WP_REST_Response::class, $response );
		$this->assertTrue( openstation_station_home_get_card_preferences( $this->admin_id )['my-plugin-health'] );
		$this->assertSame( 'Good', $response->get_data()['cards'][0]['value'] );
	}

	/**
	 * @covers ::openstation_station_home_rest_update_card_preference
	 */
	public function test_card_preference_route_rejects_unknown_cards() {
		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/station-home/cards' );
		$request->set_param( 'id', 'missing-card' );
		$request->set_param( 'enabled', true );
		$error = openstation_station_home_rest_update_card_preference( $request );

		$this->assertWPError( $error );
		$this->assertSame( 'openstation_station_home_card_not_found', $error->get_error_code() );
	}

	/**
	 * @covers ::openstation_register_station_home_card
	 */
	public function test_card_registration_honors_capabilities() {
		wp_set_current_user( $this->subscriber_id );
		$result = openstation_register_station_home_card(
			'admin-only-card',
			array(
				'label'        => 'Admin only',
				'capabilities' => array( 'manage_options' ),
				'callback'     => '__return_empty_array',
			)
		);

		$this->assertWPError( $result );
		$this->assertSame( 'openstation_capability_denied', $result->get_error_code() );
		$this->assertNull( openstation_station_home_card_registry( 'admin-only-card' ) );
	}

	/**
	 * @covers ::openstation_station_home_build_cards
	 */
	public function test_card_callback_failure_does_not_break_the_snapshot() {
		openstation_register_station_home_card(
			'broken-card',
			array(
				'label'           => 'Broken card',
				'default_enabled' => true,
				'callback'        => static function () {
					throw new RuntimeException( 'Card failed.' );
				},
			)
		);

		$snapshot = openstation_station_home_build_snapshot();
		$this->assertSame( array(), $snapshot['cards'] );
		$this->assertTrue( $snapshot['cardPreferences'][0]['enabled'] );
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
		$this->assertStringContainsString( 'assets/images/openstation-mark.svg', $html );
		$this->assertStringContainsString( 'data-os-station-home-cards', $html );
		$this->assertStringContainsString( 'data-os-station-home-card-modal', $html );
	}
}
