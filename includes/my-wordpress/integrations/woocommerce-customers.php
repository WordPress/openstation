<?php
/**
 * OpenStation — My WordPress: WooCommerce **Customers**.
 *
 * WooCommerce ships two views of the people who buy from a store, and
 * neither is a place you can work from: `users.php` is a role list that
 * knows nothing about money, and Analytics → Customers is a report you
 * read and then leave. Neither one opens next to the order it explains.
 *
 * This file adds a **Customers** section to the Woo folder in the site
 * window. It renders through the existing `user` entity kind — avatar
 * tiles, the dossier preview, the drag-out seam, the footprint route —
 * so a customer is a first-class object on the desktop: drag one onto
 * the wallpaper, open their orders beside their profile, tie the
 * windows together with the relations layer.
 *
 * What makes it a *customer* list rather than a user list is the
 * `openstation_woo_customer` payload on every row: lifetime spend,
 * order count, average order value, first and last order, days since
 * the last one, and the band that summarises all of it.
 *
 * ## Bands
 *
 * Ordered so the two bands a merchant can *act on* come first:
 *
 *   1. **VIP**    — spend at or above the VIP threshold (three times
 *                   the store's average order value by default). Who
 *                   to look after.
 *   2. **Lapsed** — has ordered, but not within the lapse window (180
 *                   days by default). Who to win back.
 *   3. **Repeat** — two or more orders, still active.
 *   4. **New**    — exactly one order.
 *   5. **No orders** — registered, never bought.
 *
 * ## Who appears
 *
 * Every user who has placed a paid order, plus every user holding the
 * `customer` role. Guests (orders with no account) have no user to
 * render — their revenue is reported as a single line on the Woo
 * folder's Store panel instead of being silently dropped.
 *
 * ## Cost
 *
 * One grouped query over the order store gives every customer's
 * aggregate at once — order count, spend, first and last order date —
 * cached for five minutes and flushed whenever an order changes. The
 * band ordering, the per-row facts and the folder counts all read that
 * one map, so a page of customers costs no per-row order queries at
 * all. Stores past `OPENSTATION_WOO_MAX_ORDERED_CUSTOMERS` users skip
 * the band ordering and fall back to newest-first, exactly like the
 * catalogue does past its own cap.
 *
 * REST surface (read-only, gated on `list_users` + order access):
 *
 *   GET desktop-mode/v1/woocommerce/customers
 *   GET desktop-mode/v1/woocommerce/customers/<id>
 *   GET desktop-mode/v1/woocommerce/summary/customer/<id>
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Above this many candidate customers the section stops band-ordering
 * and falls back to newest-registered-first. The ordering plan holds
 * one id per customer in a transient; the cap is what keeps that
 * option from growing without bound on a store with a large user base.
 */
const OPENSTATION_WOO_MAX_ORDERED_CUSTOMERS = 5000;

/**
 * Days without an order after which a customer counts as lapsed.
 * Filterable through `openstation_my_wordpress_woo_customer_lapse_days`.
 */
const OPENSTATION_WOO_CUSTOMER_LAPSE_DAYS = 180;

/*
-------------------------------------------------------------------
 * Aggregates
 * ----------------------------------------------------------------
 */

/**
 * Order statuses that count as money actually taken.
 *
 * Mirrors `wc_get_customer_total_spent()`, so the lifetime spend on a
 * tile agrees with the number WooCommerce itself would report.
 *
 * @return string[] Statuses WITH the `wc-` prefix.
 */
function openstation_my_wordpress_woo_paid_statuses() {
	$statuses = function_exists( 'wc_get_is_paid_statuses' )
		? (array) wc_get_is_paid_statuses()
		: array( 'processing', 'completed' );

	return array_values(
		array_map(
			static function ( $status ) {
				return 0 === strpos( (string) $status, 'wc-' ) ? (string) $status : 'wc-' . $status;
			},
			$statuses
		)
	);
}

/**
 * Whether the store keeps orders in WooCommerce's own tables (HPOS)
 * rather than in `wp_posts`.
 *
 * @return bool
 */
function openstation_my_wordpress_woo_hpos_enabled() {
	return class_exists( '\Automattic\WooCommerce\Utilities\OrderUtil' )
		&& \Automattic\WooCommerce\Utilities\OrderUtil::custom_orders_table_usage_is_enabled();
}

/**
 * Every customer's order aggregate, in one query.
 *
 * The whole section — band definitions, band ordering, per-row facts,
 * folder counts — reads this one map. Doing it per user would be one
 * or two queries per tile, and the band ordering would need the whole
 * user base walked before the first tile could paint.
 *
 * Guest orders (no account) are aggregated under the `0` key. They can
 * never appear as a tile — there is no user to render — but their
 * revenue is real and the Store panel reports it rather than letting
 * it vanish.
 *
 * @return array<int, array{orders:int, spend:float, first:string, last:string}>
 *         Keyed by user id; `0` holds the guest aggregate.
 */
function openstation_my_wordpress_woo_customer_spend_map() {
	static $memo = null;
	if ( null !== $memo ) {
		return $memo;
	}

	$cached = get_transient( 'desktop_mode_woo_customer_spend' );
	if ( is_array( $cached ) ) {
		$memo = $cached;
		return $memo;
	}

	global $wpdb;

	$statuses     = openstation_my_wordpress_woo_paid_statuses();
	$placeholders = implode( ', ', array_fill( 0, count( $statuses ), '%s' ) );

	if ( openstation_my_wordpress_woo_hpos_enabled() ) {
		$table = $wpdb->prefix . 'wc_orders';
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name and the placeholder list are structural; every value is prepared.
		$sql = $wpdb->prepare(
			"SELECT customer_id AS uid,
				COUNT(*) AS orders,
				SUM(total_amount) AS spend,
				MIN(date_created_gmt) AS first_order,
				MAX(date_created_gmt) AS last_order
			FROM {$table}
			WHERE type = 'shop_order' AND status IN ( {$placeholders} )
			GROUP BY customer_id",
			$statuses
		);
	} else {
		// Legacy storage: `_customer_user` is the account id (0 for a
		// guest) and `_order_total` the gross. `+0` casts the meta
		// strings so SUM/comparison behave numerically.
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- ditto.
		$sql = $wpdb->prepare(
			"SELECT cu.meta_value + 0 AS uid,
				COUNT(*) AS orders,
				SUM( tot.meta_value + 0 ) AS spend,
				MIN(p.post_date_gmt) AS first_order,
				MAX(p.post_date_gmt) AS last_order
			FROM {$wpdb->posts} p
			INNER JOIN {$wpdb->postmeta} cu ON cu.post_id = p.ID AND cu.meta_key = '_customer_user'
			LEFT JOIN {$wpdb->postmeta} tot ON tot.post_id = p.ID AND tot.meta_key = '_order_total'
			WHERE p.post_type = 'shop_order' AND p.post_status IN ( {$placeholders} )
			GROUP BY cu.meta_value",
			$statuses
		);
	}

	// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.NotPrepared -- one grouped aggregate with no core API equivalent; $sql came out of $wpdb->prepare() above, and the result is cached in the transient below.
	$rows = $wpdb->get_results( $sql );

	$map = array();
	foreach ( (array) $rows as $row ) {
		$uid = (int) $row->uid;
		if ( $uid < 0 ) {
			continue;
		}
		$map[ $uid ] = array(
			'orders' => (int) $row->orders,
			'spend'  => (float) $row->spend,
			'first'  => (string) $row->first_order,
			'last'   => (string) $row->last_order,
		);
	}

	/**
	 * Filter the per-customer order aggregate the Customers section
	 * is built from.
	 *
	 * Keyed by user id (`0` is the guest aggregate); each value is
	 * `array( 'orders' => int, 'spend' => float, 'first' => gmt
	 * datetime, 'last' => gmt datetime )`. A store that keeps order
	 * money somewhere else — a subscriptions plugin, a marketplace
	 * split — can rewrite the whole map here and every band, tile and
	 * panel follows.
	 *
	 * **Status: Experimental**
	 *
	 * @param array $map Aggregate keyed by user id.
	 */
	$map = (array) apply_filters( 'openstation_my_wordpress_woo_customer_spend_map', $map );

	set_transient( 'desktop_mode_woo_customer_spend', $map, 5 * MINUTE_IN_SECONDS );
	$memo = $map;

	return $memo;
}

/**
 * The store's average order value across every paid order.
 *
 * Includes guests: a threshold derived only from account holders would
 * sit wherever the checkout-registration rate happened to put it.
 *
 * @return float
 */
function openstation_my_wordpress_woo_store_aov() {
	$orders = 0;
	$spend  = 0.0;
	foreach ( openstation_my_wordpress_woo_customer_spend_map() as $stats ) {
		$orders += (int) $stats['orders'];
		$spend  += (float) $stats['spend'];
	}

	return $orders > 0 ? $spend / $orders : 0.0;
}

/**
 * Lifetime spend at or above which a customer is a VIP.
 *
 * Derived rather than fixed: "spent over 500" means nothing without
 * knowing whether the store sells postcards or pianos. Three average
 * orders is the default — enough to be deliberate repeat custom on any
 * store, cheap to compute, and one filter away from a merchant's own
 * number.
 *
 * @return float Threshold, or `0.0` when the store has no paid orders
 *               yet (in which case nothing can qualify).
 */
function openstation_my_wordpress_woo_vip_threshold() {
	$aov = openstation_my_wordpress_woo_store_aov();

	/**
	 * Filter the lifetime-spend threshold for the VIP band.
	 *
	 * **Status: Experimental**
	 *
	 * @param float $threshold Threshold in store currency.
	 * @param float $aov       The store's average order value.
	 */
	return (float) apply_filters(
		'openstation_my_wordpress_woo_vip_threshold',
		$aov * 3,
		$aov
	);
}

/**
 * Days without an order after which a customer counts as lapsed.
 *
 * @return int
 */
function openstation_my_wordpress_woo_customer_lapse_days() {
	/**
	 * Filter the lapse window for the Customers section.
	 *
	 * **Status: Experimental**
	 *
	 * @param int $days Days since the last order.
	 */
	$days = (int) apply_filters(
		'openstation_my_wordpress_woo_customer_lapse_days',
		OPENSTATION_WOO_CUSTOMER_LAPSE_DAYS
	);

	return max( 1, $days );
}

/*
-------------------------------------------------------------------
 * Bands
 * ----------------------------------------------------------------
 */

/**
 * Band definitions for the Customers section, in display order.
 *
 * VIP and Lapsed lead because they are the two the merchant can do
 * something about — one to look after, one to win back. Everything
 * else is context, and "No orders" trails because a registered
 * account that never bought is the least urgent row on the screen.
 *
 * @return array[] Each entry: `id`, `label`, `order`, optional `tone`.
 */
function openstation_my_wordpress_woo_customer_band_defs() {
	$bands = array(
		array(
			'id'    => 'vip',
			'label' => __( 'VIP', 'desktop-mode' ),
			'order' => 10,
			'tone'  => 'success',
		),
		array(
			'id'    => 'lapsed',
			'label' => __( 'Lapsed', 'desktop-mode' ),
			'order' => 20,
			'tone'  => 'warn',
		),
		array(
			'id'    => 'repeat',
			'label' => __( 'Repeat', 'desktop-mode' ),
			'order' => 30,
		),
		array(
			'id'    => 'new',
			'label' => __( 'New', 'desktop-mode' ),
			'order' => 40,
		),
		array(
			'id'    => 'none',
			'label' => __( 'No orders yet', 'desktop-mode' ),
			'order' => 50,
		),
	);

	/**
	 * Filter the band definitions for the Customers section.
	 *
	 * Changing a band's membership rule means filtering
	 * `openstation_my_wordpress_woo_customer_band` as well — this
	 * filter only decides what the bands are called and in which
	 * order they render.
	 *
	 * **Status: Experimental**
	 *
	 * @param array[] $bands Band descriptors.
	 */
	return (array) apply_filters( 'openstation_my_wordpress_woo_customer_bands', $bands );
}

/**
 * Which band a customer's aggregate puts them in.
 *
 * @param array $stats Aggregate row: `orders`, `spend`, `last`.
 * @return string Band id.
 */
function openstation_my_wordpress_woo_customer_band_id( $stats ) {
	$orders = (int) ( $stats['orders'] ?? 0 );
	$spend  = (float) ( $stats['spend'] ?? 0 );
	$last   = (string) ( $stats['last'] ?? '' );

	$band = 'none';
	if ( $orders > 0 ) {
		$threshold = openstation_my_wordpress_woo_vip_threshold();
		$lapsed    = openstation_my_wordpress_woo_customer_days_since( $last );

		if ( $threshold > 0 && $spend >= $threshold ) {
			// VIP outranks lapsed on purpose: a big spender who has
			// gone quiet is still the row you want at the top of the
			// screen, and the days-since line in the pane says the
			// rest.
			$band = 'vip';
		} elseif ( null !== $lapsed && $lapsed > openstation_my_wordpress_woo_customer_lapse_days() ) {
			$band = 'lapsed';
		} elseif ( $orders > 1 ) {
			$band = 'repeat';
		} else {
			$band = 'new';
		}
	}

	/**
	 * Filter the band a customer lands in.
	 *
	 * **Status: Experimental**
	 *
	 * @param string $band  Band id.
	 * @param array  $stats The customer's order aggregate.
	 */
	return (string) apply_filters( 'openstation_my_wordpress_woo_customer_band', $band, $stats );
}

/**
 * Whole days between a GMT datetime and now, or `null` when the input
 * isn't a usable date.
 *
 * @param string $gmt_datetime `Y-m-d H:i:s` in GMT.
 * @return int|null
 */
function openstation_my_wordpress_woo_customer_days_since( $gmt_datetime ) {
	if ( '' === (string) $gmt_datetime ) {
		return null;
	}
	$stamp = strtotime( $gmt_datetime . ' GMT' );
	if ( ! $stamp ) {
		return null;
	}

	return (int) floor( ( time() - $stamp ) / DAY_IN_SECONDS );
}

/**
 * Band definitions with an exact row count each, for the client.
 *
 * @return array[]
 */
function openstation_my_wordpress_woo_customer_bands_with_counts() {
	$plan   = openstation_my_wordpress_woo_customer_plan();
	$counts = (array) ( $plan['counts'] ?? array() );

	$bands = array();
	foreach ( openstation_my_wordpress_woo_customer_band_defs() as $band ) {
		$band['count'] = (int) ( $counts[ $band['id'] ] ?? 0 );
		$bands[]       = $band;
	}

	return $bands;
}

/*
-------------------------------------------------------------------
 * The ordering plan
 * ----------------------------------------------------------------
 */

/**
 * Candidate customer ids — everyone who has paid for something, plus
 * everyone holding the `customer` role.
 *
 * The union matters in both directions: a shop manager who buys from
 * their own store is a customer, and a checkout-registered account
 * that hasn't ordered yet is a customer the merchant would want to
 * see. Neither query alone finds both.
 *
 * @return int[] User ids, unordered.
 */
function openstation_my_wordpress_woo_customer_candidate_ids() {
	$ids = array();
	foreach ( openstation_my_wordpress_woo_customer_spend_map() as $user_id => $stats ) {
		$user_id = (int) $user_id;
		if ( $user_id > 0 ) {
			$ids[ $user_id ] = true;
		}
	}

	$role_users = get_users(
		array(
			'role'    => 'customer',
			'fields'  => 'ID',
			'number'  => OPENSTATION_WOO_MAX_ORDERED_CUSTOMERS + 1,
			'orderby' => 'registered',
			'order'   => 'DESC',
		)
	);
	foreach ( (array) $role_users as $user_id ) {
		$ids[ (int) $user_id ] = true;
	}

	/**
	 * Filter the set of users the Customers section considers.
	 *
	 * **Status: Experimental**
	 *
	 * @param int[] $ids Candidate user ids.
	 */
	return array_values(
		array_map( 'intval', array_keys( (array) apply_filters( 'openstation_my_wordpress_woo_customer_ids', $ids ) ) )
	);
}

/**
 * The band-ordered customer id list plus an exact count per band.
 *
 * Same contract as the catalogue's plan, and for the same reason:
 * bands only stop reshuffling if rows *arrive* in band order. A band
 * that fills late expands above whatever the user is already reading.
 *
 * Cached for five minutes and flushed on any order change.
 *
 * @return array{ids:int[], counts:array<string,int>, capped:bool, customers:int}
 */
function openstation_my_wordpress_woo_customer_plan() {
	static $memo = null;
	if ( null !== $memo ) {
		return $memo;
	}

	$cached = get_transient( 'desktop_mode_woo_customer_plan' );
	if ( is_array( $cached ) && isset( $cached['ids'], $cached['counts'] ) ) {
		$memo = $cached;
		return $memo;
	}

	$candidates = openstation_my_wordpress_woo_customer_candidate_ids();
	$total      = count( $candidates );

	if ( $total > OPENSTATION_WOO_MAX_ORDERED_CUSTOMERS ) {
		$memo = array(
			'ids'       => array(),
			'counts'    => array(),
			'capped'    => true,
			'customers' => $total,
		);
		set_transient( 'desktop_mode_woo_customer_plan', $memo, 5 * MINUTE_IN_SECONDS );
		return $memo;
	}

	$map     = openstation_my_wordpress_woo_customer_spend_map();
	$buckets = array();
	$counts  = array();
	foreach ( openstation_my_wordpress_woo_customer_band_defs() as $band ) {
		$buckets[ $band['id'] ] = array();
		$counts[ $band['id'] ]  = 0;
	}

	foreach ( $candidates as $user_id ) {
		$stats = $map[ $user_id ] ?? array(
			'orders' => 0,
			'spend'  => 0.0,
			'first'  => '',
			'last'   => '',
		);
		$band  = openstation_my_wordpress_woo_customer_band_id( $stats );
		if ( ! isset( $buckets[ $band ] ) ) {
			// A filter invented a band the definitions don't declare.
			// Park it under "no orders" rather than dropping the row:
			// a customer missing from the list is a worse outcome than
			// one in an unexpected group.
			$band = 'none';
			if ( ! isset( $buckets[ $band ] ) ) {
				continue;
			}
		}
		// Highest spend first inside every band — the ordering the
		// merchant would apply by hand.
		$buckets[ $band ][] = array(
			'id'    => $user_id,
			'spend' => (float) $stats['spend'],
		);
		++$counts[ $band ];
	}

	$ordered = array();
	foreach ( $buckets as $rows ) {
		usort(
			$rows,
			static function ( $a, $b ) {
				if ( $a['spend'] === $b['spend'] ) {
					return $a['id'] <=> $b['id'];
				}
				return $b['spend'] <=> $a['spend'];
			}
		);
		foreach ( $rows as $row ) {
			$ordered[] = (int) $row['id'];
		}
	}

	$memo = array(
		'ids'       => $ordered,
		'counts'    => $counts,
		'capped'    => false,
		'customers' => $total,
	);
	set_transient( 'desktop_mode_woo_customer_plan', $memo, 5 * MINUTE_IN_SECONDS );

	return $memo;
}

/**
 * A readable summary of whether the Customers list is band-ordered,
 * for diagnosing a section whose bands look wrong. Mirrors the
 * catalogue's `ordering` blob.
 *
 * @return array{mode:string, customers:int, ordered:int, limit:int}
 */
function openstation_my_wordpress_woo_customer_ordering_state() {
	$plan = openstation_my_wordpress_woo_customer_plan();

	return array(
		'mode'      => ! empty( $plan['capped'] ) ? 'capped' : 'ordered',
		'customers' => (int) ( $plan['customers'] ?? 0 ),
		'ordered'   => count( (array) ( $plan['ids'] ?? array() ) ),
		'limit'     => OPENSTATION_WOO_MAX_ORDERED_CUSTOMERS,
	);
}

/**
 * Drop the cached aggregate and plan when an order changes, so a
 * first-time buyer moves out of "No orders yet" on the next load
 * rather than five minutes later.
 *
 * @return void
 */
function openstation_my_wordpress_woo_flush_customer_caches() {
	delete_transient( 'desktop_mode_woo_customer_spend' );
	delete_transient( 'desktop_mode_woo_customer_plan' );
}
add_action( 'woocommerce_new_order', 'openstation_my_wordpress_woo_flush_customer_caches' );
add_action( 'woocommerce_update_order', 'openstation_my_wordpress_woo_flush_customer_caches' );
add_action( 'woocommerce_order_status_changed', 'openstation_my_wordpress_woo_flush_customer_caches' );
add_action( 'woocommerce_delete_order', 'openstation_my_wordpress_woo_flush_customer_caches' );
add_action( 'woocommerce_trash_order', 'openstation_my_wordpress_woo_flush_customer_caches' );

/*
-------------------------------------------------------------------
 * Per-customer facts
 * ----------------------------------------------------------------
 */

/**
 * The `openstation_woo_customer` payload for one user — everything a
 * tile, a band, and the compact pane row need, and nothing that costs
 * an extra query.
 *
 * Every field here is read from the cached aggregate. The deeper
 * facts (last order number, favourite product, billing address) live
 * in the customer *summary* below, which only runs for the one row
 * actually selected.
 *
 * @param int $user_id User id.
 * @return array
 */
function openstation_my_wordpress_woo_customer_facts( $user_id ) {
	$user_id = (int) $user_id;
	$map     = openstation_my_wordpress_woo_customer_spend_map();
	$stats   = $map[ $user_id ] ?? array(
		'orders' => 0,
		'spend'  => 0.0,
		'first'  => '',
		'last'   => '',
	);

	$orders = (int) $stats['orders'];
	$spend  = (float) $stats['spend'];
	$days   = openstation_my_wordpress_woo_customer_days_since( $stats['last'] );

	$facts = array(
		'band'       => openstation_my_wordpress_woo_customer_band_id( $stats ),
		'orders'     => $orders,
		'spend'      => openstation_my_wordpress_woo_price( $spend ),
		// Raw alongside the formatted string: the client sorts and
		// compares on this, and no locale can break a float.
		'spendRaw'   => round( $spend, 2 ),
		'aov'        => $orders > 0 ? openstation_my_wordpress_woo_price( $spend / $orders ) : '',
		'firstOrder' => '' !== $stats['first'] ? mysql2date( 'c', $stats['first'], false ) : '',
		'lastOrder'  => '' !== $stats['last'] ? mysql2date( 'c', $stats['last'], false ) : '',
		'daysSince'  => $days,
		// The list screen filtered to this person. On the row rather
		// than only in the summary so the tile's context menu can open
		// it without first fetching a panel the user never asked for.
		'ordersUrl'  => $orders > 0 ? openstation_my_wordpress_woo_customer_orders_url( $user_id ) : '',
	);

	/**
	 * Filter the compact customer facts carried on every row of the
	 * Customers section (and on `/wp/v2/users` rows).
	 *
	 * **Status: Experimental**
	 *
	 * @param array $facts   Fact payload.
	 * @param int   $user_id The customer.
	 */
	return (array) apply_filters( 'openstation_my_wordpress_woo_customer_facts', $facts, $user_id );
}

/**
 * Register `openstation_woo_customer` on the core `user` resource.
 *
 * Deliberately not limited to our own collection: it means the
 * built-in Users section, and any plugin reading `/wp/v2/users`, gets
 * lifetime spend for free. The field is gated the same way the rest of
 * the section is — a viewer who can't see orders sees no money.
 *
 * @return void
 */
function openstation_my_wordpress_woo_register_customer_field() {
	if ( ! openstation_my_wordpress_woo_active() ) {
		return;
	}

	register_rest_field(
		'user',
		'openstation_woo_customer',
		array(
			'get_callback' => static function ( $user ) {
				if ( true !== openstation_my_wordpress_woo_customers_permission() ) {
					return null;
				}
				$id = isset( $user['id'] ) ? (int) $user['id'] : 0;
				return $id > 0 ? openstation_my_wordpress_woo_customer_facts( $id ) : null;
			},
			'schema'       => array(
				'description' => __( 'WooCommerce lifetime facts for this customer.', 'desktop-mode' ),
				'type'        => array( 'object', 'null' ),
				'context'     => array( 'view', 'edit', 'embed' ),
			),
		)
	);
}
add_action( 'rest_api_init', 'openstation_my_wordpress_woo_register_customer_field' );

/*
-------------------------------------------------------------------
 * REST
 * ----------------------------------------------------------------
 */

/**
 * Whether the current user may see customer money.
 *
 * Two gates, both required: order access (the data *is* order data)
 * and `list_users` (the rows are people). An editor who can moderate
 * comments has neither.
 *
 * @return true|WP_Error
 */
function openstation_my_wordpress_woo_customers_permission() {
	$orders = openstation_my_wordpress_woo_orders_permission();
	if ( is_wp_error( $orders ) ) {
		return $orders;
	}

	if ( ! current_user_can( 'list_users' ) ) {
		return new WP_Error(
			'openstation_woo_forbidden',
			__( 'Sorry, you are not allowed to view customers.', 'desktop-mode' ),
			array( 'status' => rest_authorization_required_code() )
		);
	}

	return true;
}

/**
 * Shape a user as the row the site window's `user` entity kind reads —
 * the same field set `/wp/v2/users` returns, plus our two payloads.
 *
 * @param WP_User $user User.
 * @return array
 */
function openstation_my_wordpress_woo_customer_row( $user ) {
	$avatars = array();
	foreach ( rest_get_avatar_sizes() as $size ) {
		$avatars[ (string) $size ] = get_avatar_url( $user->ID, array( 'size' => $size ) );
	}

	return array(
		'id'                       => (int) $user->ID,
		'name'                     => $user->display_name,
		'slug'                     => $user->user_nicename,
		'description'              => (string) get_user_meta( $user->ID, 'description', true ),
		'link'                     => (string) get_author_posts_url( $user->ID ),
		'avatar_urls'              => $avatars,
		'openstation_summary'      => function_exists( 'openstation_my_wordpress_user_summary_payload' )
			? openstation_my_wordpress_user_summary_payload( $user->ID )
			: array(),
		'openstation_woo_customer' => openstation_my_wordpress_woo_customer_facts( $user->ID ),
	);
}

/**
 * `GET /woocommerce/customers` — paginated, user-shaped customer list.
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response
 */
function openstation_my_wordpress_woo_customers( $request ) {
	$per_page = max( 1, min( 100, (int) ( $request['per_page'] ?? 24 ) ) );
	$page     = max( 1, (int) ( $request['page'] ?? 1 ) );
	$search   = trim( (string) ( $request['search'] ?? '' ) );

	$plan   = openstation_my_wordpress_woo_customer_plan();
	$capped = ! empty( $plan['capped'] );

	$args = array(
		'number' => $per_page,
		'paged'  => $page,
		'fields' => 'all',
	);

	if ( $capped ) {
		// Past the cap the plan holds no ids, so hand the ordering
		// back to the database: newest accounts first, which is the
		// only useful order left once bands are off.
		$args['role']    = 'customer';
		$args['orderby'] = 'registered';
		$args['order']   = 'DESC';
	} else {
		$ids = (array) $plan['ids'];
		if ( empty( $ids ) ) {
			$response = rest_ensure_response( array() );
			$response->header( 'X-WP-Total', '0' );
			$response->header( 'X-WP-TotalPages', '1' );
			return $response;
		}
		$args['include'] = $ids;
		// `include` + `orderby => include` replays the plan's order
		// verbatim, the same trick the catalogue uses with `post__in`.
		$args['orderby'] = 'include';
	}

	if ( '' !== $search ) {
		$args['search']         = '*' . $search . '*';
		$args['search_columns'] = array( 'user_login', 'user_email', 'user_nicename', 'display_name' );
		// A search is a different question from "show me the roster",
		// and the plan's order would hide matches below the fold.
		// Ordering falls back to relevance-free display name, which is
		// at least stable.
		if ( ! $capped ) {
			$args['orderby'] = 'display_name';
			$args['order']   = 'ASC';
		}
	}

	/**
	 * Filter the `WP_User_Query` args for the Customers section.
	 *
	 * `number` and `paged` are set by the paginator and will be
	 * overwritten.
	 *
	 * **Status: Experimental**
	 *
	 * @param array           $args    Query args.
	 * @param WP_REST_Request $request The request.
	 */
	$args = (array) apply_filters( 'openstation_my_wordpress_woo_customer_query_args', $args, $request );

	$query = new WP_User_Query( $args );
	$total = (int) $query->get_total();
	$pages = $per_page > 0 ? (int) ceil( $total / $per_page ) : 1;

	$rows = array();
	foreach ( (array) $query->get_results() as $user ) {
		if ( $user instanceof WP_User ) {
			$rows[] = openstation_my_wordpress_woo_customer_row( $user );
		}
	}

	$response = rest_ensure_response( $rows );
	$response->header( 'X-WP-Total', (string) $total );
	$response->header( 'X-WP-TotalPages', (string) max( 1, $pages ) );
	// Same diagnostic contract the Orders route carries: an empty
	// folder with a confident count should be answerable from the
	// network tab, not guessed at.
	$response->header( 'X-Desktop-Mode-Woo-Customers-Mode', $capped ? 'capped' : 'ordered' );

	return $response;
}

/**
 * `GET /woocommerce/customers/<id>` — one user-shaped customer.
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function openstation_my_wordpress_woo_customer( $request ) {
	$user = get_userdata( (int) $request['id'] );
	if ( ! $user instanceof WP_User ) {
		return new WP_Error(
			'openstation_woo_no_customer',
			__( 'Customer not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	return rest_ensure_response( openstation_my_wordpress_woo_customer_row( $user ) );
}

/*
-------------------------------------------------------------------
 * The customer summary — the right pane
 * ----------------------------------------------------------------
 */

/**
 * The customer's most-bought product, resolved from their recent
 * orders.
 *
 * Bounded to the last 50 orders: this runs once per selection, and a
 * decade of order history would turn a preview pane into a page load.
 *
 * @param int $user_id User id.
 * @return array{label:string, editUrl:string, quantity:int}|null
 */
function openstation_my_wordpress_woo_customer_favourite( $user_id ) {
	$orders = wc_get_orders(
		array(
			'customer_id' => (int) $user_id,
			'limit'       => 50,
			'status'      => openstation_my_wordpress_woo_paid_statuses(),
			'orderby'     => 'date',
			'order'       => 'DESC',
			'return'      => 'objects',
		)
	);

	$tally = array();
	foreach ( (array) $orders as $maybe_order ) {
		$order = is_scalar( $maybe_order ) ? wc_get_order( (int) $maybe_order ) : $maybe_order;
		if ( ! $order instanceof WC_Abstract_Order ) {
			continue;
		}
		foreach ( $order->get_items() as $item ) {
			$product_id = method_exists( $item, 'get_product_id' ) ? (int) $item->get_product_id() : 0;
			if ( $product_id <= 0 ) {
				continue;
			}
			if ( ! isset( $tally[ $product_id ] ) ) {
				$tally[ $product_id ] = array(
					'label'    => $item->get_name(),
					'quantity' => 0,
				);
			}
			$tally[ $product_id ]['quantity'] += (int) $item->get_quantity();
		}
	}

	if ( empty( $tally ) ) {
		return null;
	}

	uasort(
		$tally,
		static function ( $a, $b ) {
			return $b['quantity'] <=> $a['quantity'];
		}
	);

	$product_id = (int) array_key_first( $tally );
	$top        = $tally[ $product_id ];

	return array(
		'label'    => (string) $top['label'],
		'quantity' => (int) $top['quantity'],
		'editUrl'  => get_post( $product_id )
			? (string) get_edit_post_link( $product_id, 'raw' )
			: '',
	);
}

/**
 * A customer's most recent orders, shaped for a list.
 *
 * Bounded and only fetched for the one customer being looked at — the
 * list rows never touch this.
 *
 * @param int $user_id User id.
 * @param int $limit   How many.
 * @return array[]
 */
function openstation_my_wordpress_woo_customer_recent_orders( $user_id, $limit = 8 ) {
	$orders = wc_get_orders(
		array(
			'customer_id' => (int) $user_id,
			'limit'       => max( 1, (int) $limit ),
			'orderby'     => 'date',
			'order'       => 'DESC',
			'return'      => 'objects',
		)
	);

	$statuses = wc_get_order_statuses();
	$rows     = array();
	foreach ( (array) $orders as $maybe_order ) {
		$order = is_scalar( $maybe_order ) ? wc_get_order( (int) $maybe_order ) : $maybe_order;
		if ( ! $order instanceof WC_Abstract_Order ) {
			continue;
		}
		$rows[] = array(
			'id'          => (int) $order->get_id(),
			'number'      => (string) $order->get_order_number(),
			'status'      => (string) $order->get_status(),
			'statusLabel' => (string) ( $statuses[ 'wc-' . $order->get_status() ] ?? $order->get_status() ),
			'date'        => $order->get_date_created()
				? $order->get_date_created()->date( 'c' )
				: '',
			'total'       => openstation_my_wordpress_woo_price( $order->get_total(), $order->get_currency() ),
			'items'       => (int) $order->get_item_count(),
			'editUrl'     => method_exists( $order, 'get_edit_order_url' )
				? (string) $order->get_edit_order_url()
				: '',
		);
	}

	return $rows;
}

/**
 * Merchant facts for one customer — the right-pane panel.
 *
 * @param int $id User id.
 * @return array|WP_Error
 */
function openstation_my_wordpress_woo_customer_summary( $id ) {
	$user = get_userdata( (int) $id );
	if ( ! $user instanceof WP_User ) {
		return new WP_Error(
			'openstation_woo_no_customer',
			__( 'Customer not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	$facts = openstation_my_wordpress_woo_customer_facts( $user->ID );
	$bands = array();
	foreach ( openstation_my_wordpress_woo_customer_band_defs() as $band ) {
		$bands[ $band['id'] ] = (string) $band['label'];
	}

	// The most recent order, for the "last bought" line and the jump
	// into it. One query, only for the selected row.
	$recent = wc_get_orders(
		array(
			'customer_id' => $user->ID,
			'limit'       => 1,
			'orderby'     => 'date',
			'order'       => 'DESC',
			'return'      => 'objects',
		)
	);
	$last   = null;
	foreach ( (array) $recent as $maybe_order ) {
		$order = is_scalar( $maybe_order ) ? wc_get_order( (int) $maybe_order ) : $maybe_order;
		if ( $order instanceof WC_Abstract_Order ) {
			$last = $order;
			break;
		}
	}

	$customer = null;
	if ( class_exists( 'WC_Customer' ) ) {
		try {
			$customer = new WC_Customer( $user->ID );
		} catch ( Exception $e ) {
			$customer = null;
		}
	}

	$location = '';
	$billing  = '';
	$shipping = '';
	$phone    = '';
	if ( $customer ) {
		$parts    = array_filter(
			array(
				$customer->get_billing_city(),
				$customer->get_billing_country(),
			)
		);
		$location = implode( ', ', $parts );
		$phone    = (string) $customer->get_billing_phone();

		// `WC_Customer` has no formatted-address accessor of its own,
		// so build the lines the way WooCommerce's order screen does.
		$format   = static function ( array $address ) {
			if ( ! function_exists( 'WC' ) || ! WC()->countries ) {
				return '';
			}
			return trim(
				wp_strip_all_tags(
					(string) WC()->countries->get_formatted_address( $address, ', ' )
				)
			);
		};
		$billing  = $format(
			array(
				'address_1' => $customer->get_billing_address_1(),
				'address_2' => $customer->get_billing_address_2(),
				'city'      => $customer->get_billing_city(),
				'state'     => $customer->get_billing_state(),
				'postcode'  => $customer->get_billing_postcode(),
				'country'   => $customer->get_billing_country(),
			)
		);
		$shipping = $format(
			array(
				'address_1' => $customer->get_shipping_address_1(),
				'address_2' => $customer->get_shipping_address_2(),
				'city'      => $customer->get_shipping_city(),
				'state'     => $customer->get_shipping_state(),
				'postcode'  => $customer->get_shipping_postcode(),
				'country'   => $customer->get_shipping_country(),
			)
		);
	}

	return array(
		'type'           => 'customer',
		'id'             => (int) $user->ID,
		'name'           => $user->display_name,
		'username'       => $user->user_login,
		'avatar'         => (string) get_avatar_url( $user->ID, array( 'size' => 96 ) ),
		'email'          => $user->user_email,
		'phone'          => $phone,
		'billing'        => $billing,
		'shipping'       => $shipping,
		// Only the window asks for these; the preview pane's panel
		// ignores them. One payload, two consumers — cheaper than a
		// second route, and the window is where the depth belongs.
		'recentOrders'   => openstation_my_wordpress_woo_customer_recent_orders( $user->ID ),
		'spendRaw'       => (float) $facts['spendRaw'],
		'band'           => (string) $facts['band'],
		'bandLabel'      => $bands[ $facts['band'] ] ?? (string) $facts['band'],
		'orders'         => (int) $facts['orders'],
		'spend'          => (string) $facts['spend'],
		'aov'            => (string) $facts['aov'],
		'firstOrder'     => (string) $facts['firstOrder'],
		'lastOrder'      => (string) $facts['lastOrder'],
		'daysSince'      => $facts['daysSince'],
		'lastOrderNo'    => $last ? (string) $last->get_order_number() : '',
		'lastOrderUrl'   => $last && method_exists( $last, 'get_edit_order_url' )
			? (string) $last->get_edit_order_url()
			: '',
		'lastOrderTotal' => $last
			? openstation_my_wordpress_woo_price( $last->get_total(), $last->get_currency() )
			: '',
		'favourite'      => openstation_my_wordpress_woo_customer_favourite( $user->ID ),
		'location'       => $location,
		'registered'     => '' !== $user->user_registered
			? mysql2date( 'c', $user->user_registered, false )
			: '',
		'ordersUrl'      => openstation_my_wordpress_woo_customer_orders_url( $user->ID ),
		'profileUrl'     => current_user_can( 'edit_user', $user->ID )
			? (string) get_edit_user_link( $user->ID )
			: '',
	);
}

/**
 * The admin URL listing this customer's orders — HPOS and legacy
 * storage put that screen in different places.
 *
 * @param int $user_id User id.
 * @return string
 */
function openstation_my_wordpress_woo_customer_orders_url( $user_id ) {
	$user_id = (int) $user_id;

	if ( openstation_my_wordpress_woo_hpos_enabled() ) {
		return admin_url( 'admin.php?page=wc-orders&_customer_user=' . $user_id );
	}

	return admin_url( 'edit.php?post_type=shop_order&_customer_user=' . $user_id );
}

/**
 * Add the `customer` type to the shared summary route.
 *
 * Joining through the route's own extension seam rather than editing
 * its switch keeps the whole Customers surface in one file — and
 * proves the seam works, since this is the first thing to use it.
 *
 * @param array|null $data Summary payload (untouched for other types).
 * @param string     $type Summary type.
 * @param int        $id   Object id.
 * @return array|WP_Error|null
 */
function openstation_my_wordpress_woo_customer_summary_filter( $data, $type, $id ) {
	if ( 'customer' !== $type ) {
		return $data;
	}

	return openstation_my_wordpress_woo_customer_summary( $id );
}

/**
 * Gate the `customer` summary type. The generic fallback checks
 * `edit_post` against the id, which for a user id is meaningless —
 * and, on a site where post and user ids collide, wrong.
 *
 * @param true|WP_Error|null $allowed Permission verdict so far.
 * @param string             $type    Summary type.
 * @param int                $id      Object id.
 * @return true|WP_Error|null
 */
function openstation_my_wordpress_woo_customer_summary_capability( $allowed, $type, $id ) {
	unset( $id );
	if ( 'customer' !== $type ) {
		return $allowed;
	}

	return openstation_my_wordpress_woo_customers_permission();
}

/**
 * Register the Customers routes.
 *
 * @return void
 */
function openstation_my_wordpress_woo_register_customer_routes() {
	if ( ! openstation_my_wordpress_woo_active() ) {
		return;
	}

	register_rest_route(
		'desktop-mode/v1',
		'/woocommerce/customers',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'openstation_my_wordpress_woo_customers',
			'permission_callback' => 'openstation_my_wordpress_woo_customers_permission',
			'args'                => array(
				'page'     => array(
					'type'    => 'integer',
					'default' => 1,
				),
				'per_page' => array(
					'type'    => 'integer',
					'default' => 24,
				),
				'search'   => array( 'type' => 'string' ),
			),
		)
	);

	register_rest_route(
		'desktop-mode/v1',
		'/woocommerce/customers/(?P<id>\d+)',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'openstation_my_wordpress_woo_customer',
			'permission_callback' => 'openstation_my_wordpress_woo_customers_permission',
			'args'                => array(
				'id' => array( 'type' => 'integer' ),
			),
		)
	);
}
add_action( 'rest_api_init', 'openstation_my_wordpress_woo_register_customer_routes' );

/*
-------------------------------------------------------------------
 * The section
 * ----------------------------------------------------------------
 */

/**
 * Append the Customers section to the Woo folder.
 *
 * Registered on the same filter as Orders and at the same priority,
 * so it lands next to it inside the folder rather than at the end of
 * the entity list.
 *
 * @param array[] $entities Entity descriptors.
 * @return array[]
 */
function openstation_my_wordpress_woo_customer_entity( $entities ) {
	if ( ! is_array( $entities ) || ! openstation_my_wordpress_woo_active() ) {
		return $entities;
	}
	if ( true !== openstation_my_wordpress_woo_customers_permission() ) {
		return $entities;
	}

	$group = openstation_my_wordpress_woo_group(
		array(
			'id'    => 'plugin:woocommerce',
			'label' => 'WooCommerce',
			'icon'  => 'dashicons-admin-plugins',
			'order' => 20,
		),
		'shop_order'
	);

	$entities[] = array(
		'id'         => 'wc-customers',
		'label'      => __( 'Customers', 'desktop-mode' ),
		'icon'       => 'dashicons-groups',
		'restPath'   => 'desktop-mode/v1/woocommerce/customers',
		// Renders through the built-in user kind: avatar tiles, the
		// dossier pane, the footprint route, the drag-out seam. A
		// customer is a person before it is a row of money.
		'kind'       => 'user',
		// Keeps the facts payload from being stripped by `_fields`.
		'listFields' => array( 'openstation_woo_customer' ),
		'group'      => $group['id'],
		'groupLabel' => $group['label'],
		'groupIcon'  => $group['icon'],
		'groupOrder' => $group['order'],
	);

	return $entities;
}

/**
 * Add the people numbers to the Woo folder's Store panel.
 *
 * Guest revenue is here because it is the one figure the Customers
 * section structurally cannot show: an order with no account has no
 * tile to sit on. Reporting it as a line on the folder is the honest
 * alternative to letting it disappear.
 *
 * @param array $data Store totals.
 * @return array
 */
function openstation_my_wordpress_woo_customer_store_totals( $data ) {
	if ( ! is_array( $data ) || true !== openstation_my_wordpress_woo_customers_permission() ) {
		return $data;
	}

	$map   = openstation_my_wordpress_woo_customer_spend_map();
	$guest = $map[0] ?? null;
	$plan  = openstation_my_wordpress_woo_customer_plan();

	$data['customers']   = (int) ( $plan['customers'] ?? 0 );
	$data['vips']        = (int) ( ( $plan['counts'] ?? array() )['vip'] ?? 0 );
	$data['lapsed']      = (int) ( ( $plan['counts'] ?? array() )['lapsed'] ?? 0 );
	$data['guestSpend']  = $guest && (float) $guest['spend'] > 0
		? openstation_my_wordpress_woo_price( (float) $guest['spend'] )
		: '';
	$data['guestOrders'] = $guest ? (int) $guest['orders'] : 0;

	return $data;
}

/**
 * Boot the Customers surface.
 *
 * @return void
 */
function openstation_my_wordpress_woo_customers_boot() {
	add_filter( 'openstation_my_wordpress_woo_store', 'openstation_my_wordpress_woo_customer_store_totals' );
	add_filter( 'openstation_my_wordpress_entities', 'openstation_my_wordpress_woo_customer_entity', 5 );
	add_filter( 'openstation_my_wordpress_woo_summary_type', 'openstation_my_wordpress_woo_customer_summary_filter', 10, 3 );
	add_filter( 'openstation_my_wordpress_woo_summary_capability', 'openstation_my_wordpress_woo_customer_summary_capability', 10, 3 );
}
openstation_my_wordpress_woo_customers_boot();
