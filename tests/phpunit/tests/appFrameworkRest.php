<?php
/**
 * Tests for the App Framework's in-process REST proxy — the way a
 * list app's `data()` reads the collections WordPress already serves
 * — and the `reopen` lifecycle the list apps retarget through.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group app-framework
 */

use OpenStation\App;

class Tests_OpenStation_AppFrameworkRest extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	/**
	 * @covers ::openstation_app_rest
	 */
	public function test_get_returns_the_collection_with_fields_applied_and_totals() {
		$ids = self::factory()->post->create_many( 3 );

		$result = openstation_app_rest(
			'GET',
			'wp/v2/posts',
			array(
				'per_page' => 2,
				'_fields'  => 'id,title',
				'status'   => 'any',
			)
		);

		$this->assertTrue( $result['ok'] );
		$this->assertSame( 200, $result['status'] );
		$this->assertSame( '', $result['error'] );
		$this->assertCount( 2, $result['data'] );
		$this->assertSame( 3, $result['total'] );
		$this->assertSame( 2, $result['pages'] );
		// `_fields` was honoured — the same projection the browser gets.
		$this->assertSame( array( 'id', 'title' ), array_keys( $result['data'][0] ) );
		$this->assertContains( $result['data'][0]['id'], $ids );
	}

	/**
	 * @covers ::openstation_app_rest
	 */
	public function test_embed_expands_the_linked_resources_like_the_browser_sees_them() {
		self::factory()->post->create( array( 'post_author' => self::$admin_id ) );

		$result = openstation_app_rest(
			'GET',
			'wp/v2/posts',
			array(
				'per_page' => 1,
				'_embed'   => 'author',
				'_fields'  => 'id,author,_links,_embedded',
			)
		);

		$this->assertTrue( $result['ok'] );
		$row = $result['data'][0];
		$this->assertArrayHasKey( '_embedded', $row );
		$this->assertSame( self::$admin_id, (int) $row['_embedded']['author'][0]['id'] );
	}

	/**
	 * @covers ::openstation_app_rest
	 */
	public function test_a_refused_request_comes_back_as_an_error_not_an_exception() {
		wp_set_current_user( 0 );

		$result = openstation_app_rest( 'GET', 'wp/v2/users', array( 'context' => 'edit' ) );

		$this->assertFalse( $result['ok'] );
		$this->assertSame( 401, $result['status'] );
		$this->assertNotSame( '', $result['error'] );
		$this->assertNotSame( '', $result['code'] );
		$this->assertNull( $result['data'] );
	}

	/**
	 * @covers ::openstation_app_rest
	 */
	public function test_a_write_reaches_the_controller_with_its_body() {
		$post_id = self::factory()->post->create( array( 'post_title' => 'Before' ) );

		$result = openstation_app_rest( 'POST', 'wp/v2/posts/' . $post_id, array(), array( 'title' => 'After' ) );

		$this->assertTrue( $result['ok'] );
		$this->assertSame( 'After', get_post( $post_id )->post_title );
	}

	/**
	 * @covers ::openstation_app_rest_page
	 */
	public function test_page_builds_the_paged_list_envelope() {
		self::factory()->post->create_many( 5 );

		$page = openstation_app_rest_page(
			'wp/v2/posts',
			array(
				'page'     => 2,
				'per_page' => 2,
				'_fields'  => 'id',
				'status'   => 'any',
			)
		);

		$this->assertSame( array( 'items', 'total', 'pages', 'page', 'perPage', 'error', 'code' ), array_keys( $page ) );
		$this->assertCount( 2, $page['items'] );
		$this->assertSame( 5, $page['total'] );
		$this->assertSame( 3, $page['pages'] );
		$this->assertSame( 2, $page['page'] );
		$this->assertSame( 2, $page['perPage'] );
		$this->assertSame( '', $page['error'] );
		$this->assertSame( '', $page['code'] );
	}

	/**
	 * @covers ::openstation_app_rest_page
	 */
	public function test_page_sends_its_defaults_so_the_envelope_describes_the_page_served() {
		self::factory()->post->create_many( 12 );

		$page = openstation_app_rest_page( 'wp/v2/posts', array( '_fields' => 'id', 'status' => 'any' ) );

		// Core would have served 10 without a `per_page`; the envelope
		// says 20, so the helper sends 20.
		$this->assertSame( 20, $page['perPage'] );
		$this->assertCount( 12, $page['items'] );
		$this->assertSame( 1, $page['pages'] );
	}

	/**
	 * @covers ::openstation_app_rest_page_is_out_of_range
	 */
	public function test_a_page_past_the_end_is_out_of_range_but_a_refusal_is_not() {
		self::factory()->post->create_many( 2 );

		$beyond = openstation_app_rest_page( 'wp/v2/posts', array( 'page' => 9, 'per_page' => 2, '_fields' => 'id', 'status' => 'any' ) );
		$this->assertSame( array(), $beyond['items'] );
		$this->assertSame( 'rest_post_invalid_page_number', $beyond['code'] );
		$this->assertTrue( openstation_app_rest_page_is_out_of_range( $beyond ) );

		$refused = openstation_app_rest_page( 'wp/v2/posts', array( 'page' => 2, 'orderby' => 'no-such-key', '_fields' => 'id' ) );
		$this->assertSame( array(), $refused['items'] );
		$this->assertSame( 'rest_invalid_param', $refused['code'] );
		$this->assertFalse( openstation_app_rest_page_is_out_of_range( $refused ) );

		$this->assertFalse( openstation_app_rest_page_is_out_of_range( openstation_app_rest_page( 'wp/v2/posts', array( '_fields' => 'id' ) ) ) );
	}

	/**
	 * @covers ::openstation_app_rest
	 */
	public function test_a_single_resource_is_one_thing_however_many_fields_it_has() {
		$post_id = self::factory()->post->create();

		$result = openstation_app_rest( 'GET', 'wp/v2/posts/' . $post_id, array( 'context' => 'edit' ) );

		$this->assertTrue( $result['ok'] );
		$this->assertSame( 1, $result['total'] );
		$this->assertSame( 1, $result['pages'] );
	}

	/**
	 * @covers ::openstation_app_rest_page
	 */
	public function test_page_reports_a_refusal_instead_of_an_empty_table() {
		wp_set_current_user( 0 );

		$page = openstation_app_rest_page( 'wp/v2/users', array( 'context' => 'edit' ) );

		$this->assertSame( array(), $page['items'] );
		$this->assertSame( 0, $page['total'] );
		$this->assertNotSame( '', $page['error'] );
	}

	/**
	 * @covers \OpenStation\App::config
	 */
	public function test_a_callable_config_is_resolved_when_the_manifest_is_built() {
		$calls = 0;
		$app   = App::define( 'lazy-config' )
			->config( array( 'static' => 1, 'shared' => 'static' ) )
			->config(
				static function () use ( &$calls ) {
					++$calls;
					return array(
						'shared' => 'lazy',
						'viewer' => get_current_user_id(),
					);
				}
			);
		$this->assertSame( 0, $calls );

		$config = $app->manifest()['config'];
		$this->assertSame( 1, $calls );
		$this->assertSame( 1, $config['static'] );
		// A lazy value wins over a static one of the same name.
		$this->assertSame( 'lazy', $config['shared'] );
		$this->assertSame( self::$admin_id, $config['viewer'] );

		// Resolved for whoever asks at that moment.
		wp_set_current_user( 0 );
		$this->assertSame( 0, $app->manifest()['config']['viewer'] );
	}

	/**
	 * @covers \OpenStation\App::manifest
	 */
	public function test_reopen_is_a_lifecycle_action_only_when_declared() {
		$silent = App::define( 'reopen-silent' )->action( 'noop', static function () {} );
		$this->assertSame( array(), $silent->manifest()['lifecycle'] );

		$aware = App::define( 'reopen-aware' )->action( 'reopen', static function () {} );
		$this->assertSame( array( 'reopen' ), $aware->manifest()['lifecycle'] );
		$this->assertContains( 'reopen', App::LIFECYCLE_ACTIONS );
	}
}
