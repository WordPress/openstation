<?php
/**
 * FeedBuddy integration tests.
 *
 * @package OpenStationFeedBuddy
 */

if ( ! class_exists( 'Feed_Buddy_Service' ) ) {
	require_once dirname( __DIR__, 2 ) . '/desktop-mode-feed-buddy.php';
}

/**
 * @group openstation
 */
class Test_Feed_Buddy_Service extends WP_UnitTestCase {

	/**
	 * @var Feed_Buddy_Service
	 */
	private $service;

	/**
	 * @var int
	 */
	private $user_id;

	/**
	 * @var string
	 */
	private $url;

	/**
	 * @var string
	 */
	private $http_body = '';

	/**
	 * @var callable|null
	 */
	private $http_filter;

	/**
	 * @var array
	 */
	private $last_http_args = array();

	public function set_up() {
		parent::set_up();
		$this->service  = new Feed_Buddy_Service();
		$this->user_id  = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		$this->url      = 'https://example.com/' . sanitize_key( $this->getName() ) . '.xml';
		$this->http_body = $this->rss(
			array(
				array(
					'guid'        => 'first',
					'title'       => 'First post',
					'description' => '<b>Hello</b> from the feed.',
				),
			)
		);
		wp_set_current_user( $this->user_id );
	}

	public function tear_down() {
		if ( $this->http_filter ) {
			remove_filter( 'pre_http_request', $this->http_filter, 10 );
		}
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	/**
	 * Preempt WordPress HTTP while preserving the request arguments for assertions.
	 *
	 * @param callable|null $resolver Optional URL-to-body resolver.
	 */
	private function stub_http( $resolver = null ) {
		$this->http_filter = function ( $preempt, $args, $url ) use ( $resolver ) {
			unset( $preempt );
			$this->last_http_args = $args;
			$body                 = $resolver
				? call_user_func( $resolver, $url )
				: $this->http_body;
			return array(
				'headers'  => array( 'content-type' => 'application/rss+xml' ),
				'body'     => $body,
				'response' => array(
					'code'    => 200,
					'message' => 'OK',
				),
				'cookies'  => array(),
				'filename' => null,
			);
		};
		add_filter( 'pre_http_request', $this->http_filter, 10, 3 );
	}

	/**
	 * Build a compact RSS fixture.
	 *
	 * @param array $items Items.
	 * @return string
	 */
	private function rss( array $items ) {
		$xml = '<?xml version="1.0" encoding="UTF-8"?>'
			. '<rss version="2.0"><channel><title>Example Feed</title>'
			. '<link>https://example.com/</link><description>Fixture</description>';
		foreach ( $items as $index => $item ) {
			$guid        = isset( $item['guid'] ) ? $item['guid'] : 'item-' . $index;
			$title       = isset( $item['title'] ) ? $item['title'] : 'Post';
			$description = isset( $item['description'] ) ? $item['description'] : 'Excerpt';
			$xml        .= '<item><guid>' . esc_html( $guid ) . '</guid>'
				. '<title>' . esc_html( $title ) . '</title>'
				. '<link>https://example.com/' . rawurlencode( $guid ) . '</link>'
				. '<pubDate>Mon, 27 Jul 2026 12:00:0' . $index . ' GMT</pubDate>'
				. '<description><![CDATA[' . $description . ']]></description></item>';
		}
		return $xml . '</channel></rss>';
	}

	public function test_subscription_limit_matches_the_two_hundredth_buddy_warning() {
		$this->assertSame( 200, Feed_Buddy_Service::MAX_SUBSCRIPTIONS );
	}

	public function test_stylesheet_dependencies_use_registered_open_station_handles() {
		open_station_register_assets();
		feed_buddy_register_assets();
		$styles = wp_styles();
		$this->assertArrayHasKey( 'desktop-mode-feed-buddy', $styles->registered );
		$this->assertSame(
			array( 'os-variables', 'dashicons' ),
			$styles->registered['desktop-mode-feed-buddy']->deps
		);
		foreach ( $styles->registered['desktop-mode-feed-buddy']->deps as $dependency ) {
			$this->assertArrayHasKey( $dependency, $styles->registered );
		}
	}

	public function test_new_subscriptions_baseline_existing_items_and_track_later_posts() {
		$this->stub_http();
		$state = $this->service->add_subscription( $this->user_id, array( 'url' => $this->url ) );

		$this->assertNotWPError( $state );
		$this->assertSame( 0, $state['summaries'][0]['unread'] );
		$subscription_id = $state['subscriptions'][0]['id'];

		$this->http_body = $this->rss(
			array(
				array(
					'guid'  => 'second',
					'title' => 'Second post',
				),
				array(
					'guid'  => 'first',
					'title' => 'First post',
				),
			)
		);
		$this->service->resolve_feed( $this->url, true );
		$state = $this->service->get_state( $this->user_id );
		$this->assertSame( 1, $state['summaries'][0]['unread'] );

		$page = $this->service->get_items( $this->user_id, $subscription_id );
		$this->assertCount( 2, $page['items'] );
		$repeat_page = $this->service->get_items( $this->user_id, $subscription_id );
		$this->assertSame(
			wp_list_pluck( $page['items'], 'id' ),
			wp_list_pluck( $repeat_page['items'], 'id' ),
			'Normalized item identities must remain stable across cached reads.'
		);
		$new_item = current(
			array_filter(
				$page['items'],
				static function ( $item ) {
					return 'Second post' === $item['title'];
				}
			)
		);
		$this->assertIsArray( $new_item );
		$this->assertTrue( $new_item['unread'] );

		$state = $this->service->update_read_state(
			$this->user_id,
			array(
				'scope'   => 'item',
				'read'    => true,
				'feedId'  => $subscription_id,
				'itemIds' => array( $new_item['id'] ),
			)
		);
		$this->assertSame( 0, $state['summaries'][0]['unread'] );

		$state = $this->service->update_read_state(
			$this->user_id,
			array(
				'scope'   => 'item',
				'read'    => false,
				'feedId'  => $subscription_id,
				'itemIds' => array( $new_item['id'] ),
			)
		);
		$this->assertSame( 1, $state['summaries'][0]['unread'] );
	}

	public function test_read_history_is_bounded_and_unknown_feed_ids_are_rejected() {
		$this->stub_http();
		$state           = $this->service->add_subscription( $this->user_id, array( 'url' => $this->url ) );
		$subscription_id = $state['subscriptions'][0]['id'];
		$item_ids        = array();
		for ( $index = 0; $index < 300; ++$index ) {
			$item_ids[] = hash( 'sha256', 'read-item-' . $index );
		}

		$this->service->update_read_state(
			$this->user_id,
			array(
				'scope'   => 'item',
				'read'    => true,
				'feedId'  => $subscription_id,
				'itemIds' => $item_ids,
			)
		);
		$stored = get_user_meta( $this->user_id, Feed_Buddy_Service::META_READ_ITEMS, true );
		$this->assertCount( Feed_Buddy_Service::MAX_READ_IDS, $stored[ $subscription_id ] );

		$error = $this->service->update_read_state(
			$this->user_id,
			array(
				'scope'   => 'item',
				'read'    => true,
				'feedId'  => 'not-this-users-feed',
				'itemIds' => array( $item_ids[0] ),
			)
		);
		$this->assertWPError( $error );
		$this->assertSame( 'feed_buddy_subscription_not_found', $error->get_error_code() );
	}

	public function test_homepage_autodiscovery_resolves_a_relative_atom_feed() {
		$homepage = 'https://example.com/articles/index.html';
		$atom_url = 'https://example.com/articles/feed.atom';
		$html     = '<!doctype html><html><head>'
			. '<link rel="alternate" type="application/atom+xml" href="feed.atom">'
			. '</head><body>Homepage</body></html>';
		$atom     = '<?xml version="1.0" encoding="utf-8"?>'
			. '<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Example</title>'
			. '<id>https://example.com/</id><updated>2026-07-28T12:00:00Z</updated>'
			. '<entry><title>Atom post</title><id>atom-1</id>'
			. '<link href="https://example.com/atom-1"/>'
			. '<updated>2026-07-28T12:00:00Z</updated><summary>Atom excerpt</summary>'
			. '</entry></feed>';
		$this->stub_http(
			static function ( $url ) use ( $homepage, $atom_url, $html, $atom ) {
				if ( $homepage === $url ) {
					return $html;
				}
				return $atom_url === $url ? $atom : '';
			}
		);

		$state = $this->service->add_subscription( $this->user_id, array( 'url' => $homepage ) );
		$this->assertNotWPError( $state );
		$this->assertSame( $atom_url, $state['subscriptions'][0]['url'] );
		$this->assertSame( 'Atom Example', $state['subscriptions'][0]['title'] );
	}

	public function test_feed_markup_is_normalized_to_plain_text() {
		$this->http_body = $this->rss(
			array(
				array(
					'guid'        => 'unsafe',
					'title'       => '<b>Headline</b>',
					'description' => '<b>Hello</b><script>alert(1)</script> world',
				),
			)
		);
		$this->stub_http();
		$state = $this->service->add_subscription( $this->user_id, array( 'url' => $this->url ) );
		$page  = $this->service->get_items( $this->user_id, $state['subscriptions'][0]['id'] );

		$this->assertStringNotContainsString( '<', $page['items'][0]['title'] );
		$this->assertStringNotContainsString( '<', $page['items'][0]['excerpt'] );
		$this->assertStringContainsString( 'Hello', $page['items'][0]['excerpt'] );
	}

	public function test_malformed_feed_returns_a_sanitized_error() {
		$this->http_body = '<rss><channel><title>Broken';
		$this->stub_http();
		$error = $this->service->add_subscription( $this->user_id, array( 'url' => $this->url ) );

		$this->assertWPError( $error );
		$this->assertSame( 'feed_buddy_not_a_feed', $error->get_error_code() );
		$this->assertStringNotContainsString( '<', $error->get_error_message() );
	}

	public function test_http_guardrails_and_response_cap_are_applied() {
		$this->http_body = str_repeat( 'x', Feed_Buddy_Service::MAX_RESPONSE_SIZE + 1 );
		$this->stub_http();
		$error = $this->service->resolve_feed( $this->url, true );

		$this->assertWPError( $error );
		$this->assertSame( 'feed_buddy_response_too_large', $error->get_error_code() );
		$this->assertSame( 8, $this->last_http_args['timeout'] );
		$this->assertSame( 3, $this->last_http_args['redirection'] );
		$this->assertSame(
			Feed_Buddy_Service::MAX_RESPONSE_SIZE,
			$this->last_http_args['limit_response_size']
		);
		$this->assertTrue( $this->last_http_args['reject_unsafe_urls'] );
	}

	public function test_private_network_urls_are_rejected_before_fetch() {
		$error = $this->service->add_subscription(
			$this->user_id,
			array( 'url' => 'http://127.0.0.1/private-feed.xml' )
		);
		$this->assertWPError( $error );
		$this->assertSame( 'feed_buddy_invalid_url', $error->get_error_code() );
	}

	public function test_cache_and_manual_refresh_rate_limit() {
		$request_count = 0;
		$this->stub_http(
			function () use ( &$request_count ) {
				++$request_count;
				return $this->http_body;
			}
		);
		$state = $this->service->add_subscription( $this->user_id, array( 'url' => $this->url ) );
		$this->service->get_state( $this->user_id );
		$this->assertSame( 1, $request_count, 'Cached state should not refetch within ten minutes.' );

		$subscription_id = $state['subscriptions'][0]['id'];
		$first_refresh   = $this->service->refresh( $this->user_id, $subscription_id );
		$this->assertNotWPError( $first_refresh );
		$second_refresh = $this->service->refresh( $this->user_id, $subscription_id );
		$this->assertWPError( $second_refresh );
		$this->assertSame( 'feed_buddy_refresh_rate_limited', $second_refresh->get_error_code() );
		$this->assertSame( 429, $second_refresh->get_error_data()['status'] );
	}

	public function test_subscriptions_are_isolated_per_user() {
		$this->stub_http();
		$this->service->add_subscription( $this->user_id, array( 'url' => $this->url ) );
		$other_user = self::factory()->user->create( array( 'role' => 'subscriber' ) );

		$this->assertCount( 1, $this->service->get_state( $this->user_id )['subscriptions'] );
		$this->assertCount( 0, $this->service->get_state( $other_user )['subscriptions'] );
	}

	public function test_subscription_crud_grouping_and_ordering() {
		$first_url  = 'https://example.com/first.xml';
		$second_url = 'https://example.com/second.xml';
		$this->stub_http();
		$state = $this->service->add_subscription(
			$this->user_id,
			array(
				'url'   => $first_url,
				'title' => 'First',
				'group' => 'NEWS',
			)
		);
		$state = $this->service->add_subscription(
			$this->user_id,
			array(
				'url'   => $second_url,
				'title' => 'Second',
				'group' => 'BLOGS',
			)
		);
		$this->assertSame( array( 'NEWS', 'BLOGS' ), $state['groups'] );

		$second_id = $state['subscriptions'][1]['id'];
		$state     = $this->service->update_subscription(
			$this->user_id,
			$second_id,
			array(
				'title'     => 'Renamed',
				'group'     => 'TECH',
				'direction' => -1,
			)
		);
		$this->assertSame( $second_id, $state['subscriptions'][0]['id'] );
		$this->assertSame( 0, $state['subscriptions'][0]['order'] );
		$this->assertSame( 'Renamed', $state['subscriptions'][0]['title'] );
		$this->assertSame( 'TECH', $state['subscriptions'][0]['group'] );

		$first_id = $state['subscriptions'][1]['id'];
		$state    = $this->service->delete_subscription( $this->user_id, $first_id );
		$this->assertCount( 1, $state['subscriptions'] );
		$this->assertSame( $second_id, $state['subscriptions'][0]['id'] );
	}

	public function test_rest_permissions_and_open_station_registration() {
		$controller = new Feed_Buddy_REST_Controller( $this->service );
		wp_set_current_user( 0 );
		$this->assertWPError( $controller->check_permission() );
		wp_set_current_user( $this->user_id );
		$this->assertTrue( $controller->check_permission() );
		add_action( 'rest_api_init', array( $controller, 'register_routes' ) );
		do_action( 'rest_api_init', rest_get_server() );
		remove_action( 'rest_api_init', array( $controller, 'register_routes' ) );
		$routes = rest_get_server()->get_routes();
		foreach (
			array(
				'/feed-buddy/v1/state',
				'/feed-buddy/v1/subscriptions',
				'/feed-buddy/v1/subscriptions/(?P<id>[a-f0-9-]+)',
				'/feed-buddy/v1/items',
				'/feed-buddy/v1/read',
				'/feed-buddy/v1/refresh',
			) as $route
		) {
			$this->assertArrayHasKey( $route, $routes );
		}

		feed_buddy_register_assets();
		feed_buddy_register_surfaces();
		$window = open_station_native_window_registry( 'feed-buddy-reader' );
		$widget = open_station_desktop_widget_registry( 'feed-buddy/buddy-list' );
		$this->assertSame( 'dock', $window['placement'] );
		$this->assertSame( 760, $window['width'] );
		$this->assertTrue( $widget['movable'] );
		$this->assertTrue( $widget['resizable'] );
		$this->assertSame( 280, $widget['default_width'] );

		ob_start();
		feed_buddy_render_reader_template();
		$template = ob_get_clean();
		$this->assertStringContainsString( '<os-button', $template );
		$this->assertStringContainsString( 'data-feed-buddy-reader', $template );
		$this->assertStringContainsString( 'Mark all read', $template );
	}
}
