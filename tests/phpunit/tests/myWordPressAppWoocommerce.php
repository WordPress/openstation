<?php

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

		foreach ( array_keys( openstation_apps_registry()->all() ) as $id ) {
			openstation_unregister_icon( $id );
			if ( 0 === strpos( $id, 'demo-woo' ) ) {
				openstation_apps_registry()->remove( $id );
			}
		}
		parent::tear_down();
	}

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

	public function test_no_woo_sections_without_woocommerce() {
		$this->assertFalse( woo_ready() );
		$this->assertSame( array(), woo_sections( openstation_apps_os() ) );

		$response = $this->dispatch( 'refresh' );
		$ids      = array_column( $response['data']['sections'], 'id' );
		$this->assertNotContains( 'wc-orders', $ids );
		$this->assertNotContains( 'wc-customers', $ids );
	}

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
