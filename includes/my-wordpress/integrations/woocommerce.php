<?php

defined( 'ABSPATH' ) || exit;

function openstation_my_wordpress_woo_active() {
	return class_exists( 'WooCommerce' ) && function_exists( 'wc_get_orders' );
}

function openstation_my_wordpress_woo_icon() {
	$svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 85.9 47.6">'
		. '<path fill="currentColor" d="M77.4,0.1c-4.3,0-7.1,1.4-9.6,6.1L56.4,27.7V8.6c0-5.7-2.7-8.5-7.7-8.5'
		. 's-7.1,1.7-9.6,6.5L28.3,27.7V8.8c0-6.1-2.5-8.7-8.6-8.7H7.3C2.6,0.1,0,2.3,0,6.3s2.5,6.4,7.1,6.4h5.1v24.1'
		. 'c0,6.8,4.6,10.8,11.2,10.8S33,45,36.3,38.9l7.2-13.5v11.4c0,6.7,4.4,10.8,11.1,10.8s9.2-2.3,13-8.7l16.6-28'
		. 'c3.6-6.1,1.1-10.8-6.9-10.8C77.3,0.1,77.3,0.1,77.4,0.1z"/></svg>';

	return 'data:image/svg+xml;base64,' . base64_encode( $svg );
}

function openstation_my_wordpress_woo_group( $group, $post_type ) {
	unset( $post_type );
	if ( ! is_array( $group ) || 'plugin:woocommerce' !== ( $group['id'] ?? '' ) ) {
		return $group;
	}

	$group['label'] = _x( 'Woo', 'WooCommerce folder name', 'desktop-mode' );
	$group['icon']  = openstation_my_wordpress_woo_icon();

	$group['order'] = 15;

	return $group;
}

function openstation_my_wordpress_woo_entities( $entities ) {
	if ( ! is_array( $entities ) || ! openstation_my_wordpress_woo_active() ) {
		return $entities;
	}

	$orders = get_post_type_object( 'shop_order' );
	if ( ! $orders instanceof WP_Post_Type ) {
		return $entities;
	}
	if ( empty( $orders->cap->edit_posts ) || ! current_user_can( $orders->cap->edit_posts ) ) {
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
		'id'         => 'wc-orders',
		'label'      => __( 'Orders', 'desktop-mode' ),
		'icon'       => 'dashicons-cart',
		'restPath'   => 'desktop-mode/v1/woocommerce/orders',
		'kind'       => 'post',

		'post_type'  => 'shop_order',
		'thumbnails' => false,

		'listFields' => array( 'wcStatus' ),
		'group'      => $group['id'],
		'groupLabel' => $group['label'],
		'groupIcon'  => $group['icon'],
		'groupOrder' => $group['order'],
	);

	return $entities;
}

function openstation_my_wordpress_woo_entity_icon( $entity, $post_type ) {
	$icons = array(
		'product'     => 'dashicons-products',
		'shop_coupon' => 'dashicons-tickets-alt',
		'shop_order'  => 'dashicons-cart',
	);

	$icons = (array) apply_filters( 'openstation_my_wordpress_woo_section_icons', $icons );

	$name = isset( $post_type->name ) ? (string) $post_type->name : '';
	if ( isset( $icons[ $name ] ) ) {
		$entity['icon'] = (string) $icons[ $name ];
	}

	if ( 'shop_coupon' === $name ) {
		$entity['thumbnails'] = false;
		$entity['listFields'] = array( 'openstation_woo' );
		$entity['listQuery']  = array( OPENSTATION_WOO_BANDED_PARAM => '1' );
	}

	if ( 'product' === $name ) {
		$entity['listFields'] = array( 'openstation_woo' );
		$entity['listQuery']  = array( OPENSTATION_WOO_BANDED_PARAM => '1' );

		$entity['tileSize'] = 'large';
	}

	return $entity;
}

function openstation_my_wordpress_woo_order_bands() {
	$labels = wc_get_order_statuses();

	$label_for = static function ( $status ) use ( $labels ) {
		return $labels[ 'wc-' . $status ] ?? ucfirst( str_replace( '-', ' ', $status ) );
	};

	$bands = array(
		array(
			'id'       => 'needs-action',
			'label'    => __( 'Needs attention', 'desktop-mode' ),
			'order'    => 10,
			'tone'     => 'warn',
			'statuses' => array( 'processing', 'on-hold', 'pending' ),
		),
		array(
			'id'       => 'problem',
			'label'    => __( 'Problems', 'desktop-mode' ),
			'order'    => 20,
			'tone'     => 'danger',
			'statuses' => array( 'failed' ),
		),
		array(
			'id'       => 'completed',
			'label'    => $label_for( 'completed' ),
			'order'    => 30,
			'statuses' => array( 'completed' ),
		),
		array(
			'id'       => 'closed',
			'label'    => __( 'Cancelled & refunded', 'desktop-mode' ),
			'order'    => 40,
			'statuses' => array( 'cancelled', 'refunded' ),
		),
		array(
			'id'       => 'other',
			'label'    => __( 'Other', 'desktop-mode' ),
			'order'    => 50,
			'statuses' => array(),
		),
	);

	return (array) apply_filters( 'openstation_my_wordpress_woo_order_bands', $bands );
}

function openstation_my_wordpress_woo_product_bands() {
	return openstation_my_wordpress_woo_count_product_bands(
		openstation_my_wordpress_woo_product_band_defs()
	);
}

function openstation_my_wordpress_woo_product_band_defs() {

	$with_categories = ! openstation_my_wordpress_woo_catalogue_is_capped();

	$bands = array(
		array(
			'id'    => 'stock:outofstock',
			'label' => __( 'Out of stock', 'desktop-mode' ),
			'order' => 10,
			'tone'  => 'danger',
			'stock' => 'outofstock',
		),
		array(
			'id'    => 'stock:onbackorder',
			'label' => __( 'On backorder', 'desktop-mode' ),
			'order' => 20,
			'tone'  => 'warn',
			'stock' => 'onbackorder',
		),
	);

	if ( $with_categories ) {
		$terms = get_terms(
			array(
				'taxonomy'   => 'product_cat',
				'hide_empty' => true,
				'orderby'    => 'name',
				'order'      => 'ASC',
			)
		);

		$order = 100;
		foreach ( ( is_wp_error( $terms ) ? array() : (array) $terms ) as $term ) {
			$bands[] = array(
				'id'       => 'cat:' . $term->slug,
				'label'    => openstation_plain_text_title( $term->name ),
				'order'    => $order,
				'category' => $term->slug,
			);
			$order  += 10;
		}
	}

	$bands[] = array(
		'id'    => 'cat:__none',
		'label' => $with_categories
			? __( 'Uncategorised', 'desktop-mode' )
			: __( 'In stock', 'desktop-mode' ),
		'order' => PHP_INT_MAX,
	);

	return (array) apply_filters( 'openstation_my_wordpress_woo_product_bands', $bands );
}

function openstation_my_wordpress_woo_count_product_bands( $bands ) {
	$plan = openstation_my_wordpress_woo_product_plan();
	foreach ( $bands as $i => $band ) {
		$bands[ $i ]['count'] = (int) ( $plan['counts'][ $band['id'] ] ?? 0 );
	}
	return $bands;
}

const OPENSTATION_WOO_MAX_ORDERED_PRODUCTS = 20000;

function openstation_my_wordpress_woo_product_total() {
	static $total = null;
	if ( null !== $total ) {
		return $total;
	}

	$cached = get_transient( 'desktop_mode_woo_product_total' );
	if ( false !== $cached ) {
		$total = (int) $cached;
		return $total;
	}

	$result = wc_get_products(
		array(
			'limit'    => 1,
			'paginate' => true,
			'return'   => 'ids',
			'status'   => array( 'publish', 'private', 'draft', 'pending', 'future' ),
		)
	);
	$total  = isset( $result->total ) ? (int) $result->total : 0;
	set_transient( 'desktop_mode_woo_product_total', $total, 5 * MINUTE_IN_SECONDS );

	return $total;
}

function openstation_my_wordpress_woo_catalogue_is_capped() {
	return openstation_my_wordpress_woo_product_total() > OPENSTATION_WOO_MAX_ORDERED_PRODUCTS;
}

function openstation_my_wordpress_woo_product_plan() {
	static $memo = null;
	if ( null !== $memo ) {
		return $memo;
	}

	$cache_key = 'desktop_mode_woo_product_plan';
	$cached    = get_transient( $cache_key );
	if ( is_array( $cached ) && isset( $cached['ids'], $cached['counts'] ) ) {
		$memo = $cached;
		return $memo;
	}

	$statuses = array( 'publish', 'private', 'draft', 'pending', 'future' );
	$total    = openstation_my_wordpress_woo_product_total();

	if ( openstation_my_wordpress_woo_catalogue_is_capped() ) {
		$memo = array(
			'ids'      => array(),
			'counts'   => array(),
			'capped'   => true,
			'products' => $total,
		);
		set_transient( $cache_key, $memo, 5 * MINUTE_IN_SECONDS );
		return $memo;
	}

	$ordered = array();
	$counts  = array();
	$seen    = array();

	foreach ( openstation_my_wordpress_woo_product_band_defs() as $band ) {
		$args = array(
			'limit'   => -1,
			'return'  => 'ids',
			'orderby' => 'date',
			'order'   => 'DESC',
			'status'  => $statuses,
		);
		if ( ! empty( $band['stock'] ) ) {
			$args['stock_status'] = $band['stock'];
		} elseif ( ! empty( $band['category'] ) ) {
			$args['category'] = array( $band['category'] );
		} else {

			$args = null;
		}

		$ids = null === $args ? array() : (array) wc_get_products( $args );

		$claimed = 0;
		foreach ( $ids as $id ) {
			$id = (int) $id;
			if ( isset( $seen[ $id ] ) ) {
				continue;
			}
			$seen[ $id ] = true;
			$ordered[]   = $id;
			++$claimed;
		}
		$counts[ $band['id'] ] = $claimed;
	}

	$remainder = wc_get_products(
		array(
			'limit'   => -1,
			'return'  => 'ids',
			'orderby' => 'date',
			'order'   => 'DESC',
			'status'  => $statuses,
		)
	);
	$trailing  = 0;
	foreach ( (array) $remainder as $id ) {
		$id = (int) $id;
		if ( isset( $seen[ $id ] ) ) {
			continue;
		}
		$seen[ $id ] = true;
		$ordered[]   = $id;
		++$trailing;
	}
	$counts['cat:__none'] = ( $counts['cat:__none'] ?? 0 ) + $trailing;

	$memo = array(
		'ids'      => $ordered,
		'counts'   => $counts,
		'capped'   => false,
		'products' => $total,
	);
	set_transient( $cache_key, $memo, 5 * MINUTE_IN_SECONDS );

	return $memo;
}

const OPENSTATION_WOO_BANDED_PARAM = 'desktop_mode_bands';

function openstation_my_wordpress_woo_is_banded_request( $request ) {
	if ( ! $request instanceof WP_REST_Request ) {
		return false;
	}
	return '1' === (string) $request->get_param( OPENSTATION_WOO_BANDED_PARAM );
}

function openstation_my_wordpress_woo_ordering_state() {
	$plan = openstation_my_wordpress_woo_product_plan();
	return array(
		'mode'     => ! empty( $plan['capped'] ) ? 'capped' : 'ordered',
		'products' => (int) ( $plan['products'] ?? 0 ),
		'ordered'  => count( (array) ( $plan['ids'] ?? array() ) ),
		'limit'    => OPENSTATION_WOO_MAX_ORDERED_PRODUCTS,
	);
}

function openstation_my_wordpress_woo_product_band_id( $product ) {
	$defs  = openstation_my_wordpress_woo_product_band_defs();
	$stock = $product->get_stock_status();

	foreach ( $defs as $band ) {
		if ( ! empty( $band['stock'] ) && $band['stock'] === $stock ) {
			return (string) $band['id'];
		}
	}

	$slugs = wp_get_post_terms(
		$product->get_id(),
		'product_cat',
		array( 'fields' => 'slugs' )
	);
	$slugs = is_wp_error( $slugs ) ? array() : (array) $slugs;

	foreach ( $defs as $band ) {
		if ( ! empty( $band['category'] ) && in_array( $band['category'], $slugs, true ) ) {
			return (string) $band['id'];
		}
	}

	return 'cat:__none';
}

function openstation_my_wordpress_woo_flush_band_counts() {
	delete_transient( 'desktop_mode_woo_product_plan' );
	delete_transient( 'desktop_mode_woo_product_total' );
	delete_transient( 'desktop_mode_woo_coupon_plan' );
}
add_action( 'woocommerce_update_product', 'openstation_my_wordpress_woo_flush_band_counts' );
add_action( 'woocommerce_new_product', 'openstation_my_wordpress_woo_flush_band_counts' );
add_action( 'woocommerce_product_set_stock_status', 'openstation_my_wordpress_woo_flush_band_counts' );
add_action( 'woocommerce_new_coupon', 'openstation_my_wordpress_woo_flush_band_counts' );
add_action( 'woocommerce_update_coupon', 'openstation_my_wordpress_woo_flush_band_counts' );
add_action( 'created_product_cat', 'openstation_my_wordpress_woo_flush_band_counts' );
add_action( 'edited_product_cat', 'openstation_my_wordpress_woo_flush_band_counts' );
add_action( 'delete_product_cat', 'openstation_my_wordpress_woo_flush_band_counts' );

function openstation_my_wordpress_woo_order_products( $args, $request ) {
	if ( ! openstation_my_wordpress_woo_active() ) {
		return $args;
	}

	if ( ! openstation_my_wordpress_woo_is_banded_request( $request ) ) {
		return $args;
	}

	if ( ! empty( $request['search'] ) ) {
		return $args;
	}

	$plan = openstation_my_wordpress_woo_product_plan();
	if ( empty( $plan['ids'] ) ) {

		$args['meta_key'] = '_stock_status';
		$args['orderby']  = array(
			'meta_value' => 'DESC',
			'date'       => 'DESC',
		);
		return $args;
	}

	$args['post__in'] = $plan['ids'];
	$args['orderby']  = 'post__in';
	unset( $args['order'] );

	return $args;
}

add_filter( 'rest_product_query', 'openstation_my_wordpress_woo_order_products', 99, 2 );

function openstation_my_wordpress_woo_coupon_bands() {
	$bands = array(
		array(
			'id'    => 'coupon:active',
			'label' => __( 'Active', 'desktop-mode' ),
			'order' => 10,
		),
		array(
			'id'    => 'coupon:expiring',
			'label' => __( 'Expiring soon', 'desktop-mode' ),
			'order' => 20,
			'tone'  => 'warn',
		),
		array(
			'id'    => 'coupon:used-up',
			'label' => __( 'Usage limit reached', 'desktop-mode' ),
			'order' => 30,
			'tone'  => 'danger',
		),
		array(
			'id'    => 'coupon:expired',
			'label' => __( 'Expired', 'desktop-mode' ),
			'order' => 40,
		),
	);

	return (array) apply_filters( 'openstation_my_wordpress_woo_coupon_bands', $bands );
}

function openstation_my_wordpress_woo_coupon_band_id( $coupon ) {
	$expiry = $coupon->get_date_expires();
	$limit  = (int) $coupon->get_usage_limit();
	$used   = (int) $coupon->get_usage_count();

	if ( $expiry && $expiry->getTimestamp() < time() ) {
		return 'coupon:expired';
	}
	if ( $limit > 0 && $used >= $limit ) {
		return 'coupon:used-up';
	}
	if ( $expiry && $expiry->getTimestamp() < time() + ( 30 * DAY_IN_SECONDS ) ) {
		return 'coupon:expiring';
	}
	return 'coupon:active';
}

function openstation_my_wordpress_woo_coupon_plan() {
	static $memo = null;
	if ( null !== $memo ) {
		return $memo;
	}

	$cache_key = 'desktop_mode_woo_coupon_plan';
	$cached    = get_transient( $cache_key );
	if ( is_array( $cached ) && isset( $cached['ids'], $cached['counts'] ) ) {
		$memo = $cached;
		return $memo;
	}

	$ids = get_posts(
		array(
			'post_type'      => 'shop_coupon',
			'post_status'    => array( 'publish', 'private', 'draft', 'pending', 'future' ),
			'posts_per_page' => 500,
			'fields'         => 'ids',
			'orderby'        => 'title',
			'order'          => 'ASC',
		)
	);

	$buckets = array();
	foreach ( openstation_my_wordpress_woo_coupon_bands() as $band ) {
		$buckets[ $band['id'] ] = array();
	}

	foreach ( (array) $ids as $id ) {
		$coupon = new WC_Coupon( (int) $id );
		if ( ! $coupon->get_id() ) {
			continue;
		}
		$band = openstation_my_wordpress_woo_coupon_band_id( $coupon );
		if ( ! isset( $buckets[ $band ] ) ) {
			$buckets[ $band ] = array();
		}
		$buckets[ $band ][] = (int) $id;
	}

	$ordered = array();
	$counts  = array();
	foreach ( $buckets as $band_id => $band_ids ) {
		$counts[ $band_id ] = count( $band_ids );
		$ordered            = array_merge( $ordered, $band_ids );
	}

	$memo = array(
		'ids'    => $ordered,
		'counts' => $counts,
	);
	set_transient( $cache_key, $memo, 5 * MINUTE_IN_SECONDS );

	return $memo;
}

function openstation_my_wordpress_woo_coupon_bands_with_counts() {
	$plan  = openstation_my_wordpress_woo_coupon_plan();
	$bands = openstation_my_wordpress_woo_coupon_bands();
	foreach ( $bands as $i => $band ) {
		$bands[ $i ]['count'] = (int) ( $plan['counts'][ $band['id'] ] ?? 0 );
	}
	return $bands;
}

function openstation_my_wordpress_woo_order_coupons( $args, $request ) {
	if ( ! openstation_my_wordpress_woo_active() || ! empty( $request['search'] ) ) {
		return $args;
	}
	if ( ! openstation_my_wordpress_woo_is_banded_request( $request ) ) {
		return $args;
	}
	$plan = openstation_my_wordpress_woo_coupon_plan();
	if ( empty( $plan['ids'] ) ) {
		return $args;
	}
	$args['post__in'] = $plan['ids'];
	$args['orderby']  = 'post__in';
	unset( $args['order'] );
	return $args;
}
add_filter( 'rest_shop_coupon_query', 'openstation_my_wordpress_woo_order_coupons', 99, 2 );

function openstation_my_wordpress_woo_register_coupon_field() {
	if ( ! openstation_my_wordpress_woo_active() || ! post_type_exists( 'shop_coupon' ) ) {
		return;
	}
	register_rest_field(
		'shop_coupon',
		'openstation_woo',
		array(
			'get_callback' => static function ( $post ) {
				$coupon = new WC_Coupon( isset( $post['id'] ) ? (int) $post['id'] : 0 );
				if ( ! $coupon->get_id() ) {
					return null;
				}
				return array(
					'band' => openstation_my_wordpress_woo_coupon_band_id( $coupon ),
				);
			},
			'schema'       => array(
				'description' => __( 'Coupon band used by the site window tiles.', 'desktop-mode' ),
				'type'        => array( 'object', 'null' ),
				'context'     => array( 'view', 'edit' ),
				'readonly'    => true,
			),
		)
	);
}
add_action( 'rest_api_init', 'openstation_my_wordpress_woo_register_coupon_field' );

function openstation_my_wordpress_woo_register_rest_field() {
	if ( ! openstation_my_wordpress_woo_active() || ! post_type_exists( 'product' ) ) {
		return;
	}

	register_rest_field(
		'product',
		'openstation_woo',
		array(
			'get_callback' => static function ( $post ) {
				$product = wc_get_product( isset( $post['id'] ) ? (int) $post['id'] : 0 );
				if ( ! $product ) {
					return null;
				}
				$slugs = wp_get_post_terms(
					$product->get_id(),
					'product_cat',
					array( 'fields' => 'slugs' )
				);
				return array(

					'band'        => openstation_my_wordpress_woo_product_band_id( $product ),
					'stockStatus' => $product->get_stock_status(),
					'stockLevel'  => $product->managing_stock()
						? (int) $product->get_stock_quantity()
						: null,
					'onSale'      => $product->is_on_sale(),
					'categories'  => is_wp_error( $slugs ) ? array() : array_values( $slugs ),
				);
			},
			'schema'       => array(
				'description' => __( 'Stock and category facts used by the site window tiles.', 'desktop-mode' ),
				'type'        => array( 'object', 'null' ),
				'context'     => array( 'view', 'edit' ),
				'readonly'    => true,
			),
		)
	);
}
add_action( 'rest_api_init', 'openstation_my_wordpress_woo_register_rest_field' );

function openstation_my_wordpress_woo_boot() {
	add_filter( 'openstation_my_wordpress_post_type_group', 'openstation_my_wordpress_woo_group', 10, 2 );
	add_filter( 'openstation_my_wordpress_entities', 'openstation_my_wordpress_woo_entities', 5 );
	add_filter( 'openstation_my_wordpress_post_type_entity', 'openstation_my_wordpress_woo_entity_icon', 10, 2 );
}
openstation_my_wordpress_woo_boot();

function openstation_my_wordpress_woo_orders_permission() {
	$orders = get_post_type_object( 'shop_order' );
	$cap    = $orders instanceof WP_Post_Type && ! empty( $orders->cap->edit_posts )
		? $orders->cap->edit_posts
		: 'manage_woocommerce';

	if ( ! current_user_can( $cap ) ) {
		return new WP_Error(
			'openstation_woo_forbidden',
			__( 'Sorry, you are not allowed to view orders.', 'desktop-mode' ),
			array( 'status' => rest_authorization_required_code() )
		);
	}
	return true;
}

function openstation_my_wordpress_woo_order_row( $order, $full = false ) {
	$total = html_entity_decode(
		wp_strip_all_tags( wc_price( $order->get_total(), array( 'currency' => $order->get_currency() ) ) ),
		ENT_QUOTES,
		get_bloginfo( 'charset' )
	);

	$row = array(
		'id'             => $order->get_id(),

		'title'          => array(
			'rendered' => sprintf(

				__( '#%1$s · %2$s', 'desktop-mode' ),
				$order->get_order_number(),
				$total
			),
		),
		'excerpt'        => array( 'rendered' => '' ),
		'date'           => $order->get_date_created()
			? $order->get_date_created()->date( 'c' )
			: '',

		'status'         => 'publish',

		'link'           => method_exists( $order, 'get_edit_order_url' )
			? $order->get_edit_order_url()
			: '',
		'featured_media' => 0,

		'wcStatus'       => $order->get_status(),
	);

	if ( $full ) {
		$row['content']  = array( 'rendered' => '' );
		$row['modified'] = $order->get_date_modified()
			? $order->get_date_modified()->date( 'c' )
			: $row['date'];
	}

	return $row;
}

function openstation_my_wordpress_woo_order_band_slices( $base ) {
	$all     = array_map(
		static function ( $status ) {
			return substr( $status, 3 );
		},
		array_keys( wc_get_order_statuses() )
	);
	$claimed = array();
	$slices  = array();

	foreach ( openstation_my_wordpress_woo_order_bands() as $band ) {
		$statuses = array_values(
			array_intersect( (array) ( $band['statuses'] ?? array() ), $all )
		);
		if ( empty( $statuses ) ) {

			$statuses = array_values( array_diff( $all, $claimed ) );
		}
		$claimed = array_merge( $claimed, $statuses );
		if ( empty( $statuses ) ) {
			continue;
		}

		$counted = wc_get_orders(
			array_merge(
				$base,
				array(
					'status'   => array_map(
						static function ( $s ) {
							return 'wc-' . $s;
						},
						$statuses
					),
					'limit'    => 1,
					'paginate' => true,
					'return'   => 'ids',
				)
			)
		);

		$slices[] = array(
			'statuses' => array_map(
				static function ( $s ) {
					return 'wc-' . $s;
				},
				$statuses
			),
			'count'    => isset( $counted->total ) ? (int) $counted->total : 0,
		);
	}

	return $slices;
}

function openstation_my_wordpress_woo_orders( $request ) {
	$per_page = max( 1, min( 100, (int) ( $request['per_page'] ?? 24 ) ) );
	$page     = max( 1, (int) ( $request['page'] ?? 1 ) );
	$search   = (string) ( $request['search'] ?? '' );

	$base = array(
		'orderby' => 'date',
		'order'   => 'DESC',
	);
	if ( '' !== $search ) {
		$base['s'] = $search;
	}

	$base = (array) apply_filters( 'openstation_my_wordpress_woo_order_args', $base, $request );

	$slices = openstation_my_wordpress_woo_order_band_slices( $base );

	$total = 0;
	foreach ( $slices as $slice ) {
		$total += $slice['count'];
	}
	$pages  = $per_page > 0 ? (int) ceil( $total / $per_page ) : 1;
	$offset = ( $page - 1 ) * $per_page;

	$orders    = array();
	$remaining = $per_page;
	$cursor    = 0;
	foreach ( $slices as $slice ) {
		if ( $remaining <= 0 ) {
			break;
		}
		$count = $slice['count'];
		if ( 0 === $count ) {
			continue;
		}

		if ( $offset >= $cursor + $count ) {
			$cursor += $count;
			continue;
		}
		$within = max( 0, $offset - $cursor );
		$take   = min( $remaining, $count - $within );

		$page_args = array_merge(
			$base,
			array(
				'status'   => $slice['statuses'],
				'limit'    => $take,
				'offset'   => $within,
				'paginate' => false,
			)
		);
		$batch     = wc_get_orders( $page_args );
		$batch     = is_object( $batch ) && isset( $batch->orders )
			? (array) $batch->orders
			: (array) $batch;

		$orders     = array_merge( $orders, $batch );
		$remaining -= count( $batch );
		$cursor    += $count;
		$offset     = $cursor;
	}

	$results = (object) array(
		'orders'        => $orders,
		'total'         => $total,
		'max_num_pages' => max( 1, $pages ),
	);

	if ( is_object( $results ) && isset( $results->orders ) ) {
		$orders = (array) $results->orders;
		$total  = isset( $results->total ) ? (int) $results->total : count( $orders );
		$pages  = isset( $results->max_num_pages ) ? (int) $results->max_num_pages : 1;
	} else {
		$orders = (array) $results;
		$total  = count( $orders );
		$pages  = 1;
	}

	$rows    = array();
	$skipped = 0;
	foreach ( $orders as $maybe_order ) {

		$order = is_scalar( $maybe_order ) ? wc_get_order( (int) $maybe_order ) : $maybe_order;

		if ( ! $order instanceof WC_Abstract_Order ) {
			++$skipped;
			continue;
		}
		try {
			$rows[] = openstation_my_wordpress_woo_order_row( $order );
		} catch ( Throwable $e ) {
			++$skipped;

			error_log(
				sprintf(
					'[openstation] Skipped order %d in the site window: %s',
					is_object( $order ) ? (int) $order->get_id() : 0,
					$e->getMessage()
				)
			);
		}
	}

	$response = rest_ensure_response( $rows );
	$response->header( 'X-WP-Total', (string) $total );
	$response->header( 'X-WP-TotalPages', (string) $pages );

	$response->header( 'X-Desktop-Mode-Woo-Rows', (string) count( $rows ) );
	$response->header( 'X-Desktop-Mode-Woo-Skipped', (string) $skipped );
	return $response;
}

function openstation_my_wordpress_woo_order( $request ) {
	$order = wc_get_order( (int) $request['id'] );
	if ( ! $order instanceof WC_Abstract_Order ) {
		return new WP_Error(
			'openstation_woo_no_order',
			__( 'Order not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}
	return rest_ensure_response( openstation_my_wordpress_woo_order_row( $order, true ) );
}

function openstation_my_wordpress_woo_price( $amount, $currency = null ) {
	$args = $currency ? array( 'currency' => $currency ) : array();
	return html_entity_decode(
		wp_strip_all_tags( wc_price( (float) $amount, $args ) ),
		ENT_QUOTES,
		get_bloginfo( 'charset' )
	);
}

function openstation_my_wordpress_woo_product_summary( $id ) {
	$product = wc_get_product( $id );
	if ( ! $product ) {
		return new WP_Error(
			'openstation_woo_no_product',
			__( 'Product not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	$on_sale      = $product->is_on_sale();
	$stock_status = $product->get_stock_status();
	$stock_labels = array(
		'instock'     => __( 'In stock', 'desktop-mode' ),
		'outofstock'  => __( 'Out of stock', 'desktop-mode' ),
		'onbackorder' => __( 'On backorder', 'desktop-mode' ),
	);

	$categories = wp_get_post_terms( $product->get_id(), 'product_cat', array( 'fields' => 'names' ) );

	$types      = function_exists( 'wc_get_product_types' ) ? wc_get_product_types() : array();
	$type       = $product->get_type();
	$type_label = isset( $types[ $type ] ) ? (string) $types[ $type ] : ucfirst( (string) $type );

	return array(
		'type'        => 'product',
		'sku'         => $product->get_sku(),
		'price'       => openstation_my_wordpress_woo_price( $product->get_price() ),
		'regular'     => $on_sale ? openstation_my_wordpress_woo_price( $product->get_regular_price() ) : '',
		'onSale'      => $on_sale,

		'stockStatus' => $stock_status,
		'stockLabel'  => $stock_labels[ $stock_status ] ?? $stock_status,
		'stockLevel'  => $product->managing_stock() ? (int) $product->get_stock_quantity() : null,
		'sold'        => (int) $product->get_total_sales(),
		'rating'      => (float) $product->get_average_rating(),
		'reviews'     => (int) $product->get_review_count(),
		'productType' => $type_label,
		'variations'  => $product->is_type( 'variable' ) ? count( $product->get_children() ) : 0,
		'categories'  => is_wp_error( $categories ) ? array() : array_map( 'openstation_plain_text_title', array_values( $categories ) ),
		'permalink'   => (string) $product->get_permalink(),
		'editUrl'     => (string) get_edit_post_link( $product->get_id(), 'raw' ),
	);
}

function openstation_my_wordpress_woo_order_summary( $id ) {
	$order = wc_get_order( $id );
	if ( ! $order instanceof WC_Abstract_Order ) {
		return new WP_Error(
			'openstation_woo_no_order',
			__( 'Order not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	$statuses = wc_get_order_statuses();
	$status   = 'wc-' . $order->get_status();

	$items = array();
	foreach ( $order->get_items() as $item ) {
		$product_id = method_exists( $item, 'get_product_id' ) ? (int) $item->get_product_id() : 0;

		$edit_id = $product_id;
		$items[] = array(
			'name'     => openstation_plain_text_title( $item->get_name() ),
			'quantity' => (int) $item->get_quantity(),
			'total'    => openstation_my_wordpress_woo_price( $item->get_total(), $order->get_currency() ),
			'id'       => $product_id,

			'editUrl'  => $edit_id && get_post( $edit_id )
				? (string) get_edit_post_link( $edit_id, 'raw' )
				: '',
		);
	}

	$name        = method_exists( $order, 'get_formatted_billing_full_name' )
		? trim( $order->get_formatted_billing_full_name() )
		: '';
	$customer_id = method_exists( $order, 'get_customer_id' )
		? (int) $order->get_customer_id()
		: 0;

	return array(
		'type'        => 'order',
		'number'      => $order->get_order_number(),
		'status'      => $order->get_status(),
		'statusLabel' => $statuses[ $status ] ?? $order->get_status(),
		'total'       => openstation_my_wordpress_woo_price( $order->get_total(), $order->get_currency() ),
		'subtotal'    => openstation_my_wordpress_woo_price( $order->get_subtotal(), $order->get_currency() ),
		'shipping'    => (float) $order->get_shipping_total() > 0
			? openstation_my_wordpress_woo_price( $order->get_shipping_total(), $order->get_currency() )
			: '',
		'discount'    => (float) $order->get_discount_total() > 0
			? openstation_my_wordpress_woo_price( $order->get_discount_total(), $order->get_currency() )
			: '',
		'coupons'     => array_values(
			array_map(
				static function ( $coupon ) {
					return $coupon->get_code();
				},
				$order->get_items( 'coupon' )
			)
		),
		'paymentVia'  => $order->get_payment_method_title(),
		'datePaid'    => $order->get_date_paid() ? $order->get_date_paid()->date( 'c' ) : '',
		'placed'      => $order->get_date_created() ? $order->get_date_created()->date( 'c' ) : '',
		'customer'    => '' !== $name ? $name : __( 'Guest', 'desktop-mode' ),
		'customerUrl' => $customer_id && current_user_can( 'edit_user', $customer_id )
			? (string) get_edit_user_link( $customer_id )
			: '',
		'email'       => $order->get_billing_email(),
		'itemCount'   => $order->get_item_count(),
		'items'       => $items,
		'editUrl'     => method_exists( $order, 'get_edit_order_url' )
			? $order->get_edit_order_url()
			: '',
	);
}

function openstation_my_wordpress_woo_coupon_discount_given( $coupon ) {
	$cache_key = 'openstation_woo_coupon_given_' . $coupon->get_id();
	$cached    = get_transient( $cache_key );
	if ( false !== $cached ) {
		return (float) $cached;
	}

	$granted = 0.0;
	$code    = strtolower( $coupon->get_code() );
	$orders  = wc_get_orders(
		array(
			'limit'  => 500,
			'status' => array( 'wc-processing', 'wc-completed' ),
			'return' => 'objects',
		)
	);
	foreach ( (array) $orders as $maybe_order ) {
		$order = is_scalar( $maybe_order ) ? wc_get_order( (int) $maybe_order ) : $maybe_order;
		if ( ! $order instanceof WC_Abstract_Order ) {
			continue;
		}
		foreach ( $order->get_items( 'coupon' ) as $line ) {
			if ( strtolower( $line->get_code() ) === $code ) {
				$granted += (float) $line->get_discount();
			}
		}
	}

	set_transient( $cache_key, $granted, 5 * MINUTE_IN_SECONDS );

	return $granted;
}

function openstation_my_wordpress_woo_coupon_summary( $id ) {
	$coupon = new WC_Coupon( $id );
	if ( ! $coupon->get_id() ) {
		return new WP_Error(
			'openstation_woo_no_coupon',
			__( 'Coupon not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	$expiry = $coupon->get_date_expires();
	$limit  = (int) $coupon->get_usage_limit();
	$used   = (int) $coupon->get_usage_count();

	$expired = $expiry && $expiry->getTimestamp() < time();
	$used_up = $limit > 0 && $used >= $limit;

	$type_label = 'percent' === $coupon->get_discount_type()
		? sprintf(

			__( '%s%% off', 'desktop-mode' ),
			wc_format_localized_decimal( $coupon->get_amount() )
		)
		: sprintf(

			__( '%s off', 'desktop-mode' ),
			openstation_my_wordpress_woo_price( $coupon->get_amount() )
		);

	$link_terms = static function ( array $ids, $taxonomy ) {
		$out = array();
		foreach ( $ids as $id ) {
			$term = get_term( (int) $id, $taxonomy );
			if ( $term && ! is_wp_error( $term ) ) {
				$out[] = array(
					'label'   => openstation_plain_text_title( $term->name ),
					'editUrl' => (string) get_edit_term_link( $term->term_id, $taxonomy ),
				);
			}
		}
		return $out;
	};

	$link_products = static function ( array $ids ) {
		$out = array();
		foreach ( $ids as $id ) {
			$product = wc_get_product( (int) $id );
			if ( $product ) {
				$out[] = array(
					'label'   => openstation_plain_text_title( $product->get_name() ),
					'editUrl' => (string) get_edit_post_link( $product->get_id(), 'raw' ),
				);
			}
		}
		return $out;
	};

	$granted = openstation_my_wordpress_woo_coupon_discount_given( $coupon );

	return array(
		'type'          => 'coupon',
		'code'          => $coupon->get_code(),
		'active'        => ! $expired && ! $used_up,
		'inactiveWhy'   => $expired
			? __( 'Expired', 'desktop-mode' )
			: ( $used_up ? __( 'Usage limit reached', 'desktop-mode' ) : '' ),
		'discount'      => $type_label,
		'description'   => $coupon->get_description(),
		'used'          => $used,
		'usageLimit'    => $limit,
		'perUserLimit'  => (int) $coupon->get_usage_limit_per_user(),
		'limitToItems'  => (int) $coupon->get_limit_usage_to_x_items(),
		'granted'       => $granted > 0 ? openstation_my_wordpress_woo_price( $granted ) : '',
		'created'       => $coupon->get_date_created() ? $coupon->get_date_created()->date( 'c' ) : '',
		'expires'       => $expiry ? $expiry->date( 'c' ) : '',
		'minSpend'      => $coupon->get_minimum_amount()
			? openstation_my_wordpress_woo_price( $coupon->get_minimum_amount() )
			: '',
		'maxSpend'      => $coupon->get_maximum_amount()
			? openstation_my_wordpress_woo_price( $coupon->get_maximum_amount() )
			: '',
		'freeShipping'  => (bool) $coupon->get_free_shipping(),
		'individualUse' => (bool) $coupon->get_individual_use(),
		'excludeSale'   => (bool) $coupon->get_exclude_sale_items(),
		'products'      => $link_products( (array) $coupon->get_product_ids() ),
		'excluded'      => $link_products( (array) $coupon->get_excluded_product_ids() ),
		'categories'    => $link_terms( (array) $coupon->get_product_categories(), 'product_cat' ),
		'emails'        => array_values( (array) $coupon->get_email_restrictions() ),
		'editUrl'       => (string) get_edit_post_link( $coupon->get_id(), 'raw' ),
	);
}

function openstation_my_wordpress_woo_summary( $request ) {
	$type = (string) $request['type'];
	$id   = (int) $request['id'];

	switch ( $type ) {
		case 'product':
			$data = openstation_my_wordpress_woo_product_summary( $id );
			break;
		case 'order':
			$data = openstation_my_wordpress_woo_order_summary( $id );
			break;
		case 'coupon':
			$data = openstation_my_wordpress_woo_coupon_summary( $id );
			break;
		default:

			$data = apply_filters( 'openstation_my_wordpress_woo_summary_type', null, $type, $id );

			if ( ! is_array( $data ) && ! is_wp_error( $data ) ) {
				return new WP_Error(
					'openstation_woo_bad_type',
					__( 'Unknown summary type.', 'desktop-mode' ),
					array( 'status' => 400 )
				);
			}
			break;
	}

	if ( is_wp_error( $data ) ) {
		return $data;
	}

	return rest_ensure_response(
		(array) apply_filters( 'openstation_my_wordpress_woo_summary', $data, $type, $id )
	);
}

function openstation_my_wordpress_woo_summary_permission( $request ) {
	$type = (string) $request['type'];
	$id   = (int) $request['id'];

	if ( 'order' === $type ) {
		return openstation_my_wordpress_woo_orders_permission();
	}

	$allowed = apply_filters( 'openstation_my_wordpress_woo_summary_capability', null, $type, $id );
	if ( true === $allowed || is_wp_error( $allowed ) ) {
		return $allowed;
	}

	if ( ! current_user_can( 'edit_post', $id ) ) {
		return new WP_Error(
			'openstation_woo_forbidden',
			__( 'Sorry, you are not allowed to view this item.', 'desktop-mode' ),
			array( 'status' => rest_authorization_required_code() )
		);
	}
	return true;
}

function openstation_my_wordpress_woo_store() {
	$month_start = gmdate( 'Y-m-01 00:00:00', current_time( 'timestamp' ) );

	$paid = wc_get_orders(
		array(
			'limit'        => -1,
			'status'       => array( 'wc-processing', 'wc-completed' ),
			'date_created' => '>=' . $month_start,
			'return'       => 'objects',
		)
	);

	$revenue = 0.0;
	foreach ( (array) $paid as $maybe_order ) {
		$order = is_scalar( $maybe_order ) ? wc_get_order( (int) $maybe_order ) : $maybe_order;
		if ( $order instanceof WC_Abstract_Order ) {
			$revenue += (float) $order->get_total();
		}
	}

	$attention = array();
	foreach ( openstation_my_wordpress_woo_order_bands() as $band ) {
		if ( 'needs-action' === ( $band['id'] ?? '' ) ) {
			$attention = array_map(
				static function ( $status ) {
					return 'wc-' . $status;
				},
				(array) ( $band['statuses'] ?? array() )
			);
			break;
		}
	}
	if ( empty( $attention ) ) {
		$attention = array( 'wc-processing', 'wc-on-hold', 'wc-pending' );
	}

	$processing = wc_get_orders(
		array(
			'limit'    => 1,
			'paginate' => true,
			'return'   => 'ids',
			'status'   => $attention,
		)
	);

	$low_stock = wc_get_products(
		array(
			'limit'        => -1,
			'return'       => 'ids',
			'stock_status' => 'outofstock',
		)
	);

	$data = array(
		'revenue'    => openstation_my_wordpress_woo_price( $revenue ),
		'revenueRaw' => round( $revenue, 2 ),
		'processing' => isset( $processing->total ) ? (int) $processing->total : 0,
		'outOfStock' => is_array( $low_stock ) ? count( $low_stock ) : 0,
		'ordersUrl'  => admin_url( 'admin.php?page=wc-orders' ),
	);

	return rest_ensure_response(
		(array) apply_filters( 'openstation_my_wordpress_woo_store', $data )
	);
}

function openstation_my_wordpress_woo_register_routes() {
	if ( ! openstation_my_wordpress_woo_active() ) {
		return;
	}

	register_rest_route(
		'desktop-mode/v1',
		'/woocommerce/orders',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'openstation_my_wordpress_woo_orders',
			'permission_callback' => 'openstation_my_wordpress_woo_orders_permission',
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
		'/woocommerce/orders/(?P<id>\d+)',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'openstation_my_wordpress_woo_order',
			'permission_callback' => 'openstation_my_wordpress_woo_orders_permission',
			'args'                => array(
				'id' => array( 'type' => 'integer' ),
			),
		)
	);

	register_rest_route(
		'desktop-mode/v1',
		'/woocommerce/summary/(?P<type>[a-z]+)/(?P<id>\d+)',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'openstation_my_wordpress_woo_summary',
			'permission_callback' => 'openstation_my_wordpress_woo_summary_permission',
			'args'                => array(
				'type' => array( 'type' => 'string' ),
				'id'   => array( 'type' => 'integer' ),
			),
		)
	);

	register_rest_route(
		'desktop-mode/v1',
		'/woocommerce/store',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'openstation_my_wordpress_woo_store',
			'permission_callback' => 'openstation_my_wordpress_woo_orders_permission',
		)
	);
}
add_action( 'rest_api_init', 'openstation_my_wordpress_woo_register_routes' );

function openstation_my_wordpress_woo_register_assets() {
	$js_path = OPENSTATION_DIR . 'assets/js/my-wordpress-woocommerce' . openstation_asset_suffix() . '.js';
	wp_register_script(
		'os-my-wordpress-woocommerce',
		OPENSTATION_URL . 'assets/js/my-wordpress-woocommerce' . openstation_asset_suffix() . '.js',
		array( 'wp-hooks' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : OPENSTATION_VERSION,
		true
	);
	wp_set_script_translations( 'os-my-wordpress-woocommerce', 'desktop-mode' );

	$css_path = OPENSTATION_DIR . 'assets/css/my-wordpress-woocommerce.css';
	wp_register_style(
		'os-my-wordpress-woocommerce',
		OPENSTATION_URL . 'assets/css/my-wordpress-woocommerce.css',
		array( 'desktop-mode-my-wordpress' ),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : OPENSTATION_VERSION
	);
}
add_action( 'init', 'openstation_my_wordpress_woo_register_assets', 5 );

function openstation_my_wordpress_woo_enqueue() {
	if ( ! openstation_my_wordpress_woo_active() ) {
		return;
	}
	if ( ! function_exists( 'openstation_is_enabled' ) || ! openstation_is_enabled() ) {
		return;
	}
	if ( ! openstation_my_wordpress_user_can_use() ) {
		return;
	}

	wp_add_inline_script(
		'os-my-wordpress-woocommerce',
		sprintf(
			'window.openStationWooConfig=%s;',
			wp_json_encode(
				array(
					'restRoot'      => esc_url_raw( rest_url( 'desktop-mode/v1/woocommerce/' ) ),
					'restNonce'     => wp_create_nonce( 'wp_rest' ),
					'canOrders'     => true === openstation_my_wordpress_woo_orders_permission(),
					'canCustomers'  => true === openstation_my_wordpress_woo_customers_permission(),
					'orderBands'    => openstation_my_wordpress_woo_order_bands(),

					'orderStatuses' => wc_get_order_statuses(),
					'productBands'  => openstation_my_wordpress_woo_product_bands(),
					'couponBands'   => openstation_my_wordpress_woo_coupon_bands_with_counts(),

					'customerBands' => true === openstation_my_wordpress_woo_customers_permission()
						? openstation_my_wordpress_woo_customer_bands_with_counts()
						: array(),

					'ordering'      => openstation_my_wordpress_woo_ordering_state(),
				)
			)
		),
		'before'
	);
}
add_action( 'admin_enqueue_scripts', 'openstation_my_wordpress_woo_enqueue', 5 );

function openstation_my_wordpress_woo_app_window_args( $window_args, $app_id ) {
	if ( 'my-wordpress' !== (string) $app_id || ! is_array( $window_args ) || ! openstation_my_wordpress_woo_active() ) {
		return $window_args;
	}

	$scripts   = isset( $window_args['scripts'] ) ? (array) $window_args['scripts'] : array();
	$scripts[] = 'os-my-wordpress-woocommerce';

	$styles   = isset( $window_args['styles'] ) ? (array) $window_args['styles'] : array();
	$styles[] = 'os-my-wordpress-woocommerce';

	$window_args['scripts'] = $scripts;
	$window_args['styles']  = $styles;

	return $window_args;
}
add_filter( 'openstation_app_window_args', 'openstation_my_wordpress_woo_app_window_args', 10, 2 );
