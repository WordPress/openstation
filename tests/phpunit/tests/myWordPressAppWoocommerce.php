<?php
/**
 * Tests for the My WordPress app's WooCommerce part
 * (`apps/my-wordpress/parts/woocommerce.php`) and the app-window-args
 * seam it rides in on.
 *
 * Like `myWordpressWoocommerce.php` next door: the data-facing pieces
 * (`wc_get_orders()` pages, the band plans, per-row facts) need
 * WooCommerce loaded, which the suite doesn't have — those are the
 * manual QA checklist against a real store. What is tested here is
 * everything that must hold on a site *without* WooCommerce, because
 * that's every site by default: no Woo sections, no reordered
 * queries, no fatals — plus the pure pieces (the flat-section
 * guards, the section decoration, the `openstation_app_window_args`
 * filter) that don't need a store to prove.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group my-wordpress-app
 */

use OpenStation\App;
use function OpenStation\Apps\MyWordPress\woo_allowed;
use function OpenStation\Apps\MyWordPress\woo_count;
use function OpenStation\Apps\MyWordPress\woo_decorate_section;
use function OpenStation\Apps\MyWordPress\woo_edit_url;
use function OpenStation\Apps\MyWordPress\woo_extras;
use function OpenStation\Apps\MyWordPress\woo_list;
use function OpenStation\Apps\MyWordPress\woo_ready;
use function OpenStation\Apps\MyWordPress\woo_sections;
use function OpenStation\Apps\MyWordPress\woo_sort_options;
use function OpenStation\Apps\MyWordPress\woo_user_extras;

class Tests_OpenStation_MyWordPressAppWoocommerce extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $post_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$post_id  = $factory->post->create(
			array(
				'post_title'  => 'Alpha strategy',
				'post_status' => 'publish',
				'post_author' => self::$admin_id,
			)
		);
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	public function tear_down() {
		remove_all_filters( 'openstation_my_wordpress_app_sections' );
		remove_all_filters( 'openstation_app_window_args' );
		unregister_post_type( 'product' );
		unregister_post_type( 'shop_coupon' );
		// App icons are process-scoped; see the appFramework tear_down.
		foreach ( array_keys( openstation_apps_registry()->all() ) as $id ) {
			openstation_unregister_icon( $id );
			if ( 0 === strpos( $id, 'demo-woo' ) ) {
				openstation_apps_registry()->remove( $id );
			}
		}
		parent::tear_down();
	}

	/**
	 * Run one dispatch against the registered app.
	 *
	 * @param string $action Action.
	 * @param array  $state  Client state.
	 * @param array  $args   Trigger args.
	 * @return array Runtime response.
	 */
	protected function dispatch( $action, array $state = array(), array $args = array() ) {
		return openstation_apps_runtime()->dispatch(
			'my-wordpress',
			array(
				'action' => $action,
				'state'  => $state,
				'args'   => $args,
			),
			openstation_apps_os()
		);
	}

	/**
	 * A section descriptor shaped like the app builds them.
	 *
	 * @param array $over Overrides.
	 * @return array
	 */
	protected function section( array $over = array() ) {
		return array_merge(
			array(
				'id'         => 'posts',
				'label'      => 'Posts',
				'icon'       => 'dashicons-admin-post',
				'kind'       => 'post',
				'post_type'  => 'post',
				'capability' => 'edit_posts',
				'thumbnails' => true,
			),
			$over
		);
	}

	// ------------------------------------------- inert without WooCommerce

	/**
	 * No WooCommerce means no Orders or Customers sections — and no
	 * fatal from any of the part's helpers, because that is every
	 * site by default.
	 *
	 * @covers \OpenStation\Apps\MyWordPress\woo_ready
	 * @covers \OpenStation\Apps\MyWordPress\woo_sections
	 */
	public function test_no_woo_sections_without_woocommerce() {
		$this->assertFalse( woo_ready() );
		$this->assertSame( array(), woo_sections( openstation_apps_os() ) );

		$response = $this->dispatch( 'refresh' );
		$ids      = array_column( $response['data']['sections'], 'id' );
		$this->assertNotContains( 'wc-orders', $ids );
		$this->assertNotContains( 'wc-customers', $ids );
	}

	/**
	 * Every claim helper stands down without WooCommerce, so the
	 * generic query, count, capability and URL paths run exactly as
	 * they did before the part existed.
	 *
	 * @covers \OpenStation\Apps\MyWordPress\woo_list
	 * @covers \OpenStation\Apps\MyWordPress\woo_count
	 * @covers \OpenStation\Apps\MyWordPress\woo_extras
	 * @covers \OpenStation\Apps\MyWordPress\woo_user_extras
	 * @covers \OpenStation\Apps\MyWordPress\woo_allowed
	 * @covers \OpenStation\Apps\MyWordPress\woo_edit_url
	 * @covers \OpenStation\Apps\MyWordPress\woo_sort_options
	 */
	public function test_helpers_stand_down_without_woocommerce() {
		$os     = openstation_apps_os();
		$orders = $this->section( array( 'id' => 'wc-orders' ) );

		$app = openstation_apps_registry()->all()['my-wordpress'] ?? null;
		$this->assertNotNull( $app, 'The app registers.' );
		$state = new \OpenStation\App\State( $app->defaults(), array() );

		$this->assertNull( woo_list( $os, $orders, $state ) );
		$this->assertNull( woo_count( $orders ) );
		$this->assertSame( array(), woo_extras( get_post( self::$post_id ) ) );
		$this->assertSame( array(), woo_user_extras( self::$admin_id ) );
		$this->assertNull( woo_allowed( $orders, self::$post_id, 'edit' ) );
		$this->assertSame( '', woo_edit_url( $orders, self::$post_id ) );
		$this->assertNull( woo_sort_options( $orders ) );
		$this->assertNull( woo_sort_options( $this->section( array( 'id' => 'cpt-product' ) ) ) );
	}

	// -------------------------------------------------- section decoration

	/**
	 * The decoration reuses WP Explorer's own icon mapper — a pin on
	 * a coupon reads as a mistake — but strips the entity-descriptor
	 * keys the app has no reader for, so they never ride the payload.
	 *
	 * @covers \OpenStation\Apps\MyWordPress\woo_decorate_section
	 */
	public function test_decoration_maps_icons_and_strips_entity_keys() {
		register_post_type( 'product', array( 'public' => true, 'show_ui' => true ) );
		register_post_type( 'shop_coupon', array( 'public' => false, 'show_ui' => true ) );

		$product = woo_decorate_section(
			$this->section( array( 'id' => 'cpt-product', 'post_type' => 'product' ) ),
			get_post_type_object( 'product' )
		);
		$this->assertSame( 'dashicons-products', $product['icon'] );
		$this->assertArrayNotHasKey( 'listFields', $product );
		$this->assertArrayNotHasKey( 'listQuery', $product );
		$this->assertArrayNotHasKey( 'tileSize', $product );

		$coupon = woo_decorate_section(
			$this->section( array( 'id' => 'cpt-shop_coupon', 'post_type' => 'shop_coupon' ) ),
			get_post_type_object( 'shop_coupon' )
		);
		$this->assertSame( 'dashicons-tickets-alt', $coupon['icon'] );
		$this->assertFalse( $coupon['thumbnails'], 'Coupons have no featured image.' );

		$plain = woo_decorate_section( $this->section(), get_post_type_object( 'post' ) );
		$this->assertSame( 'dashicons-admin-post', $plain['icon'] );
	}

	// ------------------------------------------------------ the flat guard

	/**
	 * A `flat` section's rows are not posts — an order id may collide
	 * with a real post id under legacy storage — so the post
	 * mutations refuse the whole section, whatever the ids resolve
	 * to.
	 *
	 * @covers \OpenStation\Apps\MyWordPress\quick_edit_action
	 * @covers \OpenStation\Apps\MyWordPress\bulk_trash_action
	 * @covers \OpenStation\Apps\MyWordPress\trash_action
	 */
	public function test_flat_sections_refuse_post_mutations() {
		add_filter(
			'openstation_my_wordpress_app_sections',
			function ( $sections ) {
				$sections[] = $this->section(
					array(
						'id'   => 'flat-posts',
						'flat' => true,
					)
				);
				return $sections;
			}
		);

		$this->dispatch(
			'quick-edit',
			array( 'section' => 'flat-posts' ),
			array(
				'items'  => array( self::$post_id ),
				'status' => 'draft',
			)
		);
		$this->assertSame( 'publish', get_post_status( self::$post_id ), 'Quick edit refuses a flat section.' );

		$this->dispatch(
			'bulk-trash',
			array(
				'section'  => 'flat-posts',
				'selected' => array( self::$post_id ),
			)
		);
		$this->assertSame( 'publish', get_post_status( self::$post_id ), 'Bulk trash refuses a flat section.' );

		$this->dispatch(
			'trash',
			array( 'section' => 'flat-posts' ),
			array( 'item' => self::$post_id )
		);
		$this->assertSame( 'publish', get_post_status( self::$post_id ), 'Trash refuses a flat section.' );
	}

	/**
	 * A flat section never opens the detail folder: `into` is repaired
	 * back to the flat list, because the relation queries have nothing
	 * to stand on when the rows are not posts.
	 *
	 * @covers \OpenStation\Apps\MyWordPress\payload
	 */
	public function test_flat_sections_never_navigate_into() {
		add_filter(
			'openstation_my_wordpress_app_sections',
			function ( $sections ) {
				$sections[] = $this->section(
					array(
						'id'   => 'flat-posts',
						'flat' => true,
					)
				);
				return $sections;
			}
		);

		$response = $this->dispatch(
			'into',
			array( 'section' => 'flat-posts' ),
			array( 'item' => self::$post_id )
		);

		$this->assertSame( 0, $response['state']['into'] );
		$this->assertNull( $response['data']['folder'] );
		$this->assertIsArray( $response['data']['list'], 'The flat list stays on screen.' );
	}

	// --------------------------------------------- the app-window-args seam

	/**
	 * The seam the integration rides in on: a companion plugin can
	 * append registered script/style handles to an app window it
	 * doesn't own, and they land on the registry entry — loaded on
	 * first open like every companion, never at boot.
	 *
	 * @covers ::openstation_apps_register_windows
	 */
	public function test_app_window_args_filter_reaches_the_registry() {
		wp_register_script( 'demo-woo-companion', 'https://example.test/companion.js', array(), '1.0', true );

		add_filter(
			'openstation_app_window_args',
			static function ( $args, $id ) {
				if ( 'demo-woo-args' === $id ) {
					$args['scripts']   = array_merge( (array) ( $args['scripts'] ?? array() ), array( 'demo-woo-companion' ) );
					$args['styles'][]  = 'demo-woo-style';
				}
				return $args;
			},
			10,
			2
		);

		openstation_apps_registry()->add(
			App::define( 'demo-woo-args' )->title( 'Demo' )->size( 300, 200 )
		);
		openstation_apps_register_windows();

		$entry = openstation_native_window_registry( 'demo-woo-args' );
		$this->assertIsArray( $entry );
		$this->assertContains( 'demo-woo-companion', $entry['scripts'] );
		$this->assertContains( 'demo-woo-style', $entry['styles'] );

		wp_deregister_script( 'demo-woo-companion' );
	}

	/**
	 * The Woo subscriber itself adds nothing without WooCommerce —
	 * the handles would resolve to a bundle whose config was never
	 * attached.
	 *
	 * @covers ::openstation_my_wordpress_woo_app_window_args
	 */
	public function test_woo_subscriber_is_inert_without_woocommerce() {
		$args = array( 'scripts' => array( 'openstation-app-my-wordpress-client' ) );
		$this->assertSame(
			$args,
			openstation_my_wordpress_woo_app_window_args( $args, 'my-wordpress' )
		);
		$this->assertSame(
			$args,
			openstation_my_wordpress_woo_app_window_args( $args, 'someone-else' )
		);
	}
}
