<?php

class Tests_OpenStation_Workspaces extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function tear_down() {
		remove_all_filters( 'openstation_workspace_presets' );
		delete_user_meta( self::$admin_id, OPENSTATION_SESSION_META_KEY );
		parent::tear_down();
	}

	private function activate_template_plugins() {
		update_option(
			'active_plugins',
			array( 'woocommerce/woocommerce.php', 'sensei-lms/sensei-lms.php' )
		);
	}

	public function test_ships_three_templates_in_order() {
		$this->activate_template_plugins();
		$ids = wp_list_pluck( openstation_workspace_presets(), 'id' );
		$this->assertSame( array( 'commerce', 'learning', 'publishing' ), $ids );
	}

	public function test_shipped_layouts_are_valid() {
		$this->activate_template_plugins();
		foreach ( openstation_workspace_presets() as $preset ) {
			$this->assertContains( $preset['layout'], OPENSTATION_WORKSPACE_LAYOUTS );
			$this->assertNotSame( '', $preset['label'] );
			$this->assertNotSame( '', $preset['icon'] );
		}
	}

	public function test_filter_can_drop_a_shipped_template() {
		$this->activate_template_plugins();
		add_filter(
			'openstation_workspace_presets',
			static function ( $presets ) {
				return array_values(
					array_filter(
						$presets,
						static function ( $preset ) {
							return 'commerce' !== $preset['id'];
						}
					)
				);
			}
		);
		$ids = wp_list_pluck( openstation_workspace_presets(), 'id' );
		$this->assertSame( array( 'learning', 'publishing' ), $ids );
	}

	public function test_template_is_withheld_until_its_plugin_is_active() {
		update_option( 'active_plugins', array() );
		$this->assertSame(
			array( 'publishing' ),
			wp_list_pluck( openstation_workspace_presets(), 'id' )
		);

		update_option( 'active_plugins', array( 'woocommerce/woocommerce.php' ) );
		$this->assertSame(
			array( 'commerce', 'publishing' ),
			wp_list_pluck( openstation_workspace_presets(), 'id' )
		);
	}

	public function test_requires_is_honoured_for_filtered_templates() {
		update_option( 'active_plugins', array() );
		add_filter(
			'openstation_workspace_presets',
			static function ( $presets ) {
				$presets = array_map(
					static function ( $preset ) {
						if ( 'commerce' === $preset['id'] ) {
							unset( $preset['requires'] );
						}
						return $preset;
					},
					$presets
				);
				$presets[] = array(
					'id'       => 'support',
					'label'    => 'Support',
					'layout'   => 'columns',
					'requires' => array( 'my-helpdesk/my-helpdesk.php' ),
				);
				return $presets;
			}
		);
		$ids = wp_list_pluck( openstation_workspace_presets(), 'id' );
		$this->assertSame( array( 'commerce', 'publishing' ), $ids );
	}

	public function test_filter_can_add_a_complete_template() {
		add_filter(
			'openstation_workspace_presets',
			static function ( $presets ) {
				$presets[] = array(
					'id'      => 'support',
					'label'   => 'Support',
					'icon'    => 'dashicons-sos',
					'layout'  => 'columns',
					'apps'    => array( 'edit-comments.php', 'users.php' ),
					'windows' => array( array( 'match' => 'users.php' ) ),
					'order'   => 40,
				);
				return $presets;
			}
		);
		$presets = openstation_workspace_presets();
		$added   = end( $presets );
		$this->assertSame( 'support', $added['id'] );
		$this->assertSame( array( 'edit-comments.php', 'users.php' ), $added['apps'] );
		$this->assertSame( 'users.php', $added['windows'][0]['match'] );
		$this->assertSame( 40, $added['order'] );
	}

	public function test_malformed_templates_are_dropped_individually() {
		$this->activate_template_plugins();
		add_filter(
			'openstation_workspace_presets',
			static function ( $presets ) {
				$presets[] = array( 'label' => 'No id here' );
				$presets[] = 'not an array';
				$presets[] = array(
					'id'     => 'odd',
					'layout' => 'diagonal',
				);
				return $presets;
			}
		);
		$presets = openstation_workspace_presets();
		$ids     = wp_list_pluck( $presets, 'id' );
		$this->assertSame( array( 'commerce', 'learning', 'publishing', 'odd' ), $ids );

		$odd = end( $presets );
		$this->assertSame( 'free', $odd['layout'] );

		$this->assertSame( 'odd', $odd['label'] );
	}

	public function test_launch_entries_keep_where_the_window_goes() {
		$profile = openstation_sanitize_workspace_profile(
			array(
				'windows' => array(
					array(
						'match' => 'edit-php',
						'place' => array(
							'x'      => 0.1,
							'y'      => 0.1,
							'width'  => 0.5,
							'height' => 0.5,
						),
					),
					array(
						'match'    => 'upload-php',
						'gridSpan' => array(
							'anchor' => array(
								'col' => 3,
								'row' => 0,
							),
							'cursor' => array(
								'col' => 5,
								'row' => 2,
							),
							'cols'   => 6,
							'rows'   => 6,
						),
					),

					array(
						'match' => 'clamped',
						'place' => array(
							'x'      => -1,
							'y'      => 2,
							'width'  => 9,
							'height' => 0.5,
						),
					),

					array(
						'match' => 'sliver',
						'place' => array(
							'x'      => 0,
							'y'      => 0,
							'width'  => 0.01,
							'height' => 0.5,
						),
					),
					array(
						'match' => 'junk',
						'place' => 'here',
					),
				),
			)
		);
		$w = $profile['windows'];
		$this->assertSame(
			array(
				'x'      => 0.1,
				'y'      => 0.1,
				'width'  => 0.5,
				'height' => 0.5,
			),
			$w[0]['place']
		);
		$this->assertSame( 6, $w[1]['gridSpan']['cols'] );
		$this->assertSame( array( 'col' => 5, 'row' => 2 ), $w[1]['gridSpan']['cursor'] );
		$this->assertSame( 0.0, $w[2]['place']['x'] );
		$this->assertSame( 1.0, $w[2]['place']['y'] );
		$this->assertSame( 1.0, $w[2]['place']['width'] );
		$this->assertArrayNotHasKey( 'place', $w[3] );
		$this->assertArrayNotHasKey( 'place', $w[4] );
	}

	public function test_absent_profile_is_null() {
		$this->assertNull( openstation_sanitize_workspace_profile( null ) );
		$this->assertNull( openstation_sanitize_workspace_profile( 'nope' ) );
		$this->assertNull( openstation_sanitize_workspace_profile( 42 ) );
	}

	public function test_profile_is_bounded() {
		$profile = openstation_sanitize_workspace_profile(
			array(
				'preset'      => 'Commerce!',
				'icon'        => 'dashicons-cart',
				'color'       => '#7f54b3',
				'apps'        => array(
					'mode' => 'only',
					'ids'  => array( 'woocommerce', 'bad id!', '', 'wpdcEditor' ),
				),
				'windows'     => array(
					array( 'match' => 'wc-orders' ),
					array( 'nope' => 'no match key' ),
					'not an array',
				),
				'layout'      => 'columns',
				'provisioned' => 1,
			)
		);

		$this->assertSame( 'commerce', $profile['preset'] );
		$this->assertSame( 'columns', $profile['layout'] );
		$this->assertSame( '#7f54b3', $profile['color'] );
		$this->assertSame( 'only', $profile['apps']['mode'] );

		$this->assertSame(
			array( 'woocommerce', 'badid', 'wpdcEditor' ),
			$profile['apps']['ids']
		);
		$this->assertCount( 1, $profile['windows'] );
		$this->assertSame( 'wc-orders', $profile['windows'][0]['match'] );
		$this->assertTrue( $profile['provisioned'] );
	}

	public function test_profile_widgets_are_bounded() {
		$profile = openstation_sanitize_workspace_profile(
			array(
				'widgets' => array(
					'mode' => 'only',
					'ids'  => array( 'clock', 'desktop-mode/post-stats', 'bad id!', '', 42 ),
				),
			)
		);
		$this->assertSame( 'only', $profile['widgets']['mode'] );
		$this->assertSame(
			array( 'clock', 'desktop-mode/post-stats', 'badid' ),
			$profile['widgets']['ids']
		);
	}

	public function test_absent_widgets_mean_all() {
		$profile = openstation_sanitize_workspace_profile( array( 'layout' => 'tile' ) );
		$this->assertSame( 'all', $profile['widgets']['mode'] );
		$this->assertSame( array(), $profile['widgets']['ids'] );
	}

	public function test_runaway_widget_list_is_capped() {
		$ids = array();
		for ( $i = 0; $i < 200; $i++ ) {
			$ids[] = 'widget-' . $i;
		}
		$profile = openstation_sanitize_workspace_profile(
			array(
				'widgets' => array(
					'mode' => 'only',
					'ids'  => $ids,
				),
			)
		);
		$this->assertCount( OPENSTATION_WORKSPACE_MAX_WIDGETS, $profile['widgets']['ids'] );
	}

	public function test_template_may_name_widgets() {
		add_filter(
			'openstation_workspace_presets',
			static function ( $presets ) {
				$presets[] = array(
					'id'      => 'support',
					'label'   => 'Support',
					'widgets' => array( 'clock', 'desktop-mode/recent-comments' ),
				);
				return $presets;
			}
		);
		$presets = openstation_workspace_presets();
		$added   = end( $presets );
		$this->assertSame(
			array( 'clock', 'desktop-mode/recent-comments' ),
			$added['widgets']
		);
	}

	public function test_appearance_is_restricted_to_the_allowlist() {
		$profile = openstation_sanitize_workspace_profile(
			array(
				'appearance' => array(
					'wallpaper'    => 'mono',
					'accent'       => 'rose',
					'dockBehavior' => 'dynamic',

					'navPlacement'         => array( 'edit-php' => 'hidden' ),
					'heartbeatRate'        => 5,
					'developerModeEnabled' => true,
				),
			)
		);
		$this->assertSame(
			array( 'wallpaper', 'accent', 'dockBehavior' ),
			array_keys( $profile['appearance'] )
		);
	}

	public function test_appearance_arrays_are_depth_bounded() {
		$profile = openstation_sanitize_workspace_profile(
			array(
				'appearance' => array(
					'customGradient'    => array(
						'from'  => '#000000',
						'to'    => '#ffffff',
						'angle' => 45,
					),
					'wallpaperSettings' => array(
						'living-tree' => array( 'density' => 3 ),
					),
					'customImage'       => array(
						'id'  => 12,
						'url' => 'https://example.test/a.png',
					),
				),
			)
		);
		$this->assertSame(
			array(
				'from'  => '#000000',
				'to'    => '#ffffff',
				'angle' => 45,
			),
			$profile['appearance']['customGradient']
		);
		$this->assertSame( 3, $profile['appearance']['wallpaperSettings']['living-tree']['density'] );
		$this->assertSame( 12, $profile['appearance']['customImage']['id'] );

		$deep = openstation_sanitize_workspace_profile(
			array(
				'appearance' => array(
					'wallpaperSettings' => array(
						'living-tree' => array(
							'density' => 3,
							'nested'  => array( 'too' => 'far' ),
						),
					),
				),
			)
		);
		$this->assertSame(
			array( 'living-tree' => array( 'density' => 3 ) ),
			$deep['appearance']['wallpaperSettings']
		);
	}

	public function test_absent_appearance_is_empty() {
		$profile = openstation_sanitize_workspace_profile( array( 'layout' => 'tile' ) );
		$this->assertSame( array(), $profile['appearance'] );
	}

	public function test_template_may_carry_an_appearance() {
		add_filter(
			'openstation_workspace_presets',
			static function ( $presets ) {
				$presets[] = array(
					'id'         => 'support',
					'label'      => 'Support',
					'appearance' => array(
						'wallpaper' => 'forest',
						'nope'      => 'dropped',
					),
				);
				return $presets;
			}
		);
		$presets = openstation_workspace_presets();
		$added   = end( $presets );
		$this->assertSame( array( 'wallpaper' => 'forest' ), $added['appearance'] );
	}

	public function test_unknown_layout_and_colour_fall_back() {
		$profile = openstation_sanitize_workspace_profile(
			array(
				'layout' => 'diagonal',
				'color'  => 'javascript:alert(1)',
			)
		);
		$this->assertSame( 'free', $profile['layout'] );
		$this->assertSame( '', $profile['color'] );

		$this->assertSame( 'all', $profile['apps']['mode'] );
		$this->assertSame( array(), $profile['apps']['ids'] );

		$this->assertFalse( $profile['provisioned'] );
	}

	public function test_runaway_lists_are_capped() {
		$ids     = array();
		$windows = array();
		for ( $i = 0; $i < 400; $i++ ) {
			$ids[]     = 'app-' . $i;
			$windows[] = array( 'match' => 'win-' . $i );
		}
		$profile = openstation_sanitize_workspace_profile(
			array(
				'apps'    => array(
					'mode' => 'only',
					'ids'  => $ids,
				),
				'windows' => $windows,
			)
		);
		$this->assertCount( OPENSTATION_WORKSPACE_MAX_APPS, $profile['apps']['ids'] );
		$this->assertCount( OPENSTATION_WORKSPACE_MAX_WINDOWS, $profile['windows'] );
	}

	public function test_profile_round_trips_through_the_session() {
		openstation_save_session(
			self::$admin_id,
			array(
				'desktops'      => array(
					array(
						'id'      => 'desktop-1',
						'label'   => 'Commerce',
						'profile' => array(
							'preset'      => 'commerce',
							'icon'        => 'dashicons-cart',
							'color'       => '#7f54b3',
							'apps'        => array(
								'mode' => 'only',
								'ids'  => array( 'woocommerce' ),
							),
							'widgets'     => array(
								'mode' => 'only',
								'ids'  => array( 'clock', 'desktop-mode/site-views' ),
							),
							'appearance'  => array(
								'wallpaper' => 'dark',
								'accent'    => 'indigo',
							),
							'windows'     => array( array( 'match' => 'wc-orders' ) ),
							'layout'      => 'columns',
							'provisioned' => true,
						),
					),
					array(
						'id'    => 'desktop-2',
						'label' => 'Desktop 2',
					),
				),
				'activeDesktop' => 'desktop-1',
				'windows'       => array(),
				'updated'       => openstation_session_now_ms(),
			)
		);

		$session = openstation_get_session( self::$admin_id );
		$this->assertSame( 'commerce', $session['desktops'][0]['profile']['preset'] );
		$this->assertSame( 'columns', $session['desktops'][0]['profile']['layout'] );
		$this->assertSame(
			array( 'woocommerce' ),
			$session['desktops'][0]['profile']['apps']['ids']
		);
		$this->assertSame(
			array( 'clock', 'desktop-mode/site-views' ),
			$session['desktops'][0]['profile']['widgets']['ids']
		);
		$this->assertSame(
			array(
				'wallpaper' => 'dark',
				'accent'    => 'indigo',
			),
			$session['desktops'][0]['profile']['appearance']
		);

		$this->assertArrayNotHasKey( 'profile', $session['desktops'][1] );
	}
}
