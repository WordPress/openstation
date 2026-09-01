<?php
/**
 * My WordPress — the WooCommerce surface.
 *
 * Part of the `my-wordpress` app: required by `my-wordpress.os.php`,
 * same namespace, plain `.php` on purpose — only `*.os.php` files are
 * app entries to the framework loader. This part is the app's half of
 * the WooCommerce integration: the Orders and Customers sections, the
 * band-ordered Products / Coupons queries, and the per-row facts the
 * shared `os.my-wordpress.*` JS seams read. Everything here is inert
 * unless WooCommerce is active.
 *
 * It is deliberately thin: every rule — which band a product is in,
 * how customers are ranked, what an order row says — lives in the
 * existing `openstation_my_wordpress_woo_*` helpers WP Explorer
 * already runs (`includes/my-wordpress/integrations/`), called here
 * behind `function_exists` guards. One set of rules, two windows; the
 * client half is the same `os-my-wordpress-woocommerce` bundle both
 * windows load, subscribed to the same hook bus.
 *
 * @package OpenStation
 */

namespace OpenStation\Apps\MyWordPress;

use OpenStation\App\Os;
use OpenStation\App\State;

// Direct access, unless a standalone host is booting on bare PHP.
if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

/**
 * Whether the WooCommerce integration helpers are loaded and active.
 *
 * @return bool
 */
function woo_ready() {
	return function_exists( 'openstation_my_wordpress_woo_active' )
		&& openstation_my_wordpress_woo_active();
}

/**
 * Whether a section descriptor is one of ours.
 *
 * @param array<string,mixed> $section Section descriptor.
 * @param string              $id      Section id to test for.
 * @return bool
 */
function woo_section_is( array $section, $id ) {
	return isset( $section['id'] ) && $id === $section['id'];
}

/**
 * The Woo folder's group fields, through the same
 * `openstation_my_wordpress_woo_group()` relabelling WP Explorer uses.
 *
 * @return array{id:string,label:string,icon:string,order:int}
 */
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

/**
 * The sections this part adds to the root: Orders and Customers —
 * the two shop surfaces a plain post-type folder cannot serve.
 * Orders live outside `wp_posts` under High-Performance Order
 * Storage, and Customers are a ranking over users, not a post type.
 *
 * Same labels, icons, groups and permission gates as WP Explorer's
 * `wc-orders` / `wc-customers` entities. `flat => true` marks a
 * section with no detail folder behind its tiles — the client keeps
 * Navigate into and the quick-edit modal off it, the actions refuse
 * post mutations on it.
 *
 * @param Os $os Host handle.
 * @return array<int,array<string,mixed>>
 */
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
			// Claims `shop_order`, so the generic post-type pass skips
			// it — the WP_Query path returns an empty folder on any
			// HPOS store.
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
			// Renders through the built-in user kind: avatar tiles, the
			// dossier pane, the drag-out seam. A customer is a person
			// before they are a row of money.
			'kind'       => 'user',
			'post_type'  => '',
			// The two-gate permission was checked above; no single
			// capability string expresses it.
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

/**
 * Give a discovered CPT section WooCommerce's icons and thumbnail
 * rules, through the same `openstation_my_wordpress_woo_entity_icon()`
 * (and its `openstation_my_wordpress_woo_section_icons` filter) that
 * decorates WP Explorer's entities. Non-Woo types pass through
 * untouched.
 *
 * @param array<string,mixed> $section   Section descriptor.
 * @param \WP_Post_Type       $post_type Post type object.
 * @return array<string,mixed>
 */
function woo_decorate_section( array $section, \WP_Post_Type $post_type ) {
	if ( ! function_exists( 'openstation_my_wordpress_woo_entity_icon' ) ) {
		return $section;
	}
	$section = (array) openstation_my_wordpress_woo_entity_icon( $section, $post_type );
	// Entity-descriptor keys the app has no reader for — `listFields`
	// is the REST `_fields` allowlist, `listQuery` extra request
	// params, `tileSize` the old grid's hint. The app's rows carry
	// their facts directly and its queries are ordered server-side.
	unset( $section['listFields'], $section['listQuery'], $section['tileSize'] );
	return $section;
}

/**
 * Sort options for the Woo-managed sections — a single honest entry,
 * because their order is decided server-side: orders and coupons walk
 * their bands, customers rank by band then spend, products shelve
 * empty stock first. Null leaves a section to the generic options.
 *
 * @param array<string,mixed> $section Section descriptor.
 * @return array<string,array{0:string,1:string,2:string}>|null
 */
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

/**
 * Root-tile counts for the Woo sections, or null for anyone else's.
 *
 * @param array<string,mixed> $section Section descriptor.
 * @return int|null
 */
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

/**
 * One order as an app list row. The title is what a merchant scans
 * for — number and total — and the REAL status rides `wcStatus` for
 * the band assigner, never `status`: the tile ribbon only speaks
 * draft/pending/private/future, and `wc-processing` would paint a
 * meaningless ribbon on every order.
 *
 * @param \WC_Abstract_Order $order Order.
 * @return array<string,mixed>
 */
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
			/* translators: 1: order number, 2: formatted order total. */
			__( '#%1$s · %2$s', 'desktop-mode' ),
			$order->get_order_number(),
			$total
		),
		'subtitle'  => sprintf(
			/* translators: 1: customer name, 2: date. */
			__( '%1$s — %2$s', 'desktop-mode' ),
			'' !== $name ? $name : __( 'Guest', 'desktop-mode' ),
			$date
		),
		'status'    => 'publish',
		'excerpt'   => '',
		'thumb'     => '',
		// Refunds and custom order types don't carry an edit URL.
		'link'      => method_exists( $order, 'get_edit_order_url' )
			? esc_url_raw( (string) $order->get_edit_order_url() )
			: '',
		'mime'      => '',
		'lockedBy'  => '',
		'canEdit'   => method_exists( $order, 'get_edit_order_url' ),
		'canDelete' => false,
		'wcStatus'  => (string) $order->get_status(),
	);
}

/**
 * One page of the Orders section: the same band walker WP Explorer's
 * `/woocommerce/orders` route runs — statuses sliced in display order
 * so a band's rows arrive together and the grouping never reshuffles
 * under the reader — reshaped as app rows.
 *
 * @param State $state State (`query`, `page`).
 * @return array{items:array[],total:int,pages:int,page:int,perPage:int}
 */
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
		// A data store may hand back ids rather than objects; and
		// `WC_Abstract_Order` — not `WC_Order` — is what every order
		// class actually extends, HPOS overrides and custom order
		// types included.
		$order = is_scalar( $maybe_order ) ? wc_get_order( (int) $maybe_order ) : $maybe_order;
		if ( ! $order instanceof \WC_Abstract_Order ) {
			continue;
		}
		try {
			$items[] = woo_order_item( $order );
		} catch ( \Throwable $e ) {
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			error_log(
				sprintf(
					'[openstation] Skipped order %d in the My WordPress app: %s',
					is_object( $order ) ? (int) $order->get_id() : 0,
					$e->getMessage()
				)
			);
		}
	}

	return array(
		'items'   => $items,
		'total'   => $total,
		'pages'   => max( 1, (int) ceil( $total / $per_page ) ),
		'page'    => $page,
		'perPage' => $per_page,
	);
}

/**
 * One page of the Customers section: the same plan-ordered roster WP
 * Explorer's `/woocommerce/customers` route serves — band first,
 * spend inside the band — as app user rows carrying the
 * `openstation_woo_customer` facts the shared seams read.
 *
 * @param Os    $os    Host handle.
 * @param State $state State (`query`, `page`).
 * @return array{items:array[],total:int,pages:int,page:int,perPage:int}
 */
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
		// Past the cap the plan holds no ids, so hand the ordering
		// back to the database: newest accounts first, the only
		// useful order left once bands are off.
		$args['role']    = 'customer';
		$args['orderby'] = 'registered';
		$args['order']   = 'DESC';
	} else {
		$ids = array_map( 'intval', (array) ( $plan['ids'] ?? array() ) );
		if ( array() === $ids ) {
			return array(
				'items'   => array(),
				'total'   => 0,
				'pages'   => 1,
				'page'    => $page,
				'perPage' => $per_page,
			);
		}
		$args['include'] = $ids;
		// `include` + `orderby => include` replays the plan's order
		// verbatim — the user-query spelling of `post__in`.
		$args['orderby'] = 'include';
	}

	if ( '' !== $query ) {
		$args['search']         = '*' . $query . '*';
		$args['search_columns'] = array( 'user_login', 'user_email', 'user_nicename', 'display_name' );
		// A search is a different question from "show me the roster",
		// and the plan's order would hide matches below the fold.
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
		$row = array(
			'id'        => (int) $user->ID,
			'title'     => (string) $user->display_name,
			// The REST spelling too — the shared seam subscribers were
			// written against `/wp/v2/users` rows.
			'name'      => (string) $user->display_name,
			'subtitle'  => (string) $user->user_email,
			'status'    => implode( ', ', array_map( 'ucfirst', (array) $user->roles ) ),
			'excerpt'   => '',
			'thumb'     => (string) get_avatar_url( $user->ID, array( 'size' => 96 ) ),
			'link'      => esc_url_raw( get_author_posts_url( $user->ID ) ),
			'mime'      => '',
			'lockedBy'  => '',
			'canEdit'   => $os->can( 'edit_user', (int) $user->ID ),
			'canDelete' => false,
		);
		$row     += woo_user_extras( (int) $user->ID );
		$items[]  = $row;
	}

	return array(
		'items'   => $items,
		'total'   => $total,
		'pages'   => max( 1, (int) ceil( $total / $per_page ) ),
		'page'    => $page,
		'perPage' => $per_page,
	);
}

/**
 * The whole list page for a Woo section, or null for anyone else's.
 *
 * @param Os                  $os      Host handle.
 * @param array<string,mixed> $section Section descriptor.
 * @param State               $state   State.
 * @return array<string,mixed>|null
 */
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

/**
 * Band-order the Products and Coupons queries, exactly as the REST
 * collections are ordered for WP Explorer: the cached plan replayed
 * as `post__in`, so each band's rows arrive together and the client's
 * grouping can never disagree with the order they arrive in. A capped
 * catalogue falls back to stock status, which at least floats empty
 * shelves to the top; a search is the user asking for relevance and
 * is left alone.
 *
 * @param array<string,mixed> $args    `WP_Query` args.
 * @param array<string,mixed> $section Section descriptor.
 * @param State               $state   State.
 * @return array<string,mixed>
 */
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
			$args['meta_key'] = '_stock_status'; // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
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

/**
 * The `openstation_woo` facts for a product or coupon row — the same
 * payload the REST fields ship on `wp/v2` rows, which is what the
 * shared band assigner and the stock-ribbon decorator read. Empty for
 * every other row.
 *
 * @param \WP_Post $post Post.
 * @return array<string,mixed>
 */
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
				// The band this row belongs to, decided by the same
				// rules that ordered the collection, so the two can't
				// disagree.
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

/**
 * The `openstation_woo_customer` facts for a user row — carried on
 * the Customers section's rows ONLY. Deliberately narrower than WP
 * Explorer (whose `/wp/v2/users` field puts spend on its Users list
 * too): in this app the built-in Users folder is about people who
 * write, and stays money-free — the shared bundle keys its badges
 * and panel off these facts being present, so leaving them off a row
 * is how a surface opts out. Gated exactly as the REST field is: a
 * viewer who can't see orders sees no money.
 *
 * @param int $user_id User id.
 * @return array<string,mixed>
 */
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

/**
 * Whether the acting user may act on a Woo row — null passes the
 * question back to the generic capability checks. Orders need it
 * because `current_user_can( 'edit_post', $order_id )` means nothing
 * once HPOS moves orders out of `wp_posts`.
 *
 * @param array<string,mixed> $section Section descriptor.
 * @param int                 $id      Item id.
 * @param string              $verb    `edit` | `delete`.
 * @return bool|null
 */
function woo_allowed( array $section, $id, $verb ) {
	unset( $id );
	if ( ! woo_ready() || ! woo_section_is( $section, 'wc-orders' ) ) {
		return null;
	}
	if ( 'edit' !== $verb ) {
		// Orders are never mutated from here — WP Explorer's Orders
		// section is read-and-open too.
		return false;
	}
	$orders = get_post_type_object( 'shop_order' );
	return $orders instanceof \WP_Post_Type
		&& ! empty( $orders->cap->edit_posts )
		&& current_user_can( $orders->cap->edit_posts );
}

/**
 * The admin URL that edits a Woo row, '' for anyone else's. HPOS and
 * legacy storage put the order screen in different places, and only
 * WooCommerce knows which.
 *
 * @param array<string,mixed> $section Section descriptor.
 * @param int                 $id      Item id.
 * @return string
 */
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

/**
 * The dossier payload for one order. Deliberately spare: the pane's
 * substance is the shared bundle's merchant panel, painted into the
 * `header` slot with the full status, totals, line items and
 * customer — repeating them as facts would say everything twice.
 *
 * @param array<string,mixed> $section Section descriptor.
 * @param int                 $id      Order id.
 * @return array<string,mixed>|null Null when the order vanished.
 */
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
		'facts'     => array_values(
			array_filter(
				array(
					array(
						__( 'Placed', 'desktop-mode' ),
						$order->get_date_created()
							? (string) date_i18n( (string) get_option( 'date_format' ), $order->get_date_created()->getTimestamp() )
							: '',
					),
				),
				static function ( $fact ) {
					return '' !== $fact[1];
				}
			)
		),
		'canEdit'   => ! empty( $item['canEdit'] ) && true === woo_allowed( $section, (int) $id, 'edit' ),
		'canDelete' => false,
	);
}
