<?php

class Tests_OpenStation_MyWordpressWoocommerceCustomers extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	public function tear_down() {
		remove_all_filters( 'openstation_my_wordpress_entities' );
		remove_all_filters( 'openstation_my_wordpress_woo_customer_bands' );
		remove_all_filters( 'openstation_my_wordpress_woo_customer_band' );
		remove_all_filters( 'openstation_my_wordpress_woo_vip_threshold' );
		remove_all_filters( 'openstation_my_wordpress_woo_customer_lapse_days' );
		remove_all_filters( 'openstation_my_wordpress_woo_summary_type' );
		remove_all_filters( 'openstation_my_wordpress_woo_summary_capability' );
		remove_all_filters( 'openstation_window_content_identity' );
		remove_all_filters( 'openstation_window_related_entities' );
		unset( $GLOBALS['pagenow'], $_GET['page'], $_GET['action'], $_GET['id'], $_GET['post'] );
		parent::tear_down();
	}

	public function test_no_customers_section_without_woocommerce() {
		$entities = openstation_my_wordpress_woo_customer_entity( array() );

		$this->assertSame( array(), $entities );
	}

	public function test_customers_section_leaves_a_non_array_alone() {
		$this->assertNull( openstation_my_wordpress_woo_customer_entity( null ) );
	}

	public function test_no_customer_routes_without_woocommerce() {
		do_action( 'rest_api_init' );
		$routes = rest_get_server()->get_routes();

		$this->assertArrayNotHasKey( '/desktop-mode/v1/woocommerce/customers', $routes );
	}

	public function test_no_customer_window_without_woocommerce() {
		openstation_my_wordpress_woo_customer_window_register();

		$this->assertArrayNotHasKey(
			'desktop-mode-woo-customer',
			(array) openstation_native_window_registry()
		);
	}

	public function test_the_customer_window_template_keeps_its_mount_point() {
		ob_start();
		openstation_my_wordpress_woo_customer_window_template();
		$html = (string) ob_get_clean();

		$this->assertStringContainsString( 'data-os-woo-customer-root', $html );
	}

	public function test_relations_are_inert_without_woocommerce() {
		$related = openstation_my_wordpress_woo_related_entities(
			array( 'sentinel' ),
			array(
				'type' => 'shop_order',
				'id'   => 7,
			),
			null
		);

		$this->assertSame( array( 'sentinel' ), $related );
	}

	public function test_identity_is_untouched_without_woocommerce() {
		$identity = array(
			'type' => 'post',
			'id'   => 3,
		);

		$this->assertSame(
			$identity,
			openstation_my_wordpress_woo_content_identity( $identity, null )
		);
	}

	public function test_order_window_title_prints_nothing_without_woocommerce() {
		ob_start();
		openstation_my_wordpress_woo_order_window_title();
		$html = (string) ob_get_clean();

		$this->assertSame( '', $html );
	}

	public function test_order_title_includes_the_customer_name() {
		$order = new class() {
			public function get_formatted_billing_full_name() {
				return 'John Smith';
			}

			public function get_order_number() {
				return '5632';
			}
		};

		$this->assertSame(
			'Order #5632 · John Smith',
			openstation_my_wordpress_woo_order_title( $order )
		);
	}

	public function test_order_title_omits_an_empty_customer_name() {
		$order = new class() {
			public function get_formatted_billing_full_name() {
				return '  ';
			}

			public function get_order_number() {
				return '5632';
			}
		};

		$this->assertSame(
			'Order #5632',
			openstation_my_wordpress_woo_order_title( $order )
		);
	}

	public function test_the_reviews_screen_roots_at_its_product() {

		register_post_type(
			'product',
			array(
				'public'  => true,
				'show_ui' => true,
			)
		);
		$product_id = self::factory()->post->create(
			array(
				'post_type'  => 'product',
				'post_title' => 'Hiking Boots',
			)
		);

		$GLOBALS['pagenow']  = 'edit.php';
		$_GET['page']        = 'product-reviews';
		$_GET['product_id']  = (string) $product_id;

		$identity = openstation_my_wordpress_woo_reviews_identity();

		$this->assertSame( 'reviews', $identity['type'] );
		$this->assertSame( $product_id, $identity['id'] );
		$this->assertSame(
			array(
				'type' => 'product',
				'id'   => $product_id,
			),
			$identity['root']
		);
		$this->assertStringContainsString( 'Hiking Boots', $identity['label'] );

		unset( $_GET['page'], $_GET['product_id'] );
		unregister_post_type( 'product' );
	}

	public function test_the_unfiltered_reviews_list_has_no_identity() {
		$GLOBALS['pagenow'] = 'edit.php';
		$_GET['page']       = 'product-reviews';

		$this->assertNull( openstation_my_wordpress_woo_reviews_identity() );

		unset( $_GET['page'] );
	}

	public function test_another_edit_screen_is_not_mistaken_for_reviews() {
		$GLOBALS['pagenow'] = 'edit.php';

		$this->assertNull( openstation_my_wordpress_woo_reviews_identity() );
	}

	public function test_no_current_order_without_woocommerce() {
		$GLOBALS['pagenow'] = 'admin.php';
		$_GET['page']       = 'wc-orders';
		$_GET['action']     = 'edit';
		$_GET['id']         = '42';

		$this->assertNull( openstation_my_wordpress_woo_current_order() );
	}

	public function test_bands_lead_with_the_two_actionable_ones() {
		$ids = wp_list_pluck( openstation_my_wordpress_woo_customer_band_defs(), 'id' );

		$this->assertSame( array( 'vip', 'lapsed', 'repeat', 'new', 'none' ), $ids );
	}

	public function test_a_customer_with_no_orders_is_unbanded() {
		$this->assertSame(
			'none',
			openstation_my_wordpress_woo_customer_band_id(
				array(
					'orders' => 0,
					'spend'  => 0.0,
					'last'   => '',
				)
			)
		);
	}

	public function test_one_recent_order_is_new() {
		$this->assertSame(
			'new',
			openstation_my_wordpress_woo_customer_band_id(
				array(
					'orders' => 1,
					'spend'  => 10.0,
					'last'   => gmdate( 'Y-m-d H:i:s' ),
				)
			)
		);
	}

	public function test_two_recent_orders_are_repeat() {
		$this->assertSame(
			'repeat',
			openstation_my_wordpress_woo_customer_band_id(
				array(
					'orders' => 2,
					'spend'  => 20.0,
					'last'   => gmdate( 'Y-m-d H:i:s' ),
				)
			)
		);
	}

	public function test_an_old_last_order_is_lapsed() {
		$this->assertSame(
			'lapsed',
			openstation_my_wordpress_woo_customer_band_id(
				array(
					'orders' => 4,
					'spend'  => 40.0,
					'last'   => gmdate( 'Y-m-d H:i:s', time() - ( 400 * DAY_IN_SECONDS ) ),
				)
			)
		);
	}

	public function test_vip_outranks_lapsed() {
		add_filter(
			'openstation_my_wordpress_woo_vip_threshold',
			static function () {
				return 100.0;
			}
		);

		$this->assertSame(
			'vip',
			openstation_my_wordpress_woo_customer_band_id(
				array(
					'orders' => 3,
					'spend'  => 500.0,
					'last'   => gmdate( 'Y-m-d H:i:s', time() - ( 400 * DAY_IN_SECONDS ) ),
				)
			)
		);
	}

	public function test_a_zero_threshold_promotes_nobody() {
		add_filter(
			'openstation_my_wordpress_woo_vip_threshold',
			static function () {
				return 0.0;
			}
		);

		$this->assertSame(
			'new',
			openstation_my_wordpress_woo_customer_band_id(
				array(
					'orders' => 1,
					'spend'  => 0.0,
					'last'   => gmdate( 'Y-m-d H:i:s' ),
				)
			)
		);
	}

	public function test_the_lapse_window_is_filterable_and_floored() {
		$this->assertSame( 180, openstation_my_wordpress_woo_customer_lapse_days() );

		add_filter(
			'openstation_my_wordpress_woo_customer_lapse_days',
			static function () {
				return 0;
			}
		);

		$this->assertSame( 1, openstation_my_wordpress_woo_customer_lapse_days() );
	}

	public function test_the_band_is_filterable() {
		add_filter(
			'openstation_my_wordpress_woo_customer_band',
			static function () {
				return 'wholesale';
			}
		);

		$this->assertSame(
			'wholesale',
			openstation_my_wordpress_woo_customer_band_id( array( 'orders' => 1 ) )
		);
	}

	public function test_days_since_reads_a_gmt_datetime() {
		$this->assertNull( openstation_my_wordpress_woo_customer_days_since( '' ) );
		$this->assertNull( openstation_my_wordpress_woo_customer_days_since( 'not a date' ) );
		$this->assertSame(
			0,
			openstation_my_wordpress_woo_customer_days_since( gmdate( 'Y-m-d H:i:s' ) )
		);
		$this->assertSame(
			10,
			openstation_my_wordpress_woo_customer_days_since(
				gmdate( 'Y-m-d H:i:s', time() - ( 10 * DAY_IN_SECONDS ) )
			)
		);
	}

	public function test_paid_statuses_carry_the_wc_prefix() {
		$statuses = openstation_my_wordpress_woo_paid_statuses();

		$this->assertContains( 'wc-completed', $statuses );
		$this->assertContains( 'wc-processing', $statuses );
		foreach ( $statuses as $status ) {
			$this->assertStringStartsWith( 'wc-', $status );
		}
	}

	public function test_every_order_lifecycle_event_flushes_the_caches( $hook ) {
		$this->assertSame(
			10,
			has_action( $hook, 'openstation_my_wordpress_woo_flush_customer_caches' ),
			"{$hook} does not flush the customer caches"
		);
	}

	public function data_order_lifecycle_hooks() {
		return array(
			array( 'woocommerce_new_order' ),
			array( 'woocommerce_update_order' ),
			array( 'woocommerce_order_status_changed' ),
			array( 'woocommerce_delete_order' ),
			array( 'woocommerce_trash_order' ),
			array( 'woocommerce_untrash_order' ),
		);
	}

	public function test_the_flush_drops_both_transients() {
		set_transient( 'desktop_mode_woo_customer_spend', array( 'x' ), HOUR_IN_SECONDS );
		set_transient( 'desktop_mode_woo_customer_plan', array( 'y' ), HOUR_IN_SECONDS );

		openstation_my_wordpress_woo_flush_customer_caches();

		$this->assertFalse( get_transient( 'desktop_mode_woo_customer_spend' ) );
		$this->assertFalse( get_transient( 'desktop_mode_woo_customer_plan' ) );
	}

	public function test_a_subscriber_may_not_see_customers() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

		$this->assertWPError( openstation_my_wordpress_woo_customers_permission() );
	}

	public function test_an_editor_may_not_see_customers() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );

		$this->assertWPError( openstation_my_wordpress_woo_customers_permission() );
	}

	public function test_an_unknown_summary_type_still_answers_400() {
		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/woocommerce/summary/nonsense/1' );
		$request->set_param( 'type', 'nonsense' );
		$request->set_param( 'id', 1 );

		$result = openstation_my_wordpress_woo_summary( $request );

		$this->assertWPError( $result );
		$this->assertSame( 'openstation_woo_bad_type', $result->get_error_code() );
	}

	public function test_a_filter_can_add_a_summary_type() {
		add_filter(
			'openstation_my_wordpress_woo_summary_type',
			static function ( $data, $type, $id ) {
				return 'booking' === $type
					? array(
						'type' => 'booking',
						'id'   => $id,
					)
					: $data;
			},
			10,
			3
		);

		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/woocommerce/summary/booking/9' );
		$request->set_param( 'type', 'booking' );
		$request->set_param( 'id', 9 );

		$response = openstation_my_wordpress_woo_summary( $request );

		$this->assertNotWPError( $response );
		$this->assertSame( 'booking', $response->get_data()['type'] );
		$this->assertSame( 9, $response->get_data()['id'] );
	}

	public function test_a_filter_can_gate_its_own_summary_type() {
		add_filter(
			'openstation_my_wordpress_woo_summary_capability',
			static function ( $allowed, $type ) {
				return 'booking' === $type
					? new WP_Error( 'nope', 'No.', array( 'status' => 403 ) )
					: $allowed;
			},
			10,
			2
		);

		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/woocommerce/summary/booking/9' );
		$request->set_param( 'type', 'booking' );
		$request->set_param( 'id', 9 );

		$this->assertWPError( openstation_my_wordpress_woo_summary_permission( $request ) );
	}

	public function test_orders_url_points_at_the_legacy_list_without_hpos() {
		$url = openstation_my_wordpress_woo_customer_orders_url( 12 );

		$this->assertStringContainsString( 'post_type=shop_order', $url );
		$this->assertStringContainsString( '_customer_user=12', $url );
	}

	public function test_hpos_is_off_without_woocommerce() {
		$this->assertFalse( openstation_my_wordpress_woo_hpos_enabled() );
	}

	public function test_orders_with_product_rejects_a_bad_id() {
		$this->assertSame(
			array(),
			openstation_my_wordpress_woo_orders_with_product( 0 )
		);
		$this->assertSame(
			array(),
			openstation_my_wordpress_woo_orders_with_product( -5 )
		);
	}

	public function test_orders_with_product_is_empty_without_the_tables() {
		$this->assertSame(
			array(),
			openstation_my_wordpress_woo_orders_with_product( 42 )
		);
	}

	public function test_orders_with_coupon_rejects_an_empty_code() {
		$this->assertSame(
			array(),
			openstation_my_wordpress_woo_orders_with_coupon( '' )
		);
		$this->assertSame(
			array(),
			openstation_my_wordpress_woo_orders_with_coupon( '   ' )
		);
	}

	public function test_coupons_for_product_rejects_a_bad_id() {
		$this->assertSame(
			array(),
			openstation_my_wordpress_woo_coupons_for_product( 0 )
		);
	}

	public function test_coupons_for_product_does_not_match_a_substring_id() {
		$coupon_id = self::factory()->post->create(
			array(
				'post_type'   => 'shop_coupon',
				'post_status' => 'publish',
			)
		);
		update_post_meta( $coupon_id, 'product_ids', '112,121,1212' );

		$this->assertNotContains(
			$coupon_id,
			openstation_my_wordpress_woo_coupons_for_product( 12 )
		);
		$this->assertContains(
			$coupon_id,
			openstation_my_wordpress_woo_coupons_for_product( 121 )
		);
	}

	public function test_a_related_item_omits_a_zero_count() {
		$item = openstation_my_wordpress_woo_related_item(
			'x',
			'g',
			'Group',
			'Label',
			'dashicons-cart',
			'https://example.org/wp-admin/',
			0
		);

		$this->assertArrayNotHasKey( 'count', $item );

		$counted = openstation_my_wordpress_woo_related_item(
			'x',
			'g',
			'Group',
			'Label',
			'dashicons-cart',
			'https://example.org/wp-admin/',
			3
		);

		$this->assertSame( 3, $counted['count'] );
	}

	public function test_a_related_item_carries_every_required_field() {
		$item = openstation_my_wordpress_woo_related_item(
			'wc-product-5',
			'wc-products',
			'Products',
			'Blue hat',
			'dashicons-products',
			'https://example.org/wp-admin/post.php?post=5&action=edit'
		);

		foreach ( array( 'id', 'group', 'label', 'url' ) as $required ) {
			$this->assertArrayHasKey( $required, $item );
			$this->assertNotSame( '', trim( $item[ $required ] ) );
		}
	}
}
