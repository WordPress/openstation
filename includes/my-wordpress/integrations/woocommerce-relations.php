<?php
/**
 * OpenStation — My WordPress: WooCommerce × the relations layer.
 *
 * An order is the most connected object in WordPress and the least
 * connected screen. It names a customer, some products and maybe a
 * coupon, and every one of those is a dead end: WooCommerce prints the
 * customer's name as text, the line items as text, the coupon as a
 * token. To go from an order to the product it sold you go back to the
 * catalogue and search for it.
 *
 * The shell already knows how to express that. Two surfaces, both
 * public, neither WooCommerce-specific:
 *
 *   1. **Content identity** (`openstation_window_content_identity`) —
 *      what a window is showing, plus the objects it refers to. Two
 *      open windows whose identities meet get a drawn tie on the
 *      desktop. Open an order beside the product it sold and the line
 *      between them is the shell telling you they are the same story.
 *
 *   2. **Related entities** (`openstation_window_related_entities`) —
 *      the title bar's "Related" menu. One click from the order to the
 *      customer's profile, to any product on it, to the coupon that
 *      discounted it, each opening as its own window rather than
 *      navigating away from what you were reading.
 *
 * Both run inside the chromeless iframe — real admin context — so the
 * relations resolve against live WooCommerce objects rather than
 * against a URL we guessed at.
 *
 * Screens covered:
 *
 *   - Order edit, both storages. High-Performance Order Storage moves
 *     the screen to `admin.php?page=wc-orders&action=edit&id=N`, where
 *     the built-in `post.php` detection can never see it; legacy
 *     storage lands on `post.php` and gets an identity already, but
 *     one with no links on it.
 *   - Product edit — categories, tags, reviews, and the media the
 *     built-in extractor already finds.
 *   - Coupon edit — the products and categories it is restricted to,
 *     which WooCommerce shows as bare token fields you have to click
 *     into to read.
 *   - User edit — a customer's orders, when the viewer may see them.
 *
 * Everything here is inert without WooCommerce.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * How many line items / coupons one order announces.
 *
 * The relations engine caps a ref's whole `links` array at 64 and its
 * `related` list at 64; a 200-line wholesale order would spend the
 * entire budget on products and silently drop the customer. Bounded
 * here so the trailing groups always survive.
 */
const OPENSTATION_WOO_RELATION_ITEM_CAP = 20;

/**
 * How many orders the product and coupon groups list.
 */
const OPENSTATION_WOO_RELATION_ORDER_CAP = 10;

/**
 * How many order-item rows to read to fill that list.
 *
 * The id lists come out of `woocommerce_order_items`, which holds
 * refund rows alongside order rows — and refunds sort *first* there,
 * since the query orders by descending id and a refund is created
 * after the order it refunds. A `LIMIT 10` on a much-refunded product
 * could therefore come back as ten refunds and no orders at all, and
 * the group would render empty on the one product whose history a
 * merchant most wants to read. Reading a few times the budget and
 * stopping at the cap costs one bounded query.
 */
const OPENSTATION_WOO_RELATION_ORDER_CANDIDATES = 40;

/**
 * Query flag marking a person-URL as a request for a *particular*
 * view of that person rather than for the profile editor.
 *
 * Must stay equal to `OS_PERSON_VIEW_PARAM` in
 * `src/native-url-remap.ts` — the URL is built here and read there,
 * so the two ends have to agree on the literal.
 */
const OPENSTATION_PERSON_VIEW_PARAM = 'os_person_view';

/*
-------------------------------------------------------------------
 * Screen resolution
 * ----------------------------------------------------------------
 */

/**
 * The order the current admin screen is editing, whichever storage
 * the store uses.
 *
 * @return WC_Abstract_Order|null
 */
function openstation_my_wordpress_woo_current_order() {
	if ( ! openstation_my_wordpress_woo_active() ) {
		return null;
	}

	$pagenow = isset( $GLOBALS['pagenow'] ) ? (string) $GLOBALS['pagenow'] : '';

	// phpcs:disable WordPress.Security.NonceVerification.Recommended -- read-only identity harvest; the host admin page enforces capability + nonce.
	$id = 0;
	if ( 'admin.php' === $pagenow ) {
		// HPOS. `wc-orders` for shop orders, `wc-orders--{type}` for
		// custom order types (subscriptions and friends) — both are
		// orders as far as the relations layer cares.
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
		// Legacy storage: orders are posts.
		$id = isset( $_GET['post'] ) ? absint( $_GET['post'] ) : 0;
		if ( $id > 0 && 'shop_order' !== get_post_type( $id ) ) {
			return null;
		}
	}
	// phpcs:enable WordPress.Security.NonceVerification.Recommended

	if ( $id <= 0 ) {
		return null;
	}

	$order = wc_get_order( $id );

	return $order instanceof WC_Abstract_Order ? $order : null;
}

/**
 * Whether the viewer may see this order at all.
 *
 * @return bool
 */
function openstation_my_wordpress_woo_can_read_orders() {
	return true === openstation_my_wordpress_woo_orders_permission();
}

/**
 * Whether an object read back from an order-item row is a purchase.
 *
 * Refunds keep their own line items in the same
 * `woocommerce_order_items` tables, under the refund's id — so a
 * lookup that asks those tables "which orders contain product X"
 * answers with refund ids too, for any product that has ever been
 * refunded. `WC_Order_Refund` extends `WC_Abstract_Order`, so the
 * usual guard waves it through, and the next line asks it for
 * `get_order_number()`: a `WC_Order` method the abstract base does
 * not declare, and therefore a fatal on the product edit screen.
 *
 * Dropping refunds is also the truer answer. "Who bought this" and
 * "where was this coupon used" are questions about purchases, and a
 * refund is the undoing of one.
 *
 * Deliberately *not* `instanceof WC_Order`. The abstract base is the
 * type every order class actually extends, including HPOS's overrides
 * and whatever custom order type a store registers — testing against
 * `WC_Order` has already been tried elsewhere in this integration and
 * silently emptied lists on stores that use them. So this excludes the
 * one known-hostile subclass and then asks the object directly for the
 * accessors these lists call, which keeps an exotic order type that
 * extends the base without them out of a fatal too.
 *
 * @param mixed $order Whatever `wc_get_order()` returned.
 * @return bool
 */
function openstation_my_wordpress_woo_is_purchase( $order ) {
	if ( ! $order instanceof WC_Abstract_Order ) {
		return false;
	}
	if ( $order instanceof WC_Order_Refund ) {
		return false;
	}
	return method_exists( $order, 'get_order_number' );
}

/**
 * The content identity for WooCommerce's product-reviews screen when
 * it is filtered to a single product.
 *
 * `edit.php?post_type=product&page=product-reviews&product_id=N`.
 * The unfiltered all-reviews list stays identity-less, the same way
 * core leaves the unfiltered comments list alone: a window showing
 * everything belongs to nothing in particular.
 *
 * @return array|null
 */
function openstation_my_wordpress_woo_reviews_identity() {
	$pagenow = isset( $GLOBALS['pagenow'] ) ? (string) $GLOBALS['pagenow'] : '';
	if ( 'edit.php' !== $pagenow ) {
		return null;
	}

	// phpcs:disable WordPress.Security.NonceVerification.Recommended -- read-only identity harvest; the host admin page enforces capability + nonce.
	$page = isset( $_GET['page'] ) ? sanitize_key( wp_unslash( $_GET['page'] ) ) : '';
	if ( 'product-reviews' !== $page ) {
		return null;
	}
	$product_id = isset( $_GET['product_id'] ) ? absint( $_GET['product_id'] ) : 0;
	// phpcs:enable WordPress.Security.NonceVerification.Recommended

	if ( $product_id <= 0 || 'product' !== get_post_type( $product_id ) ) {
		return null;
	}
	if ( ! current_user_can( 'edit_post', $product_id ) ) {
		return null;
	}

	return array(
		'type'  => 'reviews',
		'id'    => $product_id,
		/* translators: %s: product name. */
		'label' => sprintf( __( 'Reviews of %s', 'desktop-mode' ), get_the_title( $product_id ) ),
		'root'  => array(
			'type' => 'product',
			'id'   => $product_id,
		),
	);
}

/*
-------------------------------------------------------------------
 * Content identity
 * ----------------------------------------------------------------
 */

/**
 * The objects an order refers to — its customer, its products, its
 * coupons — as relation refs.
 *
 * Direction is `references` throughout: the order points at them. A
 * product does not belong to an order (it outlives it), and a customer
 * certainly doesn't, so `child` would be a lie the arrowheads would
 * then tell on screen.
 *
 * @param WC_Abstract_Order $order Order.
 * @return array[] Ref entries for the identity's `links` array.
 */
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

	// The customer. `user` is the type the shell's own user-edit
	// screens announce, so the tie forms against a profile window
	// opened from anywhere — not just from the shop.
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

/**
 * The objects a coupon refers to — the products and categories it is
 * restricted to.
 *
 * @param WC_Coupon $coupon Coupon.
 * @return array[]
 */
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

/**
 * Announce an identity for WooCommerce's own screens, and hang the
 * shop's links off the identities the built-in detection already
 * produces.
 *
 * @param array|null     $identity Identity so far.
 * @param WP_Screen|null $screen   Current screen, when available.
 * @return array|null
 */
function openstation_my_wordpress_woo_content_identity( $identity, $screen ) {
	unset( $screen );
	if ( ! openstation_my_wordpress_woo_active() ) {
		return $identity;
	}

	// 1. Order edit. Under HPOS there is no identity yet at all —
	// `post.php` never runs — so this is the only place it can come
	// from. Under legacy storage there IS one (the generic post
	// branch), and it arrives with no links: an order's content is
	// empty, so the hyperlink/media/term extractor finds nothing.
	$order = openstation_my_wordpress_woo_current_order();
	if ( $order && openstation_my_wordpress_woo_can_read_orders() ) {
		$name = method_exists( $order, 'get_formatted_billing_full_name' )
			? trim( $order->get_formatted_billing_full_name() )
			: '';

		$identity = array(
			'type'  => 'shop_order',
			'id'    => (int) $order->get_id(),
			'label' => '' !== $name
				? sprintf(
					/* translators: 1: order number, 2: customer name. */
					__( 'Order #%1$s · %2$s', 'desktop-mode' ),
					$order->get_order_number(),
					$name
				)
				: sprintf(
					/* translators: %s: order number. */
					__( 'Order #%s', 'desktop-mode' ),
					$order->get_order_number()
				),
		);

		$links = openstation_my_wordpress_woo_order_refs( $order );
		if ( ! empty( $links ) ) {
			$identity['links'] = $links;
		}

		return $identity;
	}

	// 2. The product-reviews screen, filtered to one product —
	// `edit.php?post_type=product&page=product-reviews&product_id=N`,
	// the target the Related menu's "Reviews" item opens.
	//
	// Without this the item opened a window that drew no tie to the
	// product it came from, while every other item in the same menu
	// did. The reason is structural rather than a bug in the menu:
	// a tie needs BOTH windows to have an identity, and WooCommerce
	// moved reviews off `edit-comments.php` onto its own admin page,
	// which the built-in detection has no reason to know about. (The
	// older `edit-comments.php?p=N` route is already covered by core
	// detection, which is why a post's comments window ties.)
	//
	// Rooted at the product, exactly like the built-in comments
	// identity is rooted at its post: reviews belong to the thing
	// they review.
	$reviews_identity = openstation_my_wordpress_woo_reviews_identity();
	if ( $reviews_identity ) {
		return $reviews_identity;
	}

	// 3. Coupon edit — the built-in post branch gives the identity;
	// the restrictions are what make it interesting.
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

/*
-------------------------------------------------------------------
 * Related entities — the title bar's "Related" menu
 * ----------------------------------------------------------------
 */

/**
 * A related-entity item, with the fields the sanitizer requires.
 *
 * @param string $id          Unique id in the list.
 * @param string $group       Section key.
 * @param string $group_label Section header.
 * @param string $label       Item label.
 * @param string $icon        Dashicon class.
 * @param string $url         Admin URL to open.
 * @param int    $count       Optional count badge; 0 omits it.
 * @return array
 */
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

/**
 * Related items for an order: the customer, every product on it, and
 * every coupon it used.
 *
 * @param WC_Abstract_Order $order Order.
 * @return array[]
 */
function openstation_my_wordpress_woo_order_related( $order ) {
	$related = array();

	$customer_id = method_exists( $order, 'get_customer_id' ) ? (int) $order->get_customer_id() : 0;
	if ( $customer_id > 0 ) {
		$user = get_userdata( $customer_id );
		if ( $user instanceof WP_User ) {
			$label = $user->display_name ? $user->display_name : $user->user_login;

			if ( current_user_can( 'edit_user', $customer_id ) ) {
				// The person, as a customer. From an order, "customer"
				// means *this is who bought it* — not *change their
				// role* — so this opens the Customer window rather
				// than the profile editor.
				//
				// The Related menu can only express a destination as
				// a URL, and the only URL WordPress has for a person
				// is their profile editor. The marker is what lets a
				// specific view claim that URL: the shell's built-in
				// profile remap stands down on any person-URL carrying
				// it, so the claim doesn't depend on winning a
				// registration-order race.
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

				// The profile editor is still one item away, unmarked
				// — it is a real destination, just not the one
				// "customer" means from an order.
				$related[] = openstation_my_wordpress_woo_related_item(
					'wc-customer-profile-' . $customer_id,
					'wc-customer',
					__( 'Customer', 'desktop-mode' ),
					__( 'Edit profile', 'desktop-mode' ),
					'dashicons-admin-users',
					(string) get_edit_user_link( $customer_id )
				);
			}

			// Their other orders. The count comes off the cached
			// aggregate the Customers section already builds, so this
			// is free — and an item that opens a list the merchant
			// then has to filter by hand is not worth the click.
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
			// A line item whose product has since been deleted has no
			// screen to open. It still reads correctly as text on the
			// order itself; it just isn't navigation.
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

/**
 * Order ids containing a given product, newest first.
 *
 * Read from the order-items tables rather than through
 * `wc_get_orders()`, because there is no "orders containing product X"
 * query in the WooCommerce API and walking orders to find one would
 * mean loading every order on the store. Those two tables are the
 * right index and they are populated under BOTH storages — High
 * Performance Order Storage moves the order rows, not the line items.
 *
 * Matches `_variation_id` as well as `_product_id`: a variation is
 * sold as its own line, and a merchant asking "who bought this
 * product" means the variable product too.
 *
 * @param int $product_id Product id.
 * @param int $limit      How many orders.
 * @return int[] Order ids.
 */
function openstation_my_wordpress_woo_orders_with_product( $product_id, $limit = 10 ) {
	global $wpdb;

	$product_id = (int) $product_id;
	$limit      = max( 1, (int) $limit );
	// The order-items tables are WooCommerce's, not core's. Without
	// the plugin they don't exist, and the query would print a
	// "table doesn't exist" notice into whatever page called it.
	if ( $product_id <= 0 || ! openstation_my_wordpress_woo_active() ) {
		return array();
	}

	$items    = $wpdb->prefix . 'woocommerce_order_items';
	$itemmeta = $wpdb->prefix . 'woocommerce_order_itemmeta';

	// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table names are structural; every value is prepared.
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

	// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.NotPrepared -- no core API answers "orders containing product X"; $sql came out of prepare() above, and the result feeds one menu render.
	$ids = $wpdb->get_col( $sql );

	return array_map( 'intval', (array) $ids );
}

/**
 * Coupons restricted to a given product (or to one of its categories).
 *
 * WooCommerce stores both restrictions as comma-separated id strings
 * in postmeta, which no meta query can search reliably — `LIKE
 * '%12%'` matches 112 and 121. So the rows are read and split in PHP.
 * Bounded: a store with more coupons than this has a coupon strategy,
 * not a coupon, and the menu is not the place to enumerate it.
 *
 * @param int $product_id Product id.
 * @param int $limit      How many coupons.
 * @return int[] Coupon post ids.
 */
function openstation_my_wordpress_woo_coupons_for_product( $product_id, $limit = 8 ) {
	global $wpdb;

	$product_id = (int) $product_id;
	if ( $product_id <= 0 ) {
		return array();
	}

	$category_ids = wp_get_post_terms( $product_id, 'product_cat', array( 'fields' => 'ids' ) );
	$category_ids = is_wp_error( $category_ids ) ? array() : array_map( 'intval', $category_ids );

	// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table names are structural.
	$sql = "SELECT pm.post_id, pm.meta_key, pm.meta_value
		FROM {$wpdb->postmeta} pm
		INNER JOIN {$wpdb->posts} p ON p.ID = pm.post_id
		WHERE p.post_type = 'shop_coupon'
			AND p.post_status = 'publish'
			AND pm.meta_key IN ( 'product_ids', 'product_categories' )
		LIMIT 400";

	// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.NotPrepared -- comma-joined id strings can't be searched with a meta query; bounded scan feeding one menu render.
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

/**
 * Related items for a product: everything the catalogue screen knows
 * about it and can't take you to.
 *
 * The built-in related pass covers `post` and `page` only, so a
 * product gets none of this for free — its taxonomies are exactly as
 * navigable as its order history, which is to say not at all.
 *
 * Budgets are per group and add up deliberately. The engine hard-caps
 * the whole `related` list at 64, and an unbudgeted group would push
 * the trailing ones silently over — losing the orders because a
 * product happened to carry thirty tags. Worst case here is
 * 10 + 10 + 1 + 1 + 10 + 8 + 8 = 48.
 *
 * @param int $product_id Product id.
 * @return array[]
 */
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

	// Reviews. WooCommerce files them as comments of type `review`,
	// and its own Reviews screen is the comment list with that filter
	// pre-applied — which is exactly the URL worth linking.
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

	// Variations edit through their parent's screen, but a variable
	// product's children are the thing a merchant actually adjusts —
	// surface the parent screen's variations tab as one jump.
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

	// The other half of the story: who bought it. An order names its
	// products, so the order → product jump has always worked; the
	// reverse is the one a merchant actually asks for ("is this
	// selling? who to?") and the catalogue screen has no answer at
	// all.
	//
	// Gated on order access rather than on `edit_post`: this is order
	// data reached from a product screen, and a shop editor who may
	// not read orders must not read them sideways.
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
						/* translators: 1: order number, 2: customer name, 3: order total. */
						__( '#%1$s · %2$s · %3$s', 'desktop-mode' ),
						$order->get_order_number(),
						$name,
						$total
					)
					: sprintf(
						/* translators: 1: order number, 2: order total. */
						__( '#%1$s · %2$s', 'desktop-mode' ),
						$order->get_order_number(),
						$total
					),
				'dashicons-cart',
				method_exists( $order, 'get_edit_order_url' )
					? (string) $order->get_edit_order_url()
					: ''
			);

			// Harvested from the same orders rather than queried
			// again — the buyers of a product ARE the customers on
			// its orders, and a second query would only say so more
			// slowly.
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
				// The Customer window, not the profile editor — from
				// a product or a coupon, a person is a buyer.
				add_query_arg(
					OPENSTATION_PERSON_VIEW_PARAM,
					'wc-customer',
					(string) get_edit_user_link( $user->ID )
				)
			);
			++$shown;
		}
	}

	// Coupons that discount it — WooCommerce shows the relationship
	// only from the coupon's side, as a token field, so from the
	// product there is currently no way to learn it is on offer.
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

/**
 * Order ids that used a given coupon code, newest first.
 *
 * Coupon usage is a line item like any other, so it lives in the same
 * always-populated order-items tables. `order_item_name` holds the
 * code, lowercased by WooCommerce on apply.
 *
 * @param string $code  Coupon code.
 * @param int    $limit How many orders.
 * @return int[] Order ids.
 */
function openstation_my_wordpress_woo_orders_with_coupon( $code, $limit = 10 ) {
	global $wpdb;

	$code = strtolower( trim( (string) $code ) );
	// Same table-ownership caveat as the product lookup above.
	if ( '' === $code || ! openstation_my_wordpress_woo_active() ) {
		return array();
	}

	$items = $wpdb->prefix . 'woocommerce_order_items';

	// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is structural; every value is prepared.
	$sql = $wpdb->prepare(
		"SELECT DISTINCT order_id
		FROM {$items}
		WHERE order_item_type = 'coupon' AND LOWER( order_item_name ) = %s
		ORDER BY order_id DESC
		LIMIT %d",
		$code,
		max( 1, (int) $limit )
	);

	// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.NotPrepared -- no core API answers "orders that used coupon X"; $sql came out of prepare() above, and the result feeds one menu render.
	$ids = $wpdb->get_col( $sql );

	return array_map( 'intval', (array) $ids );
}

/**
 * Related items for a coupon: what it is restricted to, and who
 * actually used it.
 *
 * WooCommerce renders the restrictions as select2 token fields —
 * readable only by clicking into each token, and not links to
 * anywhere. The usage count it does show is a bare number with
 * nothing behind it.
 *
 * Budgets: 20 + 20 + 10 + 8 = 58, inside the engine's 64-item cap.
 *
 * @param int $coupon_id Coupon id.
 * @return array[]
 */
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

	// Who redeemed it. The coupon screen shows a usage count and
	// nothing behind it, so "did this campaign work, and for whom" is
	// a question you currently answer by exporting orders.
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
						/* translators: 1: order number, 2: customer name, 3: order total. */
						__( '#%1$s · %2$s · %3$s', 'desktop-mode' ),
						$order->get_order_number(),
						$name,
						$total
					)
					: sprintf(
						/* translators: 1: order number, 2: order total. */
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
				// The Customer window, not the profile editor — from
				// a product or a coupon, a person is a buyer.
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

/**
 * Related items for a user identity: their orders, when they have any
 * and the viewer may see them.
 *
 * @param int $user_id User id.
 * @return array[]
 */
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

/**
 * Hang WooCommerce's relations off whatever identity the screen
 * resolved to.
 *
 * @param array[]        $related  Related items so far.
 * @param array          $identity The resolved content identity.
 * @param WP_Screen|null $screen   Current screen, when available.
 * @return array[]
 */
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

/**
 * Boot the relations wiring.
 *
 * Priority 20 on the identity filter so a site that overrides the
 * order identity for its own reasons still wins.
 *
 * @return void
 */
function openstation_my_wordpress_woo_relations_boot() {
	add_filter( 'openstation_window_content_identity', 'openstation_my_wordpress_woo_content_identity', 20, 2 );
	add_filter( 'openstation_window_related_entities', 'openstation_my_wordpress_woo_related_entities', 20, 3 );
}
openstation_my_wordpress_woo_relations_boot();
