<?php

namespace OpenStation\Apps\MyWordPress;

use OpenStation\App\Os;
use OpenStation\App\State;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

function woo_ready() {
	return function_exists( 'openstation_my_wordpress_woo_active' )
		&& openstation_my_wordpress_woo_active();
}

function woo_section_is( array $section, $id ) {
	return isset( $section['id'] ) && $id === $section['id'];
}

function woo_group_fields() {
	$group = array(
		'id'    => 'plugin:woocommerce',
		'label' => 'WooCommerce',
		'icon'  => 'dashicons-admin-plugins',
		'order' => 20,
	);
	if ( function_exists( 'openstation_my_wordpress_woo_group' ) ) {
		$group = (array) openstation_my_wordpress_woo_group( $group, 'shop_order' );
	}
	return $group;
}

function woo_sections( Os $os ) {
	unset( $os );
	if ( ! woo_ready() ) {
		return array();
	}

	$group    = woo_group_fields();
	$sections = array();

	$orders = get_post_type_object( 'shop_order' );
	if ( $orders instanceof \WP_Post_Type && ! empty( $orders->cap->edit_posts ) ) {
		$sections[] = array(
			'id'         => 'wc-orders',
			'label'      => __( 'Orders', 'desktop-mode' ),
			'icon'       => 'dashicons-cart',
			'kind'       => 'post',

			'post_type'  => 'shop_order',
			'capability' => (string) $orders->cap->edit_posts,
			'thumbnails' => false,
			'flat'       => true,
			'group'      => $group['id'],
			'groupLabel' => $group['label'],
			'groupIcon'  => $group['icon'],
			'groupOrder' => (int) $group['order'],
		);
	}

	if ( function_exists( 'openstation_my_wordpress_woo_customers_permission' )
		&& true === openstation_my_wordpress_woo_customers_permission() ) {
		$sections[] = array(
			'id'         => 'wc-customers',
			'label'      => __( 'Customers', 'desktop-mode' ),
			'icon'       => 'dashicons-groups',

			'kind'       => 'user',
			'post_type'  => '',

			'capability' => '',
			'thumbnails' => true,
			'group'      => $group['id'],
			'groupLabel' => $group['label'],
			'groupIcon'  => $group['icon'],
			'groupOrder' => (int) $group['order'],
		);
	}

	return $sections;
}

function woo_decorate_section( array $section, \WP_Post_Type $post_type ) {
	if ( ! function_exists( 'openstation_my_wordpress_woo_entity_icon' ) ) {
		return $section;
	}
	$section = (array) openstation_my_wordpress_woo_entity_icon( $section, $post_type );

	unset( $section['listFields'], $section['listQuery'], $section['tileSize'] );
	return $section;
}

function woo_sort_options( array $section ) {
	if ( ! woo_ready() ) {
		return null;
	}
	if ( woo_section_is( $section, 'wc-orders' ) ) {
		return array( 'default' => array( __( 'Needs attention first', 'desktop-mode' ), 'date', 'DESC' ) );
	}
	if ( woo_section_is( $section, 'wc-customers' ) ) {
		return array( 'default' => array( __( 'Top spenders first', 'desktop-mode' ), '', '' ) );
	}
	if ( woo_section_is( $section, 'cpt-product' ) || woo_section_is( $section, 'cpt-shop_coupon' ) ) {
		return array( 'default' => array( __( 'Store order', 'desktop-mode' ), 'date', 'DESC' ) );
	}
	return null;
}

function woo_count( array $section ) {
	if ( ! woo_ready() ) {
		return null;
	}
	if ( woo_section_is( $section, 'wc-orders' ) ) {
		$counted = wc_get_orders(
			array(
				'limit'    => 1,
				'paginate' => true,
				'return'   => 'ids',
			)
		);
		return is_object( $counted ) && isset( $counted->total ) ? (int) $counted->total : 0;
	}
	if ( woo_section_is( $section, 'wc-customers' )
		&& function_exists( 'openstation_my_wordpress_woo_customer_plan' ) ) {
		$plan = openstation_my_wordpress_woo_customer_plan();
		return (int) ( $plan['customers'] ?? 0 );
	}
	return null;
}

function woo_order_item( $order ) {
	$total = openstation_my_wordpress_woo_price( $order->get_total(), $order->get_currency() );
	$name  = method_exists( $order, 'get_formatted_billing_full_name' )
		? trim( (string) $order->get_formatted_billing_full_name() )
		: '';
	$date  = $order->get_date_created()
		? (string) date_i18n( (string) get_option( 'date_format' ), $order->get_date_created()->getTimestamp() )
		: '';

	return array(
		'id'        => (int) $order->get_id(),
		'title'     => sprintf(

			__( '#%1$s · %2$s', 'desktop-mode' ),
			$order->get_order_number(),
			$total
		),
		'subtitle'  => sprintf(

			__( '%1$s — %2$s', 'desktop-mode' ),
			'' !== $name ? $name : __( 'Guest', 'desktop-mode' ),
			$date
		),
		'status'    => 'publish',
		'excerpt'   => '',
		'thumb'     => '',

		'link'      => method_exists( $order, 'get_edit_order_url' )
			? esc_url_raw( (string) $order->get_edit_order_url() )
			: '',
		'mime'      => '',
		'lockedBy'  => '',
		'canEdit'   => method_exists( $order, 'get_edit_order_url' ),
		'canDelete' => false,
		'wcStatus'  => (string) $order->get_status(),

		'customer'  => '' !== $name ? $name : __( 'Guest', 'desktop-mode' ),
		'date'      => $order->get_date_created() ? $order->get_date_created()->format( 'c' ) : '',
		'modified'  => $order->get_date_modified() ? $order->get_date_modified()->format( 'c' ) : '',
	);
}

function woo_orders_page( State $state ) {
	$per_page = PER_PAGE;
	$page     = max( 1, (int) $state->get( 'page' ) );
	$query    = (string) $state->get( 'query' );

	$base = array(
		'orderby' => 'date',
		'order'   => 'DESC',
	);
	if ( '' !== $query ) {
		$base['s'] = $query;
	}

	$slices = openstation_my_wordpress_woo_order_band_slices( $base );

	$total = 0;
	foreach ( $slices as $slice ) {
		$total += (int) $slice['count'];
	}
	$offset = ( $page - 1 ) * $per_page;

	$orders    = array();
	$remaining = $per_page;
	$cursor    = 0;
	foreach ( $slices as $slice ) {
		if ( $remaining <= 0 ) {
			break;
		}
		$count = (int) $slice['count'];
		if ( 0 === $count ) {
			continue;
		}
		if ( $offset >= $cursor + $count ) {
			$cursor += $count;
			continue;
		}
		$within = max( 0, $offset - $cursor );
		$take   = min( $remaining, $count - $within );

		$batch = wc_get_orders(
			array_merge(
				$base,
				array(
					'status'   => $slice['statuses'],
					'limit'    => $take,
					'offset'   => $within,
					'paginate' => false,
				)
			)
		);
		$batch = is_object( $batch ) && isset( $batch->orders ) ? (array) $batch->orders : (array) $batch;

		$orders     = array_merge( $orders, $batch );
		$remaining -= count( $batch );
		$cursor    += $count;
		$offset     = $cursor;
	}

	$items = array();
	foreach ( $orders as $maybe_order ) {

		$order = is_scalar( $maybe_order ) ? wc_get_order( (int) $maybe_order ) : $maybe_order;
		if ( ! $order instanceof \WC_Abstract_Order ) {
			continue;
		}
		try {
			$items[] = woo_order_item( $order );
		} catch ( \Throwable $e ) {

			error_log(
				sprintf(
					'[openstation] Skipped order %d in the My WordPress app: %s',
					is_object( $order ) ? (int) $order->get_id() : 0,
					$e->getMessage()
				)
			);
		}
	}

	return Os::page( $items, $total, $page, $per_page );
}

function woo_customers_page( Os $os, State $state ) {
	$per_page = PER_PAGE;
	$page     = max( 1, (int) $state->get( 'page' ) );
	$query    = trim( (string) $state->get( 'query' ) );

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
		$ids = array_map( 'intval', (array) ( $plan['ids'] ?? array() ) );
		if ( array() === $ids ) {
			return Os::page( array(), 0, $page, $per_page );
		}
		$args['include'] = $ids;

		$args['orderby'] = 'include';
	}

	if ( '' !== $query ) {
		$args['search']         = '*' . $query . '*';
		$args['search_columns'] = array( 'user_login', 'user_email', 'user_nicename', 'display_name' );

		if ( ! $capped ) {
			$args['orderby'] = 'display_name';
			$args['order']   = 'ASC';
		}
	}

	$users = new \WP_User_Query( $args );
	$total = (int) $users->get_total();

	$items = array();
	foreach ( (array) $users->get_results() as $user ) {
		if ( ! $user instanceof \WP_User ) {
			continue;
		}
		$row = user_row(
			$user,
			static function ( $user_id ) use ( $os ) {
				return $os->can( 'edit_user', $user_id );
			}
		);
		$row     += woo_user_extras( (int) $user->ID );
		$items[]  = $row;
	}

	return Os::page( $items, $total, $page, $per_page );
}

function woo_list( Os $os, array $section, State $state ) {
	if ( ! woo_ready() ) {
		return null;
	}
	if ( woo_section_is( $section, 'wc-orders' ) ) {
		return woo_orders_page( $state );
	}
	if ( woo_section_is( $section, 'wc-customers' ) ) {
		return woo_customers_page( $os, $state );
	}
	return null;
}

function woo_query_args( array $args, array $section, State $state ) {
	if ( ! woo_ready() || '' !== (string) $state->get( 'query' ) ) {
		return $args;
	}

	if ( woo_section_is( $section, 'cpt-product' )
		&& function_exists( 'openstation_my_wordpress_woo_product_plan' ) ) {
		$plan = openstation_my_wordpress_woo_product_plan();
		if ( ! empty( $plan['ids'] ) ) {
			$args['post__in'] = array_map( 'intval', (array) $plan['ids'] );
			$args['orderby']  = 'post__in';
			unset( $args['order'] );
		} else {
			$args['meta_key'] = '_stock_status';
			$args['orderby']  = array(
				'meta_value' => 'DESC',
				'date'       => 'DESC',
			);
		}
		return $args;
	}

	if ( woo_section_is( $section, 'cpt-shop_coupon' )
		&& function_exists( 'openstation_my_wordpress_woo_coupon_plan' ) ) {
		$plan = openstation_my_wordpress_woo_coupon_plan();
		if ( ! empty( $plan['ids'] ) ) {
			$args['post__in'] = array_map( 'intval', (array) $plan['ids'] );
			$args['orderby']  = 'post__in';
			unset( $args['order'] );
		}
	}

	return $args;
}

function woo_extras( \WP_Post $post ) {
	if ( ! woo_ready() ) {
		return array();
	}

	if ( 'product' === $post->post_type
		&& function_exists( 'openstation_my_wordpress_woo_product_band_id' ) ) {
		$product = wc_get_product( $post->ID );
		if ( ! $product ) {
			return array();
		}
		$slugs = wp_get_post_terms( $product->get_id(), 'product_cat', array( 'fields' => 'slugs' ) );
		return array(
			'openstation_woo' => array(

				'band'        => openstation_my_wordpress_woo_product_band_id( $product ),
				'stockStatus' => $product->get_stock_status(),
				'stockLevel'  => $product->managing_stock() ? (int) $product->get_stock_quantity() : null,
				'onSale'      => $product->is_on_sale(),
				'categories'  => is_wp_error( $slugs ) ? array() : array_values( $slugs ),
			),
		);
	}

	if ( 'shop_coupon' === $post->post_type
		&& function_exists( 'openstation_my_wordpress_woo_coupon_band_id' ) ) {
		$coupon = new \WC_Coupon( $post->ID );
		if ( ! $coupon->get_id() ) {
			return array();
		}
		return array(
			'openstation_woo' => array(
				'band' => openstation_my_wordpress_woo_coupon_band_id( $coupon ),
			),
		);
	}

	return array();
}

function woo_user_extras( $user_id ) {
	if ( ! woo_ready()
		|| ! function_exists( 'openstation_my_wordpress_woo_customer_facts' )
		|| ! function_exists( 'openstation_my_wordpress_woo_customers_permission' )
		|| true !== openstation_my_wordpress_woo_customers_permission() ) {
		return array();
	}
	return array(
		'openstation_woo_customer' => openstation_my_wordpress_woo_customer_facts( (int) $user_id ),
	);
}

function woo_allowed( array $section, $id, $verb ) {
	unset( $id );
	if ( ! woo_ready() || ! woo_section_is( $section, 'wc-orders' ) ) {
		return null;
	}
	if ( 'edit' !== $verb ) {

		return false;
	}
	$orders = get_post_type_object( 'shop_order' );
	return $orders instanceof \WP_Post_Type
		&& ! empty( $orders->cap->edit_posts )
		&& current_user_can( $orders->cap->edit_posts );
}

function woo_edit_url( array $section, $id ) {
	if ( ! woo_ready() || ! woo_section_is( $section, 'wc-orders' ) ) {
		return '';
	}
	$order = wc_get_order( (int) $id );
	if ( $order instanceof \WC_Abstract_Order && method_exists( $order, 'get_edit_order_url' ) ) {
		return (string) $order->get_edit_order_url();
	}
	return '';
}

function woo_detail( array $section, $id ) {
	$order = wc_get_order( (int) $id );
	if ( ! $order instanceof \WC_Abstract_Order ) {
		return null;
	}
	$item = woo_order_item( $order );

	return array(
		'kind'      => 'post',
		'id'        => (int) $order->get_id(),
		'title'     => (string) $item['title'],
		'facts'     => Os::facts(
			array(
				array(
					__( 'Placed', 'desktop-mode' ),
					$order->get_date_created()
						? (string) date_i18n( (string) get_option( 'date_format' ), $order->get_date_created()->getTimestamp() )
						: '',
				),
			)
		),
		'canEdit'   => ! empty( $item['canEdit'] ) && true === woo_allowed( $section, (int) $id, 'edit' ),
		'canDelete' => false,
	);
}
