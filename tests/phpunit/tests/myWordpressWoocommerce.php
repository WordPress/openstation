<?php
/**
 * Tests for the WooCommerce integration's inert-without-WooCommerce
 * behaviour and its pure helpers.
 *
 * The data-facing pieces (`wc_get_orders()` order rows, product /
 * coupon summaries) need WooCommerce loaded, which the test suite
 * doesn't have — those are covered by the manual QA checklist against
 * a real store. What is tested here is everything that must hold on a
 * site *without* WooCommerce, because that's every site by default:
 * no routes, no sections, no enqueued assets, no fatals.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group desktop-mode-my-wordpress
 */
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
		remove_all_filters( 'open_station_my_wordpress_post_type_group' );
		remove_all_filters( 'open_station_my_wordpress_entities' );
		remove_all_filters( 'open_station_my_wordpress_woo_order_bands' );
		remove_all_filters( 'open_station_my_wordpress_woo_section_icons' );
		parent::tear_down();
	}

	/**
	 * A pin icon on a coupon reads as a mistake — these types are
	 * WooCommerce submenu entries, so they carry no `menu_icon` and
	 * fall back to the generic post icon.
	 *
	 * @covers ::open_station_my_wordpress_woo_entity_icon
	 */
	public function test_woo_post_types_get_meaningful_icons() {
		register_post_type( 'shop_coupon', array( 'public' => false, 'show_ui' => true ) );

		$entity = open_station_my_wordpress_woo_entity_icon(
			array( 'icon' => 'dashicons-admin-post' ),
			get_post_type_object( 'shop_coupon' )
		);

		$this->assertSame( 'dashicons-tickets-alt', $entity['icon'] );
		// Coupons have no featured image — a thumbnail column would be
		// a grid of identical fallbacks.
		$this->assertFalse( $entity['thumbnails'] );

		unregister_post_type( 'shop_coupon' );
	}

	/**
	 * Products band by stock and category, both of which ride a custom
	 * REST field that `_fields` would otherwise strip.
	 *
	 * @covers ::open_station_my_wordpress_woo_entity_icon
	 */
	public function test_products_declare_their_extra_list_field() {
		register_post_type( 'product', array( 'public' => true, 'show_ui' => true ) );

		$entity = open_station_my_wordpress_woo_entity_icon(
			array( 'icon' => 'dashicons-admin-post' ),
			get_post_type_object( 'product' )
		);

		$this->assertSame( array( 'open_station_woo' ), $entity['listFields'] );
		$this->assertSame( 'dashicons-products', $entity['icon'] );

		unregister_post_type( 'product' );
	}

	/**
	 * Other post types pass through untouched.
	 *
	 * @covers ::open_station_my_wordpress_woo_entity_icon
	 */
	public function test_non_woo_types_keep_their_icon() {
		register_post_type( 'dm_book', array( 'public' => true, 'show_ui' => true ) );

		$entity = open_station_my_wordpress_woo_entity_icon(
			array( 'icon' => 'dashicons-book' ),
			get_post_type_object( 'dm_book' )
		);

		$this->assertSame( 'dashicons-book', $entity['icon'] );
		$this->assertArrayNotHasKey( 'listFields', $entity );

		unregister_post_type( 'dm_book' );
	}

	/**
	 * @covers ::open_station_my_wordpress_woo_active
	 */
	public function test_inert_without_woocommerce() {
		$this->assertFalse( open_station_my_wordpress_woo_active() );
	}

	/**
	 * No WooCommerce means no Orders section — and, critically, no
	 * fatal from calling `wc_get_orders()` on a site without it.
	 *
	 * @covers ::open_station_my_wordpress_woo_entities
	 */
	public function test_no_orders_section_without_woocommerce() {
		$ids = wp_list_pluck( open_station_my_wordpress_entities(), 'id' );

		$this->assertNotContains( 'wc-orders', $ids );
	}

	/**
	 * @covers ::open_station_my_wordpress_woo_register_routes
	 */
	public function test_no_routes_without_woocommerce() {
		do_action( 'rest_api_init' );
		$routes = rest_get_server()->get_routes();

		$this->assertArrayNotHasKey( '/desktop-mode/v1/woocommerce/orders', $routes );
		$this->assertArrayNotHasKey( '/desktop-mode/v1/woocommerce/store', $routes );
	}

	/**
	 * @covers ::open_station_my_wordpress_woo_enqueue
	 */
	public function test_no_assets_enqueued_without_woocommerce() {
		open_station_my_wordpress_woo_register_assets();
		open_station_my_wordpress_woo_enqueue();

		$this->assertFalse( wp_script_is( 'os-my-wordpress-woocommerce', 'enqueued' ) );
		$this->assertFalse( wp_style_is( 'os-my-wordpress-woocommerce', 'enqueued' ) );
	}

	/**
	 * "WooCommerce" wraps onto two lines in an 88px tile, so the
	 * folder is relabelled — and gets WooCommerce's own mark instead
	 * of the generic plugin dashicon.
	 *
	 * @covers ::open_station_my_wordpress_woo_group
	 */
	public function test_group_is_relabelled_and_reiconed() {
		$group = open_station_my_wordpress_woo_group(
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

	/**
	 * Other plugins' folders are left completely alone.
	 *
	 * @covers ::open_station_my_wordpress_woo_group
	 */
	public function test_group_ignores_other_plugins() {
		$original = array(
			'id'    => 'plugin:acme',
			'label' => 'Acme',
			'icon'  => 'dashicons-admin-plugins',
			'order' => 20,
		);

		$this->assertSame(
			$original,
			open_station_my_wordpress_woo_group( $original, 'acme_thing' )
		);
		$this->assertNull( open_station_my_wordpress_woo_group( null, 'acme_thing' ) );
	}

	/**
	 * `rest_product_query` fires for every caller of that collection —
	 * WooCommerce Blocks' Product Collection renders through it. The
	 * band ordering must only apply to the site window's own requests,
	 * or a storefront's chosen sort is silently replaced by ours.
	 *
	 * @covers ::open_station_my_wordpress_woo_is_banded_request
	 */
	public function test_band_ordering_only_claims_marked_requests() {
		$marked = new WP_REST_Request( 'GET', '/wp/v2/product' );
		$marked->set_param( OPEN_STATION_WOO_BANDED_PARAM, '1' );
		$this->assertTrue(
			open_station_my_wordpress_woo_is_banded_request( $marked )
		);

		$plain = new WP_REST_Request( 'GET', '/wp/v2/product' );
		$this->assertFalse(
			open_station_my_wordpress_woo_is_banded_request( $plain ),
			'an unmarked request must keep its own ordering'
		);

		$this->assertFalse(
			open_station_my_wordpress_woo_is_banded_request( null )
		);
	}

	/**
	 * An unmarked query is returned untouched — no `post__in`, no
	 * `orderby` rewrite.
	 *
	 * @covers ::open_station_my_wordpress_woo_order_products
	 */
	public function test_unmarked_product_queries_are_untouched() {
		$args    = array( 'orderby' => 'price', 'order' => 'ASC' );
		$request = new WP_REST_Request( 'GET', '/wp/v2/product' );

		$this->assertSame(
			$args,
			open_station_my_wordpress_woo_order_products( $args, $request )
		);
	}

	/**
	 * The mark ships as a `currentColor` SVG so `renderIcon()` masks
	 * it and the folder icon follows the desktop theme, rather than
	 * being stuck on WooCommerce's hard-coded grey.
	 *
	 * @covers ::open_station_my_wordpress_woo_icon
	 */
	public function test_icon_is_tintable() {
		$uri = open_station_my_wordpress_woo_icon();
		$svg = base64_decode( substr( $uri, strlen( 'data:image/svg+xml;base64,' ) ) );

		$this->assertStringContainsString( 'currentColor', $svg );
		$this->assertStringNotContainsString( '#a2aab2', $svg );
		$this->assertStringContainsString( '<svg', $svg );
	}
}
