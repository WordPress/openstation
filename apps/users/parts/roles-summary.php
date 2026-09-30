<?php
/**
 * Complete role totals and bounded member samples in one SQL statement.
 *
 * @package OpenStation
 */
defined( 'ABSPATH' ) || exit;

/**
 * Read the current site's role groups independently of directory pagination.
 *
 * One aggregate computes all counts; UNION branches bound each sample on older
 * MySQL versions too: no window functions or truncatable GROUP_CONCAT IDs.
 * Each sample rides in a derived table rather than a parenthesised UNION
 * member: SQLite (Playground, Studio, the SQLite integration plugin) rejects
 * `(SELECT … LIMIT 8) UNION ALL (…)` outright, and MySQL keeps the derived
 * table's ORDER BY + LIMIT. Only server-owned table identifiers are
 * interpolated. Every value is prepared.
 *
 * @return array|WP_Error Summary, or a permission/database error.
 */
function openstation_users_window_roles_summary() {
	global $wpdb;
	if ( ! current_user_can( 'list_users' ) ) {
		return new WP_Error( 'openstation_users_forbidden', __( 'You are not allowed to list users.', 'desktop-mode' ), array( 'status' => 403 ) );
	}
	$roles         = openstation_users_window_all_roles_map();
	$cap_key       = $wpdb->get_blog_prefix( get_current_blog_id() ) . 'capabilities';
	$member        = $wpdb->prepare( "EXISTS (SELECT 1 FROM {$wpdb->usermeta} membership WHERE membership.user_id = u.ID AND membership.meta_key = %s)", $cap_key );
	$scope         = is_multisite() ? $member : '1=1';
	$matches       = array();
	$count_matches = array();
	foreach ( array_keys( $roles ) as $role ) {
		// Match a serialized KEY, including its length, not a substring of a role.
		$pattern                = '%' . $wpdb->esc_like( 's:' . strlen( $role ) . ':"' . $role . '";' ) . '%';
		$count_matches[ $role ] = $wpdb->prepare( 'caps.meta_value LIKE %s', $pattern );
		$matches[ $role ]       = $wpdb->prepare( "EXISTS (SELECT 1 FROM {$wpdb->usermeta} caps WHERE caps.user_id = u.ID AND caps.meta_key = %s AND caps.meta_value LIKE %s)", $cap_key, $pattern );
	}
	$matches['']       = $matches ? 'NOT (' . implode( ' OR ', $matches ) . ')' : '1=1';
	$roles['']         = __( 'No role', 'desktop-mode' );
	$any_role          = $count_matches ? implode( ' OR ', $count_matches ) : '0=1';
	$count_matches[''] = '';
	$columns           = array();
	$empty_columns     = array();
	$index             = 0;
	foreach ( $count_matches as $role => $predicate ) {
		if ( '' === $role ) {
			$columns[] = "(COUNT(DISTINCT u.ID) - COUNT(DISTINCT CASE WHEN {$any_role} THEN u.ID END)) AS r{$index}";
		} else {
			$columns[] = "COUNT(DISTINCT CASE WHEN {$predicate} THEN u.ID END) AS r{$index}";
		}
		$empty_columns[] = "NULL AS r{$index}";
		++$index;
	}
	$join_key = $wpdb->prepare( '%s', $cap_key );
	// All role counts share one membership join and one aggregate scan.
	$branches = array( 'SELECT NULL AS role, COUNT(DISTINCT u.ID) AS total, NULL AS id, NULL AS name, NULL AS slug, NULL AS email, ' . implode( ', ', $columns ) . " FROM {$wpdb->users} u LEFT JOIN {$wpdb->usermeta} caps ON caps.user_id = u.ID AND caps.meta_key = {$join_key} WHERE {$scope}" );
	$sample   = 0;
	foreach ( $matches as $role => $predicate ) {
		$role_sql = $wpdb->prepare( '%s', $role );
		// Derived tables preserve SQLite portability and stop each sample at eight.
		$branches[] = "SELECT * FROM (SELECT {$role_sql} AS role, NULL AS total, u.ID AS id, u.display_name AS name, u.user_nicename AS slug, u.user_email AS email, " . implode( ', ', $empty_columns ) . " FROM {$wpdb->users} u WHERE {$scope} AND {$predicate} ORDER BY u.display_name, u.ID LIMIT 8) AS sample_{$sample}";
		++$sample;
	}
	$sql = implode( ' UNION ALL ', $branches );
	// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- All values are prepared above; identifiers are trusted wpdb table names.
	$rows = $wpdb->get_results( $sql, ARRAY_A );
	if ( null === $rows || $wpdb->last_error ) {
		return new WP_Error( 'openstation_users_roles_failed', __( 'Role groups could not be loaded. Please try again.', 'desktop-mode' ), array( 'status' => 500 ) );
	}
	$groups = array();
	foreach ( $roles as $role => $label ) {
		$groups[ $role ] = array(
			'role'    => $role,
			'label'   => $label,
			'total'   => 0,
			'members' => array(),
		);
	}
	$total = 0;
	foreach ( $rows as $row ) {
		if ( null === $row['role'] ) {
			$total = (int) $row['total'];
			foreach ( array_keys( $roles ) as $index => $role ) {
				$groups[ $role ]['total'] = (int) $row[ 'r' . $index ];
			}
		} elseif ( null !== $row['total'] ) {
			$groups[ $row['role'] ]['total'] = (int) $row['total'];
		} else {
			$groups[ $row['role'] ]['members'][] = array(
				'id'          => (int) $row['id'],
				'name'        => openstation_plain_text_title( $row['name'] ),
				'slug'        => $row['slug'],
				'roles'       => $row['role'] ? array( $row['role'] ) : array(),
				'avatar_urls' => array( '48' => get_avatar_url( $row['email'], array( 'size' => 48 ) ) ),
			);
		}
	}
	// Empty registered roles are useful; the synthetic No role group only appears when needed.
	if ( 0 === $groups['']['total'] ) {
		unset( $groups[''] );
	}
	$groups = array_values( $groups );
	usort(
		$groups,
		static function ( $a, $b ) {
			$by_count = $b['total'] <=> $a['total'];
			return 0 !== $by_count ? $by_count : strcmp( $a['role'], $b['role'] );
		}
	);
	/**
	 * Filter the complete current-site role summary shown by the Users app.
	 *
	 * @param array $summary Total unique users and role groups with up to eight members each.
	 */
	return apply_filters(
		'openstation_users_window_roles_summary',
		array(
			'total'  => $total,
			'groups' => $groups,
		)
	);
}

/** Register the authenticated, read-only role summary. */
function openstation_users_window_register_roles_summary_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/users/roles-summary',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => static function () {
				return current_user_can( 'list_users' ); },
			'callback'            => 'openstation_users_window_roles_summary',
		)
	);
}
add_action( 'rest_api_init', 'openstation_users_window_register_roles_summary_route' );
