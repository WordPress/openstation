<?php

class Tests_OpenStation_UsersRolesSummary extends WP_UnitTestCase {
	public function set_up() {
		parent::set_up();
		$admin = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $admin );
		if ( is_multisite() ) {
			grant_super_admin( $admin );
		}
		add_role( 'summary_alpha', 'Alpha', array( 'read' => true ) );
		add_role( 'summary_beta', 'Beta', array( 'read' => true ) );
	}
	public function tear_down() {
		remove_role( 'summary_alpha' );
		remove_role( 'summary_beta' );
		parent::tear_down();
	}
	private function groups( $summary ) {
		$this->assertNotWPError( $summary );
		return array_column( $summary['groups'], null, 'role' );
	}

	public function test_complete_counts_bounded_samples_and_one_aggregate_query() {
		$before = openstation_users_window_roles_summary()['total'];
		$ids = self::factory()->user->create_many( 13, array( 'role' => 'summary_alpha' ) );
		$user = get_userdata( $ids[0] );
		$user->add_role( 'summary_beta' );

		global $wpdb;
		$key = $wpdb->get_blog_prefix() . 'capabilities';
		add_user_meta( $ids[0], $key, get_user_meta( $ids[0], $key, true ) );
		$queries = array();
		$observe = static function ( $sql ) use ( &$queries ) {
			if ( false !== strpos( $sql, 'UNION ALL' ) ) { $queries[] = $sql; }
			return $sql;
		};
		add_filter( 'query', $observe );
		$summary = openstation_users_window_roles_summary();
		remove_filter( 'query', $observe );
		$groups = $this->groups( $summary );
		$this->assertCount( 1, $queries );
		$this->assertSame( count( openstation_users_window_all_roles_map() ) + 2, substr_count( $queries[0], "FROM {$wpdb->users} u" ), 'One shared count scan plus one bounded scan per role, including No role.' );

		$this->assertSame( substr_count( $queries[0], 'UNION ALL' ), preg_match_all( '/UNION ALL\s+SELECT\b/', $queries[0] ) );
		$this->assertStringNotContainsString( ') UNION ALL (', $queries[0] );
		$this->assertSame( $before + 13, $summary['total'] );
		$this->assertSame( 13, $groups['summary_alpha']['total'] );
		$this->assertCount( 8, $groups['summary_alpha']['members'] );
		$this->assertCount( 8, array_unique( array_column( $groups['summary_alpha']['members'], 'id' ) ) );
		$this->assertSame( 1, $groups['summary_beta']['total'] );
		foreach ( $groups as $group ) {
			$this->assertLessThanOrEqual( 8, count( $group['members'] ) );
			foreach ( $group['members'] as $member ) {
				$this->assertArrayNotHasKey( 'email', $member );
				$this->assertArrayNotHasKey( 'user_pass', $member );
			}
		}
	}

	public function test_empty_roles_and_users_without_registered_roles() {
		$id = self::factory()->user->create( array( 'role' => '' ) );
		if ( is_multisite() ) {
			update_user_meta( $id, $GLOBALS['wpdb']->get_blog_prefix() . 'capabilities', array( 'custom_cap' => true ) );
		}
		$groups = $this->groups( openstation_users_window_roles_summary() );
		$this->assertSame( 0, $groups['summary_alpha']['total'] );
		$this->assertSame( array(), $groups['summary_alpha']['members'] );
		$this->assertContains( $id, array_column( $groups['']['members'], 'id' ) );
	}

	public function test_role_sql_metacharacters_and_like_wildcards_are_literal() {
		$role = 'summary_%_\' OR 1=1 --';
		add_role( $role, 'Unusual role', array( 'read' => true ) );
		$lookalike = str_replace( array( '%', '_' ), array( 'x', 'y' ), $role );
		add_role( $lookalike, 'Lookalike', array( 'read' => true ) );
		try {
			$id = self::factory()->user->create( array( 'role' => $role ) );
			self::factory()->user->create( array( 'role' => $lookalike ) );
			self::factory()->user->create( array( 'role' => 'summary_alpha' ) );
			$groups = $this->groups( openstation_users_window_roles_summary() );
			$this->assertSame( 1, $groups[$role]['total'] );
			$this->assertSame( array( $id ), array_column( $groups[$role]['members'], 'id' ) );
		} finally { remove_role( $role ); remove_role( $lookalike ); }
	}

	public function test_route_and_direct_function_require_list_users() {
		foreach ( array( 0, self::factory()->user->create( array( 'role' => 'subscriber' ) ) ) as $id ) {
			wp_set_current_user( $id );
			$this->assertWPError( openstation_users_window_roles_summary() );
			$response = rest_get_server()->dispatch( new WP_REST_Request( 'GET', '/desktop-mode/v1/users/roles-summary' ) );
			$this->assertContains( $response->get_status(), array( 401, 403 ) );
		}
	}

	public function test_other_site_members_never_enter_this_summary() {
		if ( ! is_multisite() ) { $this->markTestSkipped( 'Multisite only.' ); }
		$site = self::factory()->blog->create();
		$id = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		remove_user_from_blog( $id, get_current_blog_id() );
		add_user_to_blog( $site, $id, 'subscriber' );
		$summary = openstation_users_window_roles_summary();
		foreach ( $summary['groups'] as $group ) {
			$this->assertNotContains( $id, array_column( $group['members'], 'id' ) );
		}
	}

	public function test_summary_hook_receives_complete_groups() {
		$called = false;
		$filter = static function ( $summary ) use ( &$called ) { $called = isset( $summary['total'], $summary['groups'] ); return $summary; };
		add_filter( 'openstation_users_window_roles_summary', $filter );
		openstation_users_window_roles_summary();
		remove_filter( 'openstation_users_window_roles_summary', $filter );
		$this->assertTrue( $called );
	}
}
