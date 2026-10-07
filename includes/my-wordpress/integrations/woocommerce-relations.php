<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_WOO_RELATION_ITEM_CAP = 20;

const OPENSTATION_WOO_RELATION_ORDER_CAP = 10;

const OPENSTATION_WOO_RELATION_ORDER_CANDIDATES = 40;

const OPENSTATION_PERSON_VIEW_PARAM = 'os_person_view';

function openstation_my_wordpress_woo_current_order() {
	if ( ! openstation_my_wordpress_woo_active() ) {
		return null;
	}

	$pagenow = isset( $GLOBALS['pagenow'] ) ? (string) $GLOBALS['pagenow'] : '';

	$id = 0;
	if ( 'admin.php' === $pagenow ) {

		$page = isset( $_GET['page'] ) ? sanitize_key( wp_unslash( $_GET['page'] ) ) : '';
		if ( 0 !== strpos( $page, 'wc-orders' ) ) {
			return null;
		}
		$action = isset( $_GET['action'] ) ? sanitize_key( wp_unslash( $_GET['action'] ) ) : '';
		if ( 'edit' !== $action ) {
			return null;
		}
		$id = isset( $_GET['id'] ) ? absint( $_GET['id'] ) : 0;
	} elseif ( 'post.php' === $pagenow ) {

		$id = isset( $_GET['post'] ) ? absint( $_GET['post'] ) : 0;
		if ( $id > 0 && 'shop_order' !== get_post_type( $id ) ) {
			return null;
		}
	}

	if ( $id <= 0 ) {
		return null;
	}

	$order = wc_get_order( $id );

	return $order instanceof WC_Abstract_Order ? $order : null;
}

function openstation_my_wordpress_woo_can_read_orders() {
	return true === openstation_my_wordpress_woo_orders_permission();
}

function openstation_my_wordpress_woo_is_purchase( $order ) {
	if ( ! $order instanceof WC_Abstract_Order ) {
		return false;
	}
	if ( $order instanceof WC_Order_Refund ) {
		return false;
	}
	return method_exists( $order, 'get_order_number' );
}

function openstation_my_wordpress_woo_reviews_identity() {
	$pagenow = isset( $GLOBALS['pagenow'] ) ? (string) $GLOBALS['pagenow'] : '';
	if ( 'edit.php' !== $pagenow ) {
		return null;
	}

	$page = isset( $_GET['page'] ) ? sanitize_key( wp_unslash( $_GET['page'] ) ) : '';
	if ( 'product-reviews' !== $page ) {
		return null;
	}
	$product_id = isset( $_GET['product_id'] ) ? absint( $_GET['product_id'] ) : 0;

	if ( $product_id <= 0 || 'product' !== get_post_type( $product_id ) ) {
		return null;
	}
	if ( ! current_user_can( 'edit_post', $product_id ) ) {
		return null;
	}

	return array(
		'type'  => 'reviews',
		'id'    => $product_id,

		'label' => sprintf( __( 'Reviews of %s', 'desktop-mode' ), get_the_title( $product_id ) ),
		'root'  => array(
			'type' => 'product',
			'id'   => $product_id,
		),
	);
}

function openstation_my_wordpress_woo_order_refs( $order ) {
	$links = array();
	$seen  = array();

	$push = static function ( $type, $id ) use ( &$links, &$seen ) {
		$id  = (int) $id;
		$key = $type . ':' . $id;
		if ( $id <= 0 || isset( $seen[ $key ] ) || count( $links ) >= 64 ) {
			return;
		}
		$seen[ $key ] = true;
		$links[]      = array(
			'type' => $type,
			'id'   => $id,
		);
	};

	$customer_id = method_exists( $order, 'get_customer_id' ) ? (int) $order->get_customer_id() : 0;
	if ( $customer_id > 0 ) {
		$push( 'user', $customer_id );
	}

	$items = 0;
	foreach ( $order->get_items() as $item ) {
		if ( $items >= OPENSTATION_WOO_RELATION_ITEM_CAP ) {
			break;
		}
		$product_id = method_exists( $item, 'get_product_id' ) ? (int) $item->get_product_id() : 0;
		if ( $product_id > 0 && 'product' === get_post_type( $product_id ) ) {
			$push( 'product', $product_id );
			++$items;
		}
	}

	$coupons = 0;
	foreach ( $order->get_items( 'coupon' ) as $line ) {
		if ( $coupons >= OPENSTATION_WOO_RELATION_ITEM_CAP ) {
			break;
		}
		$coupon = new WC_Coupon( $line->get_code() );
		if ( $coupon->get_id() ) {
			$push( 'shop_coupon', $coupon->get_id() );
			++$coupons;
		}
	}

	return $links;
}

function openstation_my_wordpress_woo_coupon_refs( $coupon ) {
	$links = array();

	foreach ( array_slice( (array) $coupon->get_product_ids(), 0, OPENSTATION_WOO_RELATION_ITEM_CAP ) as $product_id ) {
		$product_id = (int) $product_id;
		if ( $product_id > 0 && 'product' === get_post_type( $product_id ) ) {
			$links[] = array(
				'type' => 'product',
				'id'   => $product_id,
			);
		}
	}

	foreach ( array_slice( (array) $coupon->get_product_categories(), 0, OPENSTATION_WOO_RELATION_ITEM_CAP ) as $term_id ) {
		$term_id = (int) $term_id;
		$term    = $term_id ? get_term( $term_id, 'product_cat' ) : null;
		if ( $term instanceof WP_Term ) {
			$links[] = array(
				'type' => 'term/product_cat',
				'id'   => $term_id,
			);
		}
	}

	return $links;
}

function openstation_my_wordpress_woo_order_title( $order ) {
	$name = method_exists( $order, 'get_formatted_billing_full_name' )
		? trim( $order->get_formatted_billing_full_name() )
		: '';

	if ( '' !== $name ) {
		return sprintf(

			__( 'Order #%1$s · %2$s', 'desktop-mode' ),
			$order->get_order_number(),
			$name
		);
	}

	return sprintf(

		__( 'Order #%s', 'desktop-mode' ),
		$order->get_order_number()
	);
}

function openstation_my_wordpress_woo_content_identity( $identity, $screen ) {
	unset( $screen );
	if ( ! openstation_my_wordpress_woo_active() ) {
		return $identity;
	}

	$order = openstation_my_wordpress_woo_current_order();
	if ( $order && openstation_my_wordpress_woo_can_read_orders() ) {
		$identity = array(
			'type'  => 'shop_order',
			'id'    => (int) $order->get_id(),
			'label' => openstation_my_wordpress_woo_order_title( $order ),
		);

		$links = openstation_my_wordpress_woo_order_refs( $order );
		if ( ! empty( $links ) ) {
			$identity['links'] = $links;
		}

		return $identity;
	}

	$reviews_identity = openstation_my_wordpress_woo_reviews_identity();
	if ( $reviews_identity ) {
		return $reviews_identity;
	}

	if ( is_array( $identity ) && 'shop_coupon' === ( $identity['type'] ?? '' ) ) {
		$coupon = new WC_Coupon( (int) $identity['id'] );
		if ( $coupon->get_id() ) {
			$links = openstation_my_wordpress_woo_coupon_refs( $coupon );
			if ( ! empty( $links ) ) {
				$identity['links'] = array_merge(
					(array) ( $identity['links'] ?? array() ),
					$links
				);
			}
		}
	}

	return $identity;
}

function openstation_my_wordpress_woo_related_item( $id, $group, $group_label, $label, $icon, $url, $count = 0 ) {
	$item = array(
		'id'         => $id,
		'group'      => $group,
		'groupLabel' => $group_label,
		'label'      => $label,
		'icon'       => $icon,
		'url'        => $url,
	);
	if ( $count > 0 ) {
		$item['count'] = (int) $count;
	}

	return $item;
}

function openstation_my_wordpress_woo_order_related( $order ) {
	$related = array();

	$customer_id = method_exists( $order, 'get_customer_id' ) ? (int) $order->get_customer_id() : 0;
	if ( $customer_id > 0 ) {
		$user = get_userdata( $customer_id );
		if ( $user instanceof WP_User ) {
			$label = $user->display_name ? $user->display_name : $user->user_login;

			if ( current_user_can( 'edit_user', $customer_id ) ) {

				$related[] = openstation_my_wordpress_woo_related_item(
					'wc-customer-' . $customer_id,
					'wc-customer',
					__( 'Customer', 'desktop-mode' ),
					$label,
					'dashicons-businessperson',
					add_query_arg(
						OPENSTATION_PERSON_VIEW_PARAM,
						'wc-customer',
						(string) get_edit_user_link( $customer_id )
					)
				);

				$related[] = openstation_my_wordpress_woo_related_item(
					'wc-customer-profile-' . $customer_id,
					'wc-customer',
					__( 'Customer', 'desktop-mode' ),
					__( 'Edit profile', 'desktop-mode' ),
					'dashicons-admin-users',
					(string) get_edit_user_link( $customer_id )
				);
			}

			$map    = function_exists( 'openstation_my_wordpress_woo_customer_spend_map' )
				? openstation_my_wordpress_woo_customer_spend_map()
				: array();
			$orders = (int) ( $map[ $customer_id ]['orders'] ?? 0 );
			if ( $orders > 1 && function_exists( 'openstation_my_wordpress_woo_customer_orders_url' ) ) {
				$related[] = openstation_my_wordpress_woo_related_item(
					'wc-customer-orders-' . $customer_id,
					'wc-customer',
					__( 'Customer', 'desktop-mode' ),
					__( 'All orders by this customer', 'desktop-mode' ),
					'dashicons-cart',
					openstation_my_wordpress_woo_customer_orders_url( $customer_id ),
					$orders
				);
			}
		}
	}

	$items = 0;
	foreach ( $order->get_items() as $item ) {
		if ( $items >= OPENSTATION_WOO_RELATION_ITEM_CAP ) {
			break;
		}
		$product_id = method_exists( $item, 'get_product_id' ) ? (int) $item->get_product_id() : 0;
		if ( $product_id <= 0 || ! get_post( $product_id ) ) {

			continue;
		}
		if ( ! current_user_can( 'edit_post', $product_id ) ) {
			continue;
		}
		$related[] = openstation_my_wordpress_woo_related_item(
			'wc-product-' . $product_id,
			'wc-products',
			__( 'Products', 'desktop-mode' ),
			$item->get_name(),
			'dashicons-products',
			(string) get_edit_post_link( $product_id, 'raw' ),
			(int) $item->get_quantity()
		);
		++$items;
	}

	$coupons = 0;
	foreach ( $order->get_items( 'coupon' ) as $line ) {
		if ( $coupons >= OPENSTATION_WOO_RELATION_ITEM_CAP ) {
			break;
		}
		$coupon = new WC_Coupon( $line->get_code() );
		if ( ! $coupon->get_id() || ! current_user_can( 'edit_post', $coupon->get_id() ) ) {
			continue;
		}
		$related[] = openstation_my_wordpress_woo_related_item(
			'wc-coupon-' . $coupon->get_id(),
			'wc-coupons',
			__( 'Coupons', 'desktop-mode' ),
			$coupon->get_code(),
			'dashicons-tickets-alt',
			(string) get_edit_post_link( $coupon->get_id(), 'raw' )
		);
		++$coupons;
	}

	return $related;
}

function openstation_my_wordpress_woo_orders_with_product( $product_id, $limit = 10 ) {
	global $wpdb;

	$product_id = (int) $product_id;
	$limit      = max( 1, (int) $limit );

	if ( $product_id <= 0 || ! openstation_my_wordpress_woo_active() ) {
		return array();
	}

	$items    = $wpdb->prefix . 'woocommerce_order_items';
	$itemmeta = $wpdb->prefix . 'woocommerce_order_itemmeta';

	$sql = $wpdb->prepare(
		"SELECT DISTINCT oi.order_id
		FROM {$items} oi
		INNER JOIN {$itemmeta} oim ON oim.order_item_id = oi.order_item_id
		WHERE oi.order_item_type = 'line_item'
			AND oim.meta_key IN ( '_product_id', '_variation_id' )
			AND oim.meta_value = %d
		ORDER BY oi.order_id DESC
		LIMIT %d",
		$product_id,
		$limit
	);

	$ids = $wpdb->get_col( $sql );

	return array_map( 'intval', (array) $ids );
}

function openstation_my_wordpress_woo_coupons_for_product( $product_id, $limit = 8 ) {
	global $wpdb;

	$product_id = (int) $product_id;
	if ( $product_id <= 0 ) {
		return array();
	}

	$category_ids = wp_get_post_terms( $product_id, 'product_cat', array( 'fields' => 'ids' ) );
	$category_ids = is_wp_error( $category_ids ) ? array() : array_map( 'intval', $category_ids );

	$sql = "SELECT pm.post_id, pm.meta_key, pm.meta_value
		FROM {$wpdb->postmeta} pm
		INNER JOIN {$wpdb->posts} p ON p.ID = pm.post_id
		WHERE p.post_type = 'shop_coupon'
			AND p.post_status = 'publish'
			AND pm.meta_key IN ( 'product_ids', 'product_categories' )
		LIMIT 400";

	$rows = $wpdb->get_results( $sql );

	$matched = array();
	foreach ( (array) $rows as $row ) {
		if ( count( $matched ) >= $limit ) {
			break;
		}
		$values = array_filter( array_map( 'intval', explode( ',', (string) $row->meta_value ) ) );
		if ( empty( $values ) ) {
			continue;
		}
		$hit = 'product_ids' === $row->meta_key
			? in_array( $product_id, $values, true )
			: ( ! empty( array_intersect( $category_ids, $values ) ) );
		if ( $hit ) {
			$matched[ (int) $row->post_id ] = true;
		}
	}

	return array_map( 'intval', array_keys( $matched ) );
}

function openstation_my_wordpress_woo_product_related( $product_id ) {
	$related = array();
	$product = wc_get_product( $product_id );
	if ( ! $product ) {
		return $related;
	}

	foreach ( array( 'product_cat', 'product_tag' ) as $taxonomy ) {
		$tax = get_taxonomy( $taxonomy );
		if ( ! $tax ) {
			continue;
		}
		$terms = get_the_terms( $product_id, $taxonomy );
		if ( ! is_array( $terms ) ) {
			continue;
		}
		foreach ( array_slice( $terms, 0, 10 ) as $term ) {
			$related[] = openstation_my_wordpress_woo_related_item(
				'wc-term-' . $taxonomy . '-' . (int) $term->term_id,
				'terms/' . $taxonomy,
				(string) $tax->labels->name,
				$term->name,
				'product_cat' === $taxonomy ? 'dashicons-category' : 'dashicons-tag',
				admin_url(
					'term.php?taxonomy=' . rawurlencode( $taxonomy ) . '&tag_ID=' . (int) $term->term_id . '&post_type=product'
				)
			);
		}
	}

	$reviews = (int) $product->get_review_count();
	if ( $reviews > 0 && current_user_can( 'moderate_comments' ) ) {
		$related[] = openstation_my_wordpress_woo_related_item(
			'wc-reviews-' . $product_id,
			'wc-reviews',
			__( 'Reviews', 'desktop-mode' ),
			__( 'Reviews', 'desktop-mode' ),
			'dashicons-star-filled',
			admin_url( 'edit.php?post_type=product&page=product-reviews&product_id=' . (int) $product_id ),
			$reviews
		);
	}

	if ( $product->is_type( 'variable' ) ) {
		$children = count( $product->get_children() );
		if ( $children > 0 ) {
			$related[] = openstation_my_wordpress_woo_related_item(
				'wc-variations-' . $product_id,
				'wc-products',
				__( 'Product', 'desktop-mode' ),
				__( 'Variations', 'desktop-mode' ),
				'dashicons-networking',
				(string) get_edit_post_link( $product_id, 'raw' ) . '#variable_product_options',
				$children
			);
		}
	}

	if ( openstation_my_wordpress_woo_can_read_orders() ) {
		$customers = array();
		$listed    = 0;
		foreach ( openstation_my_wordpress_woo_orders_with_product( $product_id, OPENSTATION_WOO_RELATION_ORDER_CANDIDATES ) as $order_id ) {
			if ( $listed >= OPENSTATION_WOO_RELATION_ORDER_CAP ) {
				break;
			}
			$order = wc_get_order( $order_id );
			if ( ! openstation_my_wordpress_woo_is_purchase( $order ) ) {
				continue;
			}
			++$listed;

			$name  = method_exists( $order, 'get_formatted_billing_full_name' )
				? trim( $order->get_formatted_billing_full_name() )
				: '';
			$total = openstation_my_wordpress_woo_price(
				$order->get_total(),
				$order->get_currency()
			);

			$related[] = openstation_my_wordpress_woo_related_item(
				'wc-order-' . $order_id,
				'wc-orders',
				__( 'Orders', 'desktop-mode' ),
				'' !== $name
					? sprintf(

						__( '#%1$s · %2$s · %3$s', 'desktop-mode' ),
						$order->get_order_number(),
						$name,
						$total
					)
					: sprintf(

						__( '#%1$s · %2$s', 'desktop-mode' ),
						$order->get_order_number(),
						$total
					),
				'dashicons-cart',
				method_exists( $order, 'get_edit_order_url' )
					? (string) $order->get_edit_order_url()
					: ''
			);

			$customer_id = method_exists( $order, 'get_customer_id' )
				? (int) $order->get_customer_id()
				: 0;
			if ( $customer_id > 0 && ! isset( $customers[ $customer_id ] ) ) {
				$customers[ $customer_id ] = true;
			}
		}

		$shown = 0;
		foreach ( array_keys( $customers ) as $customer_id ) {
			if ( $shown >= 8 ) {
				break;
			}
			$user = get_userdata( (int) $customer_id );
			if ( ! $user instanceof WP_User || ! current_user_can( 'edit_user', $user->ID ) ) {
				continue;
			}
			$related[] = openstation_my_wordpress_woo_related_item(
				'wc-buyer-' . (int) $customer_id,
				'wc-customer',
				__( 'Customers', 'desktop-mode' ),
				$user->display_name ? $user->display_name : $user->user_login,
				'dashicons-businessperson',

				add_query_arg(
					OPENSTATION_PERSON_VIEW_PARAM,
					'wc-customer',
					(string) get_edit_user_link( $user->ID )
				)
			);
			++$shown;
		}
	}

	foreach ( openstation_my_wordpress_woo_coupons_for_product( $product_id, 8 ) as $coupon_id ) {
		if ( ! current_user_can( 'edit_post', $coupon_id ) ) {
			continue;
		}
		$coupon = new WC_Coupon( $coupon_id );
		if ( ! $coupon->get_id() ) {
			continue;
		}
		$related[] = openstation_my_wordpress_woo_related_item(
			'wc-product-coupon-' . $coupon_id,
			'wc-coupons',
			__( 'Coupons', 'desktop-mode' ),
			$coupon->get_code(),
			'dashicons-tickets-alt',
			(string) get_edit_post_link( $coupon_id, 'raw' )
		);
	}

	return $related;
}

function openstation_my_wordpress_woo_orders_with_coupon( $code, $limit = 10 ) {
	global $wpdb;

	$code = strtolower( trim( (string) $code ) );

	if ( '' === $code || ! openstation_my_wordpress_woo_active() ) {
		return array();
	}

	$items = $wpdb->prefix . 'woocommerce_order_items';

	$sql = $wpdb->prepare(
		"SELECT DISTINCT order_id
		FROM {$items}
		WHERE order_item_type = 'coupon' AND LOWER( order_item_name ) = %s
		ORDER BY order_id DESC
		LIMIT %d",
		$code,
		max( 1, (int) $limit )
	);

	$ids = $wpdb->get_col( $sql );

	return array_map( 'intval', (array) $ids );
}

function openstation_my_wordpress_woo_coupon_related( $coupon_id ) {
	$related = array();
	$coupon  = new WC_Coupon( (int) $coupon_id );
	if ( ! $coupon->get_id() ) {
		return $related;
	}

	foreach ( array_slice( (array) $coupon->get_product_ids(), 0, OPENSTATION_WOO_RELATION_ITEM_CAP ) as $product_id ) {
		$product = wc_get_product( (int) $product_id );
		if ( ! $product || ! current_user_can( 'edit_post', (int) $product_id ) ) {
			continue;
		}
		$related[] = openstation_my_wordpress_woo_related_item(
			'wc-coupon-product-' . (int) $product_id,
			'wc-products',
			__( 'Applies to', 'desktop-mode' ),
			$product->get_name(),
			'dashicons-products',
			(string) get_edit_post_link( (int) $product_id, 'raw' )
		);
	}

	foreach ( array_slice( (array) $coupon->get_product_categories(), 0, OPENSTATION_WOO_RELATION_ITEM_CAP ) as $term_id ) {
		$term = get_term( (int) $term_id, 'product_cat' );
		if ( ! $term instanceof WP_Term ) {
			continue;
		}
		$related[] = openstation_my_wordpress_woo_related_item(
			'wc-coupon-cat-' . (int) $term_id,
			'terms/product_cat',
			__( 'Applies to', 'desktop-mode' ),
			$term->name,
			'dashicons-category',
			admin_url( 'term.php?taxonomy=product_cat&tag_ID=' . (int) $term_id . '&post_type=product' )
		);
	}

	if ( openstation_my_wordpress_woo_can_read_orders() ) {
		$customers = array();
		$listed    = 0;
		foreach ( openstation_my_wordpress_woo_orders_with_coupon( $coupon->get_code(), OPENSTATION_WOO_RELATION_ORDER_CANDIDATES ) as $order_id ) {
			if ( $listed >= OPENSTATION_WOO_RELATION_ORDER_CAP ) {
				break;
			}
			$order = wc_get_order( $order_id );
			if ( ! openstation_my_wordpress_woo_is_purchase( $order ) ) {
				continue;
			}
			++$listed;

			$name  = method_exists( $order, 'get_formatted_billing_full_name' )
				? trim( $order->get_formatted_billing_full_name() )
				: '';
			$total = openstation_my_wordpress_woo_price(
				$order->get_total(),
				$order->get_currency()
			);

			$related[] = openstation_my_wordpress_woo_related_item(
				'wc-coupon-order-' . $order_id,
				'wc-orders',
				__( 'Used on', 'desktop-mode' ),
				'' !== $name
					? sprintf(

						__( '#%1$s · %2$s · %3$s', 'desktop-mode' ),
						$order->get_order_number(),
						$name,
						$total
					)
					: sprintf(

						__( '#%1$s · %2$s', 'desktop-mode' ),
						$order->get_order_number(),
						$total
					),
				'dashicons-cart',
				method_exists( $order, 'get_edit_order_url' )
					? (string) $order->get_edit_order_url()
					: ''
			);

			$customer_id = method_exists( $order, 'get_customer_id' )
				? (int) $order->get_customer_id()
				: 0;
			if ( $customer_id > 0 ) {
				$customers[ $customer_id ] = true;
			}
		}

		$shown = 0;
		foreach ( array_keys( $customers ) as $customer_id ) {
			if ( $shown >= 8 ) {
				break;
			}
			$user = get_userdata( (int) $customer_id );
			if ( ! $user instanceof WP_User || ! current_user_can( 'edit_user', $user->ID ) ) {
				continue;
			}
			$related[] = openstation_my_wordpress_woo_related_item(
				'wc-coupon-buyer-' . (int) $customer_id,
				'wc-customer',
				__( 'Customers', 'desktop-mode' ),
				$user->display_name ? $user->display_name : $user->user_login,
				'dashicons-businessperson',

				add_query_arg(
					OPENSTATION_PERSON_VIEW_PARAM,
					'wc-customer',
					(string) get_edit_user_link( $user->ID )
				)
			);
			++$shown;
		}
	}

	return $related;
}

function openstation_my_wordpress_woo_user_related( $user_id ) {
	if (
		! function_exists( 'openstation_my_wordpress_woo_customer_spend_map' )
		|| true !== openstation_my_wordpress_woo_customers_permission()
	) {
		return array();
	}

	$map    = openstation_my_wordpress_woo_customer_spend_map();
	$stats  = $map[ (int) $user_id ] ?? null;
	$orders = $stats ? (int) $stats['orders'] : 0;
	if ( $orders <= 0 ) {
		return array();
	}

	return array(
		openstation_my_wordpress_woo_related_item(
			'wc-user-orders-' . (int) $user_id,
			'wc-orders',
			__( 'Store', 'desktop-mode' ),
			__( 'Orders', 'desktop-mode' ),
			'dashicons-cart',
			openstation_my_wordpress_woo_customer_orders_url( (int) $user_id ),
			$orders
		),
	);
}

function openstation_my_wordpress_woo_related_entities( $related, $identity, $screen ) {
	unset( $screen );
	if ( ! openstation_my_wordpress_woo_active() || ! is_array( $identity ) ) {
		return $related;
	}

	$type = (string) ( $identity['type'] ?? '' );
	$id   = (int) ( $identity['id'] ?? 0 );
	if ( $id <= 0 ) {
		return $related;
	}

	if ( 'shop_order' === $type && openstation_my_wordpress_woo_can_read_orders() ) {
		$order = wc_get_order( $id );
		if ( $order instanceof WC_Abstract_Order ) {
			$related = array_merge( (array) $related, openstation_my_wordpress_woo_order_related( $order ) );
		}
	} elseif ( 'product' === $type ) {
		$related = array_merge( (array) $related, openstation_my_wordpress_woo_product_related( $id ) );
	} elseif ( 'shop_coupon' === $type ) {
		$related = array_merge( (array) $related, openstation_my_wordpress_woo_coupon_related( $id ) );
	} elseif ( 'user' === $type ) {
		$related = array_merge( (array) $related, openstation_my_wordpress_woo_user_related( $id ) );
	}

	return $related;
}

function openstation_my_wordpress_woo_order_window_title() {
	if ( ! openstation_my_wordpress_woo_active() || ! openstation_my_wordpress_woo_can_read_orders() ) {
		return;
	}

	$order = openstation_my_wordpress_woo_current_order();
	if ( ! $order ) {
		return;
	}

	$title_json = wp_json_encode(
		openstation_my_wordpress_woo_order_title( $order ),
		JSON_HEX_TAG | JSON_UNESCAPED_SLASHES
	);
	if ( false === $title_json ) {
		return;
	}
	wp_print_inline_script_tag(
		'window.parent.postMessage({type:"os-title-change",title:' . $title_json . '},window.location.origin);'
	);
}

function openstation_my_wordpress_woo_relations_boot() {
	add_filter( 'openstation_window_content_identity', 'openstation_my_wordpress_woo_content_identity', 20, 2 );
	add_filter( 'openstation_window_related_entities', 'openstation_my_wordpress_woo_related_entities', 20, 3 );
	add_action( 'openstation_chromeless_after', 'openstation_my_wordpress_woo_order_window_title' );
}
openstation_my_wordpress_woo_relations_boot();
