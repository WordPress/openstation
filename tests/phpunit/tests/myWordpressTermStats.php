<?php

class Tests_OpenStation_MyWordpressTermStats extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $author_id;
	protected static $contributor_id;
	protected static $subscriber_id;

	private $tag_id;
	private $published_id;
	private $draft_id;
	private $private_id;
	private $pending_id;
	private $future_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id       = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$author_id      = $factory->user->create( array( 'role' => 'author' ) );
		self::$contributor_id = $factory->user->create( array( 'role' => 'contributor' ) );
		self::$subscriber_id  = $factory->user->create( array( 'role' => 'subscriber' ) );
	}

	public function set_up() {
		parent::set_up();

		wp_set_current_user( self::$admin_id );
		do_action( 'rest_api_init' );

		$this->tag_id = self::factory()->tag->create();

		$this->published_id = $this->make_post( 'publish', 'Public article' );
		$this->draft_id     = $this->make_post( 'draft', 'Secret draft' );
		$this->private_id   = $this->make_post( 'private', 'Private notes' );
		$this->pending_id   = $this->make_post( 'pending', 'Pending review' );
		$this->future_id    = $this->make_post( 'future', 'Scheduled scoop', null, '2036-01-01 00:00:00' );
	}

	private function make_post( $status, $title, $author_id = null, $date = null ) {
		$args = array(
			'post_author' => (int) ( $author_id ?? self::$admin_id ),
			'post_status' => $status,
			'post_title'  => $title,
		);
		if ( null !== $date ) {
			$args['post_date']     = $date;
			$args['post_date_gmt'] = $date;
		}
		$post_id = self::factory()->post->create( $args );
		wp_set_object_terms( $post_id, array( $this->tag_id ), 'post_tag' );
		return $post_id;
	}

	private function dispatch( $taxonomy = 'post_tag', $term_id = null ) {
		$term_id = $term_id ?? $this->tag_id;
		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/term-stats/' . $taxonomy . '/' . (int) $term_id );
		return rest_get_server()->dispatch( $request );
	}

	private function recent_ids( $response ) {
		return wp_list_pluck( $response->get_data()['recent'], 'id' );
	}

	private function post_counts( $response ) {
		return $response->get_data()['counts']['posts'];
	}

	public function test_contributor_recent_excludes_unpublished() {
		wp_set_current_user( self::$contributor_id );

		$response = $this->dispatch();
		$this->assertSame( 200, $response->get_status() );

		$ids = $this->recent_ids( $response );
		$this->assertContains( $this->published_id, $ids );
		$this->assertNotContains( $this->draft_id, $ids );
		$this->assertNotContains( $this->private_id, $ids );
		$this->assertNotContains( $this->pending_id, $ids );
		$this->assertNotContains( $this->future_id, $ids );
	}

	public function test_contributor_counts_hide_unpublished() {
		wp_set_current_user( self::$contributor_id );

		$counts = $this->post_counts( $this->dispatch() );
		$this->assertSame( 1, $counts['publish'] );
		$this->assertSame( 0, $counts['draft'] );
		$this->assertSame( 0, $counts['private'] );
		$this->assertSame( 0, $counts['pending'] );
		$this->assertSame( 0, $counts['future'] );
		$this->assertSame( 1, $counts['total'] );
	}

	public function test_admin_sees_unpublished_in_recent_and_counts() {
		wp_set_current_user( self::$admin_id );

		$response = $this->dispatch();
		$ids      = $this->recent_ids( $response );
		$this->assertContains( $this->draft_id, $ids );
		$this->assertContains( $this->private_id, $ids );
		$this->assertContains( $this->pending_id, $ids );
		$this->assertContains( $this->future_id, $ids );

		$counts = $this->post_counts( $response );
		$this->assertSame( 1, $counts['publish'] );
		$this->assertSame( 1, $counts['draft'] );
		$this->assertSame( 1, $counts['private'] );
		$this->assertSame( 1, $counts['pending'] );
		$this->assertSame( 1, $counts['future'] );
		$this->assertSame( 5, $counts['total'] );
	}

	public function test_author_sees_own_draft_only() {
		$own_draft = $this->make_post( 'draft', 'My own draft', self::$author_id );

		wp_set_current_user( self::$author_id );

		$response = $this->dispatch();
		$ids      = $this->recent_ids( $response );
		$this->assertContains( $own_draft, $ids );
		$this->assertNotContains( $this->draft_id, $ids );
		$this->assertNotContains( $this->private_id, $ids );
		$this->assertNotContains( $this->future_id, $ids );

		$counts = $this->post_counts( $response );
		$this->assertSame( 1, $counts['draft'] );
		$this->assertSame( 0, $counts['private'] );
		$this->assertSame( 0, $counts['future'] );
	}

	public function test_custom_public_status_is_visible_to_contributors() {
		register_post_status( 'showcase', array( 'public' => true ) );
		$showcase_id = $this->make_post( 'showcase', 'Showcased piece' );

		try {
			wp_set_current_user( self::$contributor_id );
			$response = $this->dispatch();

			$this->assertContains( $showcase_id, $this->recent_ids( $response ) );

			$this->assertSame( 2, $this->post_counts( $response )['total'] );
		} finally {
			unset( $GLOBALS['wp_post_statuses']['showcase'] );
		}
	}

	public function test_recent_is_capped_at_five_newest_first() {
		$extras = array();
		for ( $i = 1; $i <= 6; $i++ ) {
			$extras[ $i ] = $this->make_post( 'publish', "Extra $i", null, sprintf( '2020-01-%02d 00:00:00', $i ) );
		}

		wp_set_current_user( self::$contributor_id );
		$this->assertSame(
			array( $this->published_id, $extras[6], $extras[5], $extras[4], $extras[3] ),
			$this->recent_ids( $this->dispatch() )
		);
	}

	public function test_hidden_taxonomy_is_not_served_to_contributors() {
		$menu = wp_insert_term( 'Primary menu', 'nav_menu' );
		$this->assertNotWPError( $menu );

		wp_set_current_user( self::$contributor_id );
		$response = $this->dispatch( 'nav_menu', $menu['term_id'] );
		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'openstation_invalid_taxonomy', $response->get_data()['code'] );

		wp_set_current_user( self::$admin_id );
		$this->assertSame( 200, $this->dispatch( 'nav_menu', $menu['term_id'] )->get_status() );
	}

	public function test_subscriber_is_rejected_by_route() {
		wp_set_current_user( self::$subscriber_id );
		$this->assertSame( 403, $this->dispatch()->get_status() );
	}

	public function test_filter_narrowed_route_refuses_admins() {
		add_filter( 'openstation_my_wordpress_user_can_use', '__return_false' );

		wp_set_current_user( self::$admin_id );
		$this->assertSame( 403, $this->dispatch()->get_status() );
	}
}
