<?php

use function OpenStation\Apps\StationHome\greeting;

class Tests_OpenStation_StationHomeApp extends WP_UnitTestCase {

	const APP_ID = 'desktop-mode-dashboard';

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

	private function dispatch( $action, array $state = array(), array $args = array() ) {
		return openstation_apps_runtime()->dispatch(
			self::APP_ID,
			array(
				'action' => $action,
				'state'  => $state,
				'args'   => $args,
			),
			openstation_apps_os()
		);
	}

	private function register_orders_card() {
		openstation_register_station_home_card(
			'my-plugin-orders',
			array(
				'label'       => 'Orders',
				'description' => 'Orders waiting to be fulfilled.',
				'provider'    => 'My Plugin',
				'icon'        => 'dashicons-cart',
				'callback'    => static function () {
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
	}

	public function test_manifest_mirrors_the_legacy_windows_registration() {
		$app = openstation_apps_registry()->get( self::APP_ID );
		$this->assertNotNull( $app );
		$manifest = $app->manifest();
		$this->assertSame( 'Station Home', $manifest['title'] );
		$this->assertSame( 'dashicons-dashboard', $manifest['icon'] );
		$this->assertSame( 1240, $manifest['width'] );
		$this->assertSame( 760, $manifest['height'] );
		$this->assertSame( 640, $manifest['min_width'] );
		$this->assertSame( 480, $manifest['min_height'] );

		$this->assertSame( 'none', $manifest['placement'] );
		$this->assertNull( $manifest['desktop_icon'] );
		$this->assertSame( array( 'read' ), $manifest['capabilities'] );

		$this->assertSame( '', $manifest['client_source'] );
		$this->assertFalse( $manifest['has_data'] );
		$this->assertStringEndsWith( 'apps/station-home/station-home.css', $manifest['style'] );

		$this->assertSame( array( 'customizing' => false ), $manifest['state'] );
		$this->assertSame( array( 'customize', 'customize_close', 'toggle_card', 'launch', 'show' ), $manifest['actions'] );

		$this->assertSame( array( 'show' ), $manifest['lifecycle'] );
		$this->assertSame( array( '*' ), $manifest['watch'] );
	}

	public function test_every_logged_in_reader_is_allowed_and_nobody_else() {
		$app = openstation_apps_registry()->get( self::APP_ID );
		$this->assertTrue( $app->allows( openstation_apps_os() ) );

		wp_set_current_user( $this->subscriber_id );
		$this->assertTrue( $app->allows( openstation_apps_os() ) );

		wp_set_current_user( 0 );
		$this->assertFalse( $app->allows( openstation_apps_os() ) );
	}

	public function test_mount_paints_a_personal_flight_deck() {
		self::factory()->post->create(
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

		$response = $this->dispatch( 'mount' );
		$this->assertTrue( $response['ok'] );
		$html = $response['html'];

		$this->assertStringContainsString( 'aria-label="Station Home"', $html );
		$this->assertStringContainsString( 'assets/images/openstation-mark.svg', $html );
		$this->assertStringContainsString( 'aria-label="Quick actions"', $html );
		$this->assertMatchesRegularExpression( '/Good (morning|afternoon|evening), Nick/', $html );
		$this->assertStringContainsString( 'aria-labelledby="os-station-home-work-heading"', $html );
		$this->assertStringContainsString( 'Continue working', $html );
		$this->assertStringContainsString( 'Site pulse', $html );
		$this->assertStringContainsString( 'Needs attention', $html );

		$this->assertStringContainsString( 'Flight notes', $html );
		$this->assertStringContainsString( 'os-station-home__work-row', $html );
		$this->assertStringNotContainsString( 'Someone else', $html );

		$this->assertStringContainsString( 'os-action="refresh"', $html );

		$this->assertMatchesRegularExpression( '/<a class="os-station-home__action" os-key="new-post" href="[^"]*post-new\.php"/', $html );
		$this->assertMatchesRegularExpression( '/<a class="os-station-home__action" os-key="view-site" href="[^"]+" title="View site" target="_blank" rel="noopener">/', $html );
		$this->assertStringContainsString( 'os-action="launch" os-arg-id="classic-dashboard"', $html );
		$this->assertStringContainsString( 'os-action="launch" os-arg-id="wp-explorer"', $html );

		$this->assertStringNotContainsString( 'os-station-home__cards-section', $html );
		$this->assertStringNotContainsString( '<os-modal class="os-station-home__card-modal" title="Customize Station Home" size="md" os-action="customize_close" open>', $html );
		$this->assertSame( array( 'customizing' => false ), $response['state'] );
	}

	public function test_quick_actions_follow_current_user_capabilities() {
		wp_set_current_user( $this->subscriber_id );
		$html = $this->dispatch( 'mount' )['html'];

		$this->assertStringNotContainsString( 'os-key="new-post"', $html );
		$this->assertStringNotContainsString( 'os-key="upload-media"', $html );
		$this->assertStringNotContainsString( 'os-key="wp-explorer"', $html );
		$this->assertStringContainsString( 'os-key="view-site"', $html );
		$this->assertStringContainsString( 'os-key="classic-dashboard"', $html );

		$this->assertStringContainsString( 'All clear', $html );
	}

	public function test_entities_are_decoded_once_and_markup_is_never_parsed() {
		self::factory()->post->create(
			array(
				'post_author' => $this->admin_id,
				'post_status' => 'draft',
				'post_title'  => 'Don\'t panic <em>now</em>',
			)
		);
		$html = $this->dispatch( 'mount' )['html'];

		$this->assertStringContainsString( 'Don’t panic &lt;em&gt;now&lt;/em&gt;', $html );
		$this->assertStringNotContainsString( '&#8217;', $html );
		$this->assertStringNotContainsString( '<em>now</em>', $html );
	}

	public function test_customize_opens_the_picker_and_a_switch_stores_the_choice() {
		$this->register_orders_card();

		$mounted = $this->dispatch( 'mount' );
		$this->assertStringContainsString( 'Make this space yours', $mounted['html'] );
		$this->assertStringContainsString( 'os-action="customize"', $mounted['html'] );
		$this->assertMatchesRegularExpression( '/<os-switch os-key="my-plugin-orders" value="my-plugin-orders" label="Orders" description="My Plugin — Orders waiting to be fulfilled\." block size="sm" tone="accent" os-action="toggle_card" os-arg-id="my-plugin-orders">/', $mounted['html'] );

		$opened = $this->dispatch( 'customize' );
		$this->assertTrue( $opened['state']['customizing'] );
		$this->assertStringContainsString( 'os-action="customize_close" open>', $opened['html'] );

		$toggled = $this->dispatch(
			'toggle_card',
			array( 'customizing' => true ),
			array(
				'id'      => 'my-plugin-orders',
				'checked' => true,
			)
		);
		$this->assertTrue( $toggled['ok'] );
		$this->assertSame( array(), $toggled['effects'] );
		$this->assertTrue( openstation_station_home_get_card_preferences( $this->admin_id )['my-plugin-orders'] );

		$this->assertStringContainsString( 'tone="accent" checked os-action="toggle_card"', $toggled['html'] );
		$this->assertMatchesRegularExpression( '/<a class="os-station-home__card" os-key="my-plugin-orders" data-tone="warning" href="[^"]*page=my-plugin-orders">/', $toggled['html'] );
		$this->assertStringContainsString( '<strong class="os-station-home__card-value">4</strong>', $toggled['html'] );
		$this->assertStringContainsString( 'Open orders', $toggled['html'] );
		$this->assertStringNotContainsString( 'Make this space yours', $toggled['html'] );

		$this->assertTrue( $toggled['state']['customizing'] );

		$closed = $this->dispatch( 'customize_close', array( 'customizing' => true ) );
		$this->assertFalse( $closed['state']['customizing'] );
		$this->assertStringNotContainsString( 'os-action="customize_close" open>', $closed['html'] );
	}

	public function test_a_switch_for_an_unknown_card_is_refused_with_a_toast() {
		$response = $this->dispatch(
			'toggle_card',
			array(),
			array(
				'id'      => 'missing-card',
				'checked' => true,
			)
		);
		$this->assertTrue( $response['ok'] );
		$this->assertSame( 'toast', $response['effects'][0]['type'] );
		$this->assertSame( array(), openstation_station_home_get_card_preferences( $this->admin_id ) );
	}

	public function test_launch_turns_the_shell_bound_quick_actions_into_effects() {
		$classic = $this->dispatch( 'launch', array(), array( 'id' => 'classic-dashboard' ) );
		$this->assertSame( 'open_url', $classic['effects'][0]['type'] );
		$this->assertStringContainsString( OPENSTATION_CLASSIC_FLAG . '=1', $classic['effects'][0]['url'] );
		$this->assertSame( 'Classic Dashboard', $classic['effects'][0]['title'] );
		$this->assertSame( 'dashicons-dashboard', $classic['effects'][0]['icon'] );

		$explorer = $this->dispatch( 'launch', array(), array( 'id' => 'wp-explorer' ) );
		$this->assertSame( array( array( 'type' => 'open', 'window' => 'my-wordpress' ) ), $explorer['effects'] );

		$this->assertSame( array(), $this->dispatch( 'launch', array(), array( 'id' => 'new-post' ) )['effects'] );
		$this->assertSame( array(), $this->dispatch( 'launch', array(), array( 'id' => 'nope' ) )['effects'] );

		wp_set_current_user( $this->subscriber_id );
		$this->assertSame( array(), $this->dispatch( 'launch', array(), array( 'id' => 'wp-explorer' ) )['effects'] );
	}

	public function test_restore_and_refresh_both_repaint() {
		$this->assertTrue( $this->dispatch( 'show' )['ok'] );
		$this->assertTrue( $this->dispatch( 'refresh' )['ok'] );
	}

	public function test_greeting_follows_the_hour() {
		foreach ( array( 0, 8, 11 ) as $hour ) {
			$this->assertSame( 'Good morning, Nick', greeting( $hour, 'Nick' ) );
		}
		foreach ( array( 12, 15, 17 ) as $hour ) {
			$this->assertSame( 'Good afternoon, Nick', greeting( $hour, 'Nick' ) );
		}
		foreach ( array( 18, 21, 23 ) as $hour ) {
			$this->assertSame( 'Good evening, Nick', greeting( $hour, 'Nick' ) );
		}
	}

	public function test_the_legacy_window_and_its_routes_are_gone() {
		$routes = rest_get_server()->get_routes( 'desktop-mode/v1' );
		$this->assertArrayNotHasKey( '/desktop-mode/v1/station-home', $routes );
		$this->assertArrayNotHasKey( '/desktop-mode/v1/station-home/cards', $routes );
		$this->assertFalse( function_exists( 'openstation_station_home_register_window' ) );
		$this->assertFalse( function_exists( 'openstation_station_home_build_snapshot' ) );
		$this->assertFalse( wp_script_is( 'os-station-home', 'registered' ) );
	}
}
