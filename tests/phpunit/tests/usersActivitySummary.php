<?php

class Tests_OpenStation_UsersActivitySummary extends WP_UnitTestCase {
	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
	}

	public function test_complete_population_totals_and_bounded_leaders() {
		$before = openstation_users_window_activity_summary();
		$ids = self::factory()->user->create_many( 25, array( 'role' => 'author' ) );
		foreach ( $ids as $id ) {
			self::factory()->post->create( array( 'post_author' => $id, 'post_status' => 'publish' ) );
			self::factory()->post->create( array( 'post_author' => $id, 'post_status' => 'draft' ) );
			update_user_meta( $id, OPENSTATION_LAST_LOGIN_META_KEY, time() - 60 );
		}
		$leader = end( $ids );
		self::factory()->post->create( array( 'post_author' => $leader, 'post_status' => 'publish', 'post_type' => 'page' ) );
		self::factory()->comment->create( array( 'user_id' => $leader, 'comment_approved' => '1' ) );
		self::factory()->comment->create( array( 'user_id' => $leader, 'comment_approved' => '0' ) );
		$out = openstation_users_window_activity_summary();
		$this->assertNotWPError( $out );
		$this->assertSame( $before['total'] + 25, $out['total'] );
		$this->assertSame( $before['totals']['posts'] + 25, $out['totals']['posts'] );
		$this->assertSame( $before['totals']['pages'] + 1, $out['totals']['pages'] );
		$this->assertSame( $before['totals']['comments'] + 1, $out['totals']['comments'] );
		$this->assertSame( $before['active30'] + 25, $out['active30'] );
		$this->assertCount( 6, $out['leaders']['posts'] );
		$this->assertSame( $leader, $out['leaders']['pages'][0]['id'] );
		$this->assertSame( $leader, $out['leaders']['comments'][0]['id'] );
		$this->assertCount( 6, $out['logins'] );
		$this->assertCount( 4, $out['registered'] );
		foreach ( $out['logins'] as $person ) {
			$this->assertArrayHasKey( 'roles', $person );
			$this->assertArrayNotHasKey( 'email', $person );
			$this->assertArrayNotHasKey( '_score', $person );
		}
	}

	public function test_capabilities_and_extensibility() {
		$called = false;
		$filter = static function ( $summary ) use ( &$called ) { $called = true; return $summary; };
		add_filter( 'openstation_users_window_activity_summary', $filter );
		$response = rest_get_server()->dispatch( new WP_REST_Request( 'GET', '/desktop-mode/v1/users/activity-summary' ) );
		remove_filter( 'openstation_users_window_activity_summary', $filter );
		$this->assertSame( 200, $response->get_status() );
		$this->assertTrue( $called );
		foreach ( array( 0, self::factory()->user->create( array( 'role' => 'subscriber' ) ) ) as $id ) {
			wp_set_current_user( $id );
			$this->assertWPError( openstation_users_window_activity_summary() );
			$response = rest_get_server()->dispatch( new WP_REST_Request( 'GET', '/desktop-mode/v1/users/activity-summary' ) );
			$this->assertContains( $response->get_status(), array( 401, 403 ) );
		}
	}

	public function test_other_site_members_are_excluded() {
		if ( ! is_multisite() ) { $this->markTestSkipped( 'Multisite only.' ); }
		$before = openstation_users_window_activity_summary();
		$site = self::factory()->blog->create();
		$id = self::factory()->user->create( array( 'role' => 'author' ) );
		remove_user_from_blog( $id, get_current_blog_id() ); add_user_to_blog( $site, $id, 'author' );
		$out = openstation_users_window_activity_summary();
		$this->assertSame( $before['total'], $out['total'] );
		$this->assertNotContains( $id, array_column( $out['registered'], 'id' ) );
	}
}
