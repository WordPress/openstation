<?php
/**
 * Tests for field-scoped WordPress.org search in Plugins Discover.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-plugins-window
 * @group ajax
 */
require_once ABSPATH . 'wp-admin/includes/ajax-actions.php';

class Tests_OpenStation_PluginsWindowBrowseAjax extends WP_Ajax_UnitTestCase {

	private $admin_id;

	public function set_up() {
		parent::set_up();
		$this->admin_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $this->admin_id );
	}

	public function tear_down() {
		remove_all_filters( 'plugins_api' );
		parent::tear_down();
	}

	/**
	 * Ordinary Discover searches keep using the directory's relevance
	 * search field.
	 *
	 * @covers ::openstation_plugins_window_ajax_browse
	 */
	public function test_everything_scope_maps_to_search() {
		$args = $this->dispatch_search( 'forms for events', 'all' );
		$this->assertSame( 'forms for events', $args->search );
		$this->assertObjectNotHasProperty( 'author', $args );
		$this->assertObjectNotHasProperty( 'tag', $args );
	}

	/**
	 * Author scope uses the first-class plugins_api author argument.
	 *
	 * @covers ::openstation_plugins_window_ajax_browse
	 */
	public function test_author_scope_maps_to_author() {
		$args = $this->dispatch_search( 'automattic', 'author' );
		$this->assertSame( 'automattic', $args->author );
		$this->assertObjectNotHasProperty( 'search', $args );
	}

	/**
	 * Human-readable tag searches are normalized to directory slugs.
	 *
	 * @covers ::openstation_plugins_window_ajax_browse
	 */
	public function test_tag_scope_maps_to_slugged_tag() {
		$args = $this->dispatch_search( 'contact form', 'tag' );
		$this->assertSame( 'contact-form', $args->tag );
		$this->assertObjectNotHasProperty( 'search', $args );
	}

	/**
	 * Unknown scopes fail closed to the normal directory search.
	 *
	 * @covers ::openstation_plugins_window_ajax_browse
	 */
	public function test_unknown_scope_falls_back_to_search() {
		$args = $this->dispatch_search( 'backup', 'not-a-field' );
		$this->assertSame( 'backup', $args->search );
		$this->assertObjectNotHasProperty( 'author', $args );
	}

	/**
	 * Dispatch a browse request and return the args observed by
	 * plugins_api without making an outbound WordPress.org request.
	 *
	 * @return object
	 */
	private function dispatch_search( $search, $scope ) {
		$observed = null;
		add_filter(
			'plugins_api',
			static function ( $result, $action, $args ) use ( &$observed ) {
				if ( 'query_plugins' !== $action ) {
					return $result;
				}
				$observed = $args;
				return (object) array(
					'plugins' => array(),
					'info'    => array(
						'page'    => 1,
						'pages'   => 0,
						'results' => 0,
					),
				);
			},
			10,
			3
		);

		$_POST = array(
			'_ajax_nonce'  => wp_create_nonce( 'desktop-mode-plugins' ),
			'search'       => $search,
			'search_scope' => $scope,
		);
		$this->_last_response = '';
		try {
			$this->_handleAjax( 'openstation_plugins_browse' );
		} catch ( WPAjaxDieContinueException $e ) {
			// Expected — wp_send_json_success() terminates the request.
		} catch ( WPAjaxDieStopException $e ) {
			// Some Core versions use the stop variant.
		}
		remove_all_filters( 'plugins_api' );

		$this->assertIsObject( $observed );
		return $observed;
	}
}
