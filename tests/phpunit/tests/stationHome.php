<?php
/**
 * Tests for the Station Home plugin-card registry — the public PHP
 * API (`openstation_register_station_home_card()` and friends) that
 * outlived the legacy window and now feeds the Station Home app.
 * The window itself is covered by `stationHomeApp.php`.
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
		$this->admin_id      = self::factory()->user->create( array( 'role' => 'administrator' ) );
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

		$built = $this->build();
		$this->assertSame( 0, $calls, 'An opted-out card must not run its callback.' );
		$this->assertSame( array(), $built['cards'] );
		$this->assertCount( 1, $built['preferences'] );
		$this->assertFalse( $built['preferences'][0]['enabled'] );

		update_user_meta( $this->admin_id, OPENSTATION_STATION_HOME_CARD_PREFERENCES_META, array( 'my-plugin-orders' => true ) );
		$built = $this->build();
		$this->assertSame( 1, $calls );
		$this->assertSame( 'my-plugin-orders', $built['cards'][0]['id'] );
		$this->assertSame( '4', $built['cards'][0]['value'] );
		$this->assertSame( 'warning', $built['cards'][0]['tone'] );
		$this->assertTrue( $built['preferences'][0]['enabled'] );

		update_user_meta( $this->admin_id, OPENSTATION_STATION_HOME_CARD_PREFERENCES_META, array( 'my-plugin-orders' => false ) );
		$built = $this->build();
		$this->assertSame( 1, $calls, 'An explicit opt-out must stop future callback work.' );
		$this->assertSame( array(), $built['cards'] );
	}

	/**
	 * @covers ::openstation_station_home_set_card_preference
	 * @covers ::openstation_station_home_get_card_preferences
	 */
	public function test_setting_a_preference_stores_it_and_fires_the_action() {
		openstation_register_station_home_card(
			'my-plugin-health',
			array(
				'label'    => 'Site health',
				'callback' => static function () {
					return array( 'value' => 'Good' );
				},
			)
		);
		$fired = array();
		add_action(
			'openstation_station_home_card_preference_updated',
			static function ( $user_id, $id, $enabled ) use ( &$fired ) {
				$fired[] = array( $user_id, $id, $enabled );
			},
			10,
			3
		);

		$this->assertTrue( openstation_station_home_set_card_preference( $this->admin_id, 'my-plugin-health', true ) );
		$this->assertTrue( openstation_station_home_get_card_preferences( $this->admin_id )['my-plugin-health'] );
		$this->assertSame( array( array( $this->admin_id, 'my-plugin-health', true ) ), $fired );
		$this->assertSame( 'Good', $this->build()['cards'][0]['value'] );

		$this->assertTrue( openstation_station_home_set_card_preference( $this->admin_id, 'my-plugin-health', false ) );
		$this->assertFalse( openstation_station_home_get_card_preferences( $this->admin_id )['my-plugin-health'] );
	}

	/**
	 * @covers ::openstation_station_home_set_card_preference
	 */
	public function test_setting_a_preference_rejects_unknown_cards() {
		$this->assertFalse( openstation_station_home_set_card_preference( $this->admin_id, 'missing-card', true ) );
		$this->assertSame( array(), openstation_station_home_get_card_preferences( $this->admin_id ) );
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
	public function test_card_callback_failure_does_not_break_the_build() {
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

		$built = $this->build();
		$this->assertSame( array(), $built['cards'] );
		$this->assertTrue( $built['preferences'][0]['enabled'] );
	}

	/**
	 * Build the cards for the current user, the way the app does.
	 *
	 * @return array{cards: array[], preferences: array[]}
	 */
	private function build() {
		return openstation_station_home_build_cards(
			openstation_station_home_get_registered_cards(),
			openstation_station_home_get_card_preferences( get_current_user_id() )
		);
	}
}
