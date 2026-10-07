<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_WOO_MAX_ORDERED_CUSTOMERS = 5000;

const OPENSTATION_WOO_CUSTOMER_LAPSE_DAYS = 180;

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

function openstation_my_wordpress_woo_hpos_enabled() {
	return class_exists( '\Automattic\WooCommerce\Utilities\OrderUtil' )
		&& \Automattic\WooCommerce\Utilities\OrderUtil::custom_orders_table_usage_is_enabled();
}

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

	$map = (array) apply_filters( 'openstation_my_wordpress_woo_customer_spend_map', $map );

	set_transient( 'desktop_mode_woo_customer_spend', $map, 5 * MINUTE_IN_SECONDS );
	$memo = $map;

	return $memo;
}

function openstation_my_wordpress_woo_store_aov() {
	$orders = 0;
	$spend  = 0.0;
	foreach ( openstation_my_wordpress_woo_customer_spend_map() as $stats ) {
		$orders += (int) $stats['orders'];
		$spend  += (float) $stats['spend'];
	}

	return $orders > 0 ? $spend / $orders : 0.0;
}

function openstation_my_wordpress_woo_vip_threshold() {
	$aov = openstation_my_wordpress_woo_store_aov();

	return (float) apply_filters(
		'openstation_my_wordpress_woo_vip_threshold',
		$aov * 3,
		$aov
	);
}

function openstation_my_wordpress_woo_customer_lapse_days() {

	$days = (int) apply_filters(
		'openstation_my_wordpress_woo_customer_lapse_days',
		OPENSTATION_WOO_CUSTOMER_LAPSE_DAYS
	);

	return max( 1, $days );
}

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

	return (array) apply_filters( 'openstation_my_wordpress_woo_customer_bands', $bands );
}

function openstation_my_wordpress_woo_customer_band_id( $stats ) {
	$orders = (int) ( $stats['orders'] ?? 0 );
	$spend  = (float) ( $stats['spend'] ?? 0 );
	$last   = (string) ( $stats['last'] ?? '' );

	$band = 'none';
	if ( $orders > 0 ) {
		$threshold = openstation_my_wordpress_woo_vip_threshold();
		$lapsed    = openstation_my_wordpress_woo_customer_days_since( $last );

		if ( $threshold > 0 && $spend >= $threshold ) {

			$band = 'vip';
		} elseif ( null !== $lapsed && $lapsed > openstation_my_wordpress_woo_customer_lapse_days() ) {
			$band = 'lapsed';
		} elseif ( $orders > 1 ) {
			$band = 'repeat';
		} else {
			$band = 'new';
		}
	}

	return (string) apply_filters( 'openstation_my_wordpress_woo_customer_band', $band, $stats );
}

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

	return array_values(
		array_map( 'intval', array_keys( (array) apply_filters( 'openstation_my_wordpress_woo_customer_ids', $ids ) ) )
	);
}

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

			$band = 'none';
			if ( ! isset( $buckets[ $band ] ) ) {
				continue;
			}
		}

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

function openstation_my_wordpress_woo_customer_ordering_state() {
	$plan = openstation_my_wordpress_woo_customer_plan();

	return array(
		'mode'      => ! empty( $plan['capped'] ) ? 'capped' : 'ordered',
		'customers' => (int) ( $plan['customers'] ?? 0 ),
		'ordered'   => count( (array) ( $plan['ids'] ?? array() ) ),
		'limit'     => OPENSTATION_WOO_MAX_ORDERED_CUSTOMERS,
	);
}

function openstation_my_wordpress_woo_flush_customer_caches() {
	delete_transient( 'desktop_mode_woo_customer_spend' );
	delete_transient( 'desktop_mode_woo_customer_plan' );
}
add_action( 'woocommerce_new_order', 'openstation_my_wordpress_woo_flush_customer_caches' );
add_action( 'woocommerce_update_order', 'openstation_my_wordpress_woo_flush_customer_caches' );
add_action( 'woocommerce_order_status_changed', 'openstation_my_wordpress_woo_flush_customer_caches' );
add_action( 'woocommerce_delete_order', 'openstation_my_wordpress_woo_flush_customer_caches' );
add_action( 'woocommerce_trash_order', 'openstation_my_wordpress_woo_flush_customer_caches' );

add_action( 'woocommerce_untrash_order', 'openstation_my_wordpress_woo_flush_customer_caches' );

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

		'spendRaw'   => round( $spend, 2 ),
		'aov'        => $orders > 0 ? openstation_my_wordpress_woo_price( $spend / $orders ) : '',
		'firstOrder' => '' !== $stats['first'] ? mysql2date( 'c', $stats['first'], false ) : '',
		'lastOrder'  => '' !== $stats['last'] ? mysql2date( 'c', $stats['last'], false ) : '',
		'daysSince'  => $days,

		'ordersUrl'  => $orders > 0 ? openstation_my_wordpress_woo_customer_orders_url( $user_id ) : '',
	);

	return (array) apply_filters( 'openstation_my_wordpress_woo_customer_facts', $facts, $user_id );
}

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

		$args['orderby'] = 'include';
	}

	if ( '' !== $search ) {
		$args['search']         = '*' . $search . '*';
		$args['search_columns'] = array( 'user_login', 'user_email', 'user_nicename', 'display_name' );

		if ( ! $capped ) {
			$args['orderby'] = 'display_name';
			$args['order']   = 'ASC';
		}
	}

	$args = (array) apply_filters( 'openstation_my_wordpress_woo_customer_query_args', $args, $request );

	$query = new WP_User_Query( $args );
	$total = (int) $query->get_total();
	$pages = $per_page > 0 ? (int) ceil( $total / $per_page ) : 1;

	$users = array();
	foreach ( (array) $query->get_results() as $user ) {
		if ( $user instanceof WP_User ) {
			$users[] = $user;
		}
	}

	if ( function_exists( 'openstation_my_wordpress_user_summary_prime' ) ) {
		openstation_my_wordpress_user_summary_prime(
			array_map(
				static function ( $user ) {
					return (int) $user->ID;
				},
				$users
			)
		);
	}

	$rows = array();
	foreach ( $users as $user ) {
		$rows[] = openstation_my_wordpress_woo_customer_row( $user );
	}

	$response = rest_ensure_response( $rows );
	$response->header( 'X-WP-Total', (string) $total );
	$response->header( 'X-WP-TotalPages', (string) max( 1, $pages ) );

	$response->header( 'X-Desktop-Mode-Woo-Customers-Mode', $capped ? 'capped' : 'ordered' );

	return $response;
}

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

	$can_edit = get_post( $product_id ) && current_user_can( 'edit_post', $product_id );

	return array(
		'label'    => openstation_plain_text_title( $top['label'] ),
		'quantity' => (int) $top['quantity'],
		'editUrl'  => $can_edit ? (string) get_edit_post_link( $product_id, 'raw' ) : '',
	);
}

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
		'name'           => openstation_plain_text_title( $user->display_name ),
		'username'       => $user->user_login,
		'avatar'         => (string) get_avatar_url( $user->ID, array( 'size' => 96 ) ),
		'email'          => $user->user_email,
		'phone'          => $phone,
		'billing'        => $billing,
		'shipping'       => $shipping,

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

function openstation_my_wordpress_woo_customer_orders_url( $user_id ) {
	$user_id = (int) $user_id;

	if ( openstation_my_wordpress_woo_hpos_enabled() ) {
		return admin_url( 'admin.php?page=wc-orders&_customer_user=' . $user_id );
	}

	return admin_url( 'edit.php?post_type=shop_order&_customer_user=' . $user_id );
}

function openstation_my_wordpress_woo_customer_summary_filter( $data, $type, $id ) {
	if ( 'customer' !== $type ) {
		return $data;
	}

	return openstation_my_wordpress_woo_customer_summary( $id );
}

function openstation_my_wordpress_woo_customer_summary_capability( $allowed, $type, $id ) {
	unset( $id );
	if ( 'customer' !== $type ) {
		return $allowed;
	}

	return openstation_my_wordpress_woo_customers_permission();
}

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

		'kind'       => 'user',

		'listFields' => array( 'openstation_woo_customer' ),
		'group'      => $group['id'],
		'groupLabel' => $group['label'],
		'groupIcon'  => $group['icon'],
		'groupOrder' => $group['order'],
	);

	return $entities;
}

function openstation_my_wordpress_woo_customer_store_totals( $data ) {
	if ( ! is_array( $data ) || true !== openstation_my_wordpress_woo_customers_permission() ) {
		return $data;
	}

	$map   = openstation_my_wordpress_woo_customer_spend_map();
	$guest = $map[0] ?? null;
	$plan  = openstation_my_wordpress_woo_customer_plan();

	$data['customers'] = (int) ( $plan['customers'] ?? 0 );

	$data['bandsCapped'] = ! empty( $plan['capped'] );
	if ( empty( $data['bandsCapped'] ) ) {
		$data['vips']   = (int) ( ( $plan['counts'] ?? array() )['vip'] ?? 0 );
		$data['lapsed'] = (int) ( ( $plan['counts'] ?? array() )['lapsed'] ?? 0 );
	}

	$data['guestSpend']  = $guest && (float) $guest['spend'] > 0
		? openstation_my_wordpress_woo_price( (float) $guest['spend'] )
		: '';
	$data['guestOrders'] = $guest ? (int) $guest['orders'] : 0;

	return $data;
}

function openstation_my_wordpress_woo_customers_boot() {
	add_filter( 'openstation_my_wordpress_woo_store', 'openstation_my_wordpress_woo_customer_store_totals' );
	add_filter( 'openstation_my_wordpress_entities', 'openstation_my_wordpress_woo_customer_entity', 5 );
	add_filter( 'openstation_my_wordpress_woo_summary_type', 'openstation_my_wordpress_woo_customer_summary_filter', 10, 3 );
	add_filter( 'openstation_my_wordpress_woo_summary_capability', 'openstation_my_wordpress_woo_customer_summary_capability', 10, 3 );
}
openstation_my_wordpress_woo_customers_boot();
