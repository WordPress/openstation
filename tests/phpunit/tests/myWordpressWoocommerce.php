<?php

class Tests_OpenStation_MyWordpressWoocommerce extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	public function tear_down() {
		remove_all_filters( 'openstation_my_wordpress_post_type_group' );
		remove_all_filters( 'openstation_my_wordpress_entities' );
		remove_all_filters( 'openstation_my_wordpress_woo_order_bands' );
		remove_all_filters( 'openstation_my_wordpress_woo_section_icons' );
		parent::tear_down();
	}

	public function test_woo_post_types_get_meaningful_icons() {
		register_post_type( 'shop_coupon', array( 'public' => false, 'show_ui' => true ) );

		$entity = openstation_my_wordpress_woo_entity_icon(
			array( 'icon' => 'dashicons-admin-post' ),
			get_post_type_object( 'shop_coupon' )
		);

		$this->assertSame( 'dashicons-tickets-alt', $entity['icon'] );

		$this->assertFalse( $entity['thumbnails'] );

		unregister_post_type( 'shop_coupon' );
	}

	public function test_products_declare_their_extra_list_field() {
		register_post_type( 'product', array( 'public' => true, 'show_ui' => true ) );

		$entity = openstation_my_wordpress_woo_entity_icon(
			array( 'icon' => 'dashicons-admin-post' ),
			get_post_type_object( 'product' )
		);

		$this->assertSame( array( 'openstation_woo' ), $entity['listFields'] );
		$this->assertSame( 'dashicons-products', $entity['icon'] );

		unregister_post_type( 'product' );
	}

	public function test_non_woo_types_keep_their_icon() {
		register_post_type( 'dm_book', array( 'public' => true, 'show_ui' => true ) );

		$entity = openstation_my_wordpress_woo_entity_icon(
			array( 'icon' => 'dashicons-book' ),
			get_post_type_object( 'dm_book' )
		);

		$this->assertSame( 'dashicons-book', $entity['icon'] );
		$this->assertArrayNotHasKey( 'listFields', $entity );

		unregister_post_type( 'dm_book' );
	}

	public function test_inert_without_woocommerce() {
		$this->assertFalse( openstation_my_wordpress_woo_active() );
	}

	public function test_no_orders_section_without_woocommerce() {
		$ids = wp_list_pluck( openstation_my_wordpress_entities(), 'id' );

		$this->assertNotContains( 'wc-orders', $ids );
	}

	public function test_no_routes_without_woocommerce() {
		do_action( 'rest_api_init' );
		$routes = rest_get_server()->get_routes();

		$this->assertArrayNotHasKey( '/desktop-mode/v1/woocommerce/orders', $routes );
		$this->assertArrayNotHasKey( '/desktop-mode/v1/woocommerce/store', $routes );
	}

	public function test_no_assets_enqueued_without_woocommerce() {
		openstation_my_wordpress_woo_register_assets();
		openstation_my_wordpress_woo_enqueue();

		$this->assertFalse( wp_script_is( 'os-my-wordpress-woocommerce', 'enqueued' ) );
		$this->assertFalse( wp_style_is( 'os-my-wordpress-woocommerce', 'enqueued' ) );
	}

	public function test_bundle_is_attached_to_the_explorer_window_not_enqueued() {
		$args = openstation_my_wordpress_woo_app_window_args(
			array( 'title' => 'WP Explorer' ),
			'my-wordpress'
		);

		$this->assertArrayNotHasKey( 'scripts', $args );
	}

	public function test_config_attach_runs_before_the_payload_is_built() {
		$this->assertSame(
			5,
			has_action( 'admin_enqueue_scripts', 'openstation_my_wordpress_woo_enqueue' )
		);
	}

	public function test_group_is_relabelled_and_reiconed() {
		$group = openstation_my_wordpress_woo_group(
			array(
				'id'    => 'plugin:woocommerce',
				'label' => 'WooCommerce',
				'icon'  => 'dashicons-admin-plugins',
				'order' => 20,
			),
			'product'
		);

		$this->assertSame( 'Woo', $group['label'] );
		$this->assertStringStartsWith( 'data:image/svg+xml;base64,', $group['icon'] );
		$this->assertSame( 15, $group['order'] );
	}

	public function test_group_ignores_other_plugins() {
		$original = array(
			'id'    => 'plugin:acme',
			'label' => 'Acme',
			'icon'  => 'dashicons-admin-plugins',
			'order' => 20,
		);

		$this->assertSame(
			$original,
			openstation_my_wordpress_woo_group( $original, 'acme_thing' )
		);
		$this->assertNull( openstation_my_wordpress_woo_group( null, 'acme_thing' ) );
	}

	public function test_band_ordering_only_claims_marked_requests() {
		$marked = new WP_REST_Request( 'GET', '/wp/v2/product' );
		$marked->set_param( OPENSTATION_WOO_BANDED_PARAM, '1' );
		$this->assertTrue(
			openstation_my_wordpress_woo_is_banded_request( $marked )
		);

		$plain = new WP_REST_Request( 'GET', '/wp/v2/product' );
		$this->assertFalse(
			openstation_my_wordpress_woo_is_banded_request( $plain ),
			'an unmarked request must keep its own ordering'
		);

		$this->assertFalse(
			openstation_my_wordpress_woo_is_banded_request( null )
		);
	}

	public function test_unmarked_product_queries_are_untouched() {
		$args    = array( 'orderby' => 'price', 'order' => 'ASC' );
		$request = new WP_REST_Request( 'GET', '/wp/v2/product' );

		$this->assertSame(
			$args,
			openstation_my_wordpress_woo_order_products( $args, $request )
		);
	}

	public function test_icon_is_tintable() {
		$uri = openstation_my_wordpress_woo_icon();
		$svg = base64_decode( substr( $uri, strlen( 'data:image/svg+xml;base64,' ) ) );

		$this->assertStringContainsString( 'currentColor', $svg );
		$this->assertStringNotContainsString( '#a2aab2', $svg );
		$this->assertStringContainsString( '<svg', $svg );
	}

	public function test_refunds_are_not_purchases() {
		$this->assertTrue(
			openstation_my_wordpress_woo_is_purchase(
				new OpenStation_Test_Woo_Order()
			),
			'an order is a purchase'
		);

		$this->assertFalse(
			openstation_my_wordpress_woo_is_purchase(
				new OpenStation_Test_Woo_Refund()
			),
			'a refund must never reach get_order_number()'
		);

		$this->assertFalse(
			openstation_my_wordpress_woo_is_purchase(
				new OpenStation_Test_Woo_Bare_Order()
			)
		);

		$this->assertFalse( openstation_my_wordpress_woo_is_purchase( null ) );
		$this->assertFalse(
			openstation_my_wordpress_woo_is_purchase( new stdClass() )
		);
	}
}

if ( ! class_exists( 'WC_Abstract_Order' ) ) {

	abstract class WC_Abstract_Order {}
}

if ( ! class_exists( 'WC_Order' ) ) {

	class WC_Order extends WC_Abstract_Order {

		public function get_order_number() {
			return '1234';
		}
	}
}

if ( ! class_exists( 'WC_Order_Refund' ) ) {

	class WC_Order_Refund extends WC_Abstract_Order {}
}

class OpenStation_Test_Woo_Order extends WC_Order {}

class OpenStation_Test_Woo_Refund extends WC_Order_Refund {}

class OpenStation_Test_Woo_Bare_Order extends WC_Abstract_Order {}
