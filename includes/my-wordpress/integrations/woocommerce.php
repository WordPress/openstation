<?php
/**
 * OpenStation — My WordPress: WooCommerce integration.
 *
 * Everything in this file is inert unless WooCommerce is active. It
 * makes the shop folder behave like a shop rather than like a pile of
 * post types:
 *
 *   - The folder is labelled **Woo** and carries WooCommerce's own
 *     mark. ("WooCommerce" wraps onto two lines under a 88px tile.)
 *   - **Orders** are served through `wc_get_orders()` instead of a
 *     `WP_Query`. WooCommerce's High-Performance Order Storage moves
 *     orders out of `wp_posts` into its own tables, so the generic
 *     post-type path returns an empty folder on any modern store.
 *     Going through WooCommerce's own API covers both storages.
 *   - The right pane gets merchant facts — a product's price, stock
 *     and units sold; an order's total, customer and line items; a
 *     coupon's validity and usage — and the folder itself gets store
 *     totals.
 *
 * REST surface (all read-only, all capability-gated):
 *
 *   GET desktop-mode/v1/woocommerce/orders
 *   GET desktop-mode/v1/woocommerce/orders/<id>
 *   GET desktop-mode/v1/woocommerce/summary/<type>/<id>
 *   GET desktop-mode/v1/woocommerce/store
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Whether WooCommerce is active and its API is loaded.
 *
 * @return bool
 */
function openstation_my_wordpress_woo_active() {
	return class_exists( 'WooCommerce' ) && function_exists( 'wc_get_orders' );
}

/**
 * WooCommerce's mark as a `currentColor` SVG data URI.
 *
 * WooCommerce builds the same glyph inline in `WC_Admin_Menus::admin_menu()`
 * with a hard-coded grey fill, and it's a local variable there — not
 * reachable, and not tintable. Re-emitting it with `currentColor` lets
 * `renderIcon()` mask it, so the folder icon follows the desktop theme
 * the way every other icon does.
 *
 * @return string Data URI.
 */
function openstation_my_wordpress_woo_icon() {
	$svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 85.9 47.6">'
		. '<path fill="currentColor" d="M77.4,0.1c-4.3,0-7.1,1.4-9.6,6.1L56.4,27.7V8.6c0-5.7-2.7-8.5-7.7-8.5'
		. 's-7.1,1.7-9.6,6.5L28.3,27.7V8.8c0-6.1-2.5-8.7-8.6-8.7H7.3C2.6,0.1,0,2.3,0,6.3s2.5,6.4,7.1,6.4h5.1v24.1'
		. 'c0,6.8,4.6,10.8,11.2,10.8S33,45,36.3,38.9l7.2-13.5v11.4c0,6.7,4.4,10.8,11.1,10.8s9.2-2.3,13-8.7l16.6-28'
		. 'c3.6-6.1,1.1-10.8-6.9-10.8C77.3,0.1,77.3,0.1,77.4,0.1z"/></svg>';

	return 'data:image/svg+xml;base64,' . base64_encode( $svg );
}

/**
 * Label and icon for the WooCommerce folder.
 *
 * @param array|null $group     Resolved group.
 * @param string     $post_type Post type slug.
 * @return array|null
 */
function openstation_my_wordpress_woo_group( $group, $post_type ) {
	unset( $post_type );
	if ( ! is_array( $group ) || 'plugin:woocommerce' !== ( $group['id'] ?? '' ) ) {
		return $group;
	}

	// "WooCommerce" wraps to two lines in an 88px tile and reads badly.
	$group['label'] = _x( 'Woo', 'WooCommerce folder name', 'desktop-mode' );
	$group['icon']  = openstation_my_wordpress_woo_icon();
	// Ahead of other plugin folders — for a shop this is the folder
	// the merchant opens all day.
	$group['order'] = 15;

	return $group;
}

/**
 * Replace the generic Orders section with one backed by
 * `wc_get_orders()`.
 *
 * Registered at priority 5 — ahead of the generic post-type pass,
 * which skips any type an existing section already declares via
 * `post_type`. Same trick a plugin would use to hand-roll a section.
 *
 * @param array[] $entities Entity descriptors.
 * @return array[]
 */
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
		// Claims `shop_order` so the generic post-type pass skips it,
		// and drives the `os.shop_order.changed` broadcast.
		'post_type'  => 'shop_order',
		'thumbnails' => false,
		// Keeps `wcStatus` from being filtered out of the list rows.
		'listFields' => array( 'wcStatus' ),
		'group'      => $group['id'],
		'groupLabel' => $group['label'],
		'groupIcon'  => $group['icon'],
		'groupOrder' => $group['order'],
	);

	return $entities;
}

/**
 * Give WooCommerce's post types icons that mean something.
 *
 * These types are submenu entries under the WooCommerce menu, so they
 * carry no `menu_icon` and fall back to the generic post pin — a pin
 * for a coupon reads as a mistake.
 *
 * @param array        $entity    Entity descriptor.
 * @param WP_Post_Type $post_type Post type object.
 * @return array
 */
function openstation_my_wordpress_woo_entity_icon( $entity, $post_type ) {
	$icons = array(
		'product'      => 'dashicons-products',
		'shop_coupon'  => 'dashicons-tickets-alt',
		'shop_order'   => 'dashicons-cart',
	);

	/**
	 * Filter the section icons used for WooCommerce post types.
	 *
	 * **Status: Experimental**
	 *
	 * @param array $icons Post type slug => dashicon class.
	 */
	$icons = (array) apply_filters( 'openstation_my_wordpress_woo_section_icons', $icons );

	$name = isset( $post_type->name ) ? (string) $post_type->name : '';
	if ( isset( $icons[ $name ] ) ) {
		$entity['icon'] = (string) $icons[ $name ];
	}

	// Coupons carry no featured image; a thumbnail column would just
	// be a grid of fallback icons.
	if ( 'shop_coupon' === $name ) {
		$entity['thumbnails'] = false;
		$entity['listFields'] = array( 'openstation_woo' );
		$entity['listQuery']  = array( OPENSTATION_WOO_BANDED_PARAM => '1' );
	}

	// Products band by stock and category, both of which ride the
	// `openstation_woo` REST field — declared here so `_fields`
	// doesn't strip it out of the list rows.
	if ( 'product' === $name ) {
		$entity['listFields'] = array( 'openstation_woo' );
		$entity['listQuery']  = array( OPENSTATION_WOO_BANDED_PARAM => '1' );
		// A catalogue is looked at, not read — the product photo is
		// the thing being scanned, and it earns the bigger tile.
		$entity['tileSize']   = 'large';
	}

	return $entity;
}

/**
 * Status bands for the Orders section, ordered so the ones a merchant
 * has to act on come first.
 *
 * Anything WooCommerce (or a plugin) registers that isn't listed here
 * lands in the trailing "Other" band rather than being dropped.
 *
 * @return array[] Each entry: `id`, `label`, `order`, `statuses`.
 */
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

	/**
	 * Filter the status bands the Orders section groups tiles into.
	 *
	 * Each entry declares `id`, `label`, `order` (lower renders
	 * first), and `statuses` — WooCommerce status slugs *without* the
	 * `wc-` prefix. The last band in the list catches every status no
	 * other band claims, so keep a catch-all at the end.
	 *
	 * **Status: Experimental**
	 *
	 * @param array[] $bands Default bands.
	 */
	return (array) apply_filters( 'openstation_my_wordpress_woo_order_bands', $bands );
}

/**
 * Bands for the Products section: anything out of stock first, then a
 * band per product category.
 *
 * Two groupings at once rather than a mode switch — a merchant scanning
 * the catalogue wants the empty shelves surfaced regardless of which
 * category they sit in, and everything else filed where they'd look
 * for it.
 *
 * @return array[] Each entry: `id`, `label`, `order`, and either
 *                 `stock` (a status slug) or `category` (a term slug).
 */
function openstation_my_wordpress_woo_product_bands() {
	return openstation_my_wordpress_woo_count_product_bands(
		openstation_my_wordpress_woo_product_band_defs()
	);
}

/**
 * The product band definitions, without counts.
 *
 * Split from the counted version because the per-product band
 * resolver needs the definitions and the counter needs the resolver —
 * calling one function for both would recurse.
 *
 * @return array[]
 */
function openstation_my_wordpress_woo_product_band_defs() {
	// Category bands only exist when the catalogue is small enough to
	// be ordered by band server-side. Offering them without that
	// ordering is worse than not offering them: rows arrive in date
	// order, so a category band materialises above whatever the user
	// is reading every time a stray row for it turns up. A capped
	// store gets stock bands only, which the meta-key fallback orders
	// correctly.
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
				'label'    => $term->name,
				'order'    => $order,
				'category' => $term->slug,
			);
			$order += 10;
		}
	}

	// Catch-all: everything no earlier band claimed — uncategorised
	// products, or simply "in stock" on a capped catalogue.
	$bands[] = array(
		'id'    => 'cat:__none',
		'label' => $with_categories
			? __( 'Uncategorised', 'desktop-mode' )
			: __( 'In stock', 'desktop-mode' ),
		'order' => PHP_INT_MAX,
	);

	/**
	 * Filter the bands the Products section groups tiles into.
	 *
	 * Each entry declares `id`, `label`, `order` (lower renders
	 * first), and one matcher: `stock` (a WooCommerce stock-status
	 * slug) or `category` (a `product_cat` slug). Keep a matcher-less
	 * catch-all last — it collects everything no other band claims.
	 *
	 * **Status: Experimental**
	 *
	 * @param array[] $bands Default bands.
	 */
	return (array) apply_filters( 'openstation_my_wordpress_woo_product_bands', $bands );
}

/**
 * Attach a row count to every product band.
 *
 * The bundle lays out every band that has rows *before* the first page
 * lands, so bands never appear or reshuffle while the user scrolls —
 * they only fill. That needs counts up front, which is one cheap
 * count query per band, cached because this runs on every admin page
 * load.
 *
 * Counts are the number of products a band *would* claim on its own.
 * A product that is out of stock is claimed by the stock band and
 * skipped by its category band client-side, so a category count can
 * read high by however many of its products are out of stock — an
 * over-estimate that only ever leaves a band laid out and empty, never
 * a band appearing late.
 *
 * @param array[] $bands Band descriptors.
 * @return array[] Bands with a `count` key.
 */
function openstation_my_wordpress_woo_count_product_bands( $bands ) {
	$plan = openstation_my_wordpress_woo_product_plan();
	foreach ( $bands as $i => $band ) {
		$bands[ $i ]['count'] = (int) ( $plan['counts'][ $band['id'] ] ?? 0 );
	}
	return $bands;
}

/**
 * Largest catalogue this integration will band-order.
 *
 * Ordering works by handing WP_Query the full list of product ids in
 * band order, which becomes a `post__in` clause. That's cheap for a
 * normal catalogue and silly for a huge one, so past this size the
 * ordering falls back to stock-status only and the category bands fill
 * progressively.
 */
const OPENSTATION_WOO_MAX_ORDERED_PRODUCTS = 20000;

/**
 * How many products the catalogue holds. Memoized and cached — both
 * the band definitions and the ordering plan need it, and it must not
 * recurse into either.
 *
 * @return int
 */
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

/**
 * Whether the catalogue is too large to band-order server-side.
 *
 * @return bool
 */
function openstation_my_wordpress_woo_catalogue_is_capped() {
	return openstation_my_wordpress_woo_product_total() > OPENSTATION_WOO_MAX_ORDERED_PRODUCTS;
}

/**
 * The band-ordered product id list, plus an exact row count per band.
 *
 * Bands only stop reshuffling if rows *arrive* in band order — laying
 * the bands out ahead of time isn't enough, because a band that fills
 * late still expands above whatever the user is reading. WordPress
 * can't express "order by stock, then by category" in one query, so
 * the order is computed once here (one id query per band, deduped so
 * a product in two categories lands in the first that claims it) and
 * replayed as `post__in` on every page request.
 *
 * Cached, because it runs on every admin page load; flushed whenever a
 * product changes.
 *
 * @return array{ids: int[], counts: array<string,int>, capped: bool}
 */
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
			// Catch-all: whatever no earlier band claimed. Resolved
			// below from the remainder rather than by query — there's
			// no cheap way to ask for "has no product_cat term".
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

	// Anything no band claimed — uncategorised, in stock — trails the
	// list under the catch-all band.
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

/**
 * Query parameter the site window's list requests carry so the band
 * ordering filters can scope themselves. Declared on the section
 * descriptor as `listQuery`, sent by `fetchEntityList()`.
 *
 * The VALUE keeps its pre-rebrand spelling on purpose: it is a
 * persisted or externally-visible identifier, so renaming it would
 * orphan data already written by live installs (or break a live
 * URL). The mismatch between this constant's name and its value is
 * deliberate — it is NOT a half-finished rename.
 */
const OPENSTATION_WOO_BANDED_PARAM = 'desktop_mode_bands';

/**
 * Whether a REST request asked for band ordering.
 *
 * `rest_product_query` / `rest_shop_coupon_query` fire for every caller
 * of those collections, not just us — the Product Collection block
 * renders through the same filter. Without this check a storefront's
 * chosen sort order would be silently replaced by ours.
 *
 * @param WP_REST_Request $request Request.
 * @return bool
 */
function openstation_my_wordpress_woo_is_banded_request( $request ) {
	if ( ! $request instanceof WP_REST_Request ) {
		return false;
	}
	return '1' === (string) $request->get_param( OPENSTATION_WOO_BANDED_PARAM );
}

/**
 * A readable summary of whether the Products collection is being
 * band-ordered, for diagnosing a section whose bands look wrong.
 *
 * @return array{mode: string, products: int, ordered: int, limit: int}
 */
function openstation_my_wordpress_woo_ordering_state() {
	$plan = openstation_my_wordpress_woo_product_plan();
	return array(
		'mode'     => ! empty( $plan['capped'] ) ? 'capped' : 'ordered',
		'products' => (int) ( $plan['products'] ?? 0 ),
		'ordered'  => count( (array) ( $plan['ids'] ?? array() ) ),
		'limit'    => OPENSTATION_WOO_MAX_ORDERED_PRODUCTS,
	);
}

/**
 * Which band a single product belongs to. Stock first, then the first
 * category that claims it, then the catch-all.
 *
 * @param WC_Product $product Product.
 * @return string Band id.
 */
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

/**
 * Drop the cached band counts when the catalogue changes, so a newly
 * emptied shelf shows up on the next load rather than five minutes
 * later.
 *
 * @return void
 */
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

/**
 * Order the Products collection so empty shelves come first.
 *
 * `wp/v2/product` is core's collection, so ordering has to be pushed
 * in through its query filter. `_stock_status` sorts
 * `outofstock` > `onbackorder` > `instock` descending, which is
 * exactly the band order, so a band's rows arrive together instead of
 * trickling in across pages.
 *
 * @param array $args Query args.
 * @return array
 */
function openstation_my_wordpress_woo_order_products( $args, $request ) {
	if ( ! openstation_my_wordpress_woo_active() ) {
		return $args;
	}
	// Only the site window's own requests. `rest_product_query` fires
	// for every `wp/v2/product` caller — WooCommerce Blocks' Product
	// Collection renders through it, so rewriting `orderby`
	// unconditionally would silently replace a storefront's chosen
	// sort with our band order.
	if ( ! openstation_my_wordpress_woo_is_banded_request( $request ) ) {
		return $args;
	}
	// A search is the user asking for relevance, not for the band
	// order — and it would fight the `post__in` clause.
	if ( ! empty( $request['search'] ) ) {
		return $args;
	}

	$plan = openstation_my_wordpress_woo_product_plan();
	if ( empty( $plan['ids'] ) ) {
		// Catalogue too large to order this way — fall back to stock
		// status, which at least floats empty shelves to the top.
		$args['meta_key'] = '_stock_status'; // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
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
// Priority 99, not the default 10. WooCommerce Blocks' own
// `ProductQuery::update_rest_query` also hooks this filter at 10 and
// ends with `array_merge( $args, …, $orderby_query, … )`, where
// `$orderby_query` is rebuilt from the request's `orderby` param —
// which defaults to `date`. At equal priority it runs after us and
// silently puts `orderby` back, so `post__in` was set but never
// honoured and the bands arrived in date order.
add_filter( 'rest_product_query', 'openstation_my_wordpress_woo_order_products', 99, 2 );

/**
 * Bands for the Coupons section: the ones still worth handing out
 * first, the dead ones last.
 *
 * @return array[]
 */
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

	/**
	 * Filter the bands the Coupons section groups tiles into.
	 *
	 * **Status: Experimental**
	 *
	 * @param array[] $bands Default bands.
	 */
	return (array) apply_filters( 'openstation_my_wordpress_woo_coupon_bands', $bands );
}

/**
 * Which band a coupon belongs to.
 *
 * "Expiring soon" is within 30 days — near enough that a merchant
 * might want to extend or replace it before it lapses.
 *
 * @param WC_Coupon $coupon Coupon.
 * @return string Band id.
 */
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

/**
 * The band-ordered coupon id list plus per-band counts.
 *
 * Coupon validity lives in postmeta with no single sortable key, so —
 * as with products — the order is computed once in PHP and replayed as
 * `post__in`. Stores have tens of coupons, not thousands, so the whole
 * set is walked.
 *
 * @return array{ids: int[], counts: array<string,int>}
 */
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

/**
 * Coupon bands with their counts attached, for the bundle.
 *
 * @return array[]
 */
function openstation_my_wordpress_woo_coupon_bands_with_counts() {
	$plan  = openstation_my_wordpress_woo_coupon_plan();
	$bands = openstation_my_wordpress_woo_coupon_bands();
	foreach ( $bands as $i => $band ) {
		$bands[ $i ]['count'] = (int) ( $plan['counts'][ $band['id'] ] ?? 0 );
	}
	return $bands;
}

/**
 * Order the Coupons collection to match the band order.
 *
 * The bridge controller runs Core's `get_items()`, which applies
 * `rest_{$post_type}_query` — so the same `post__in` trick works here
 * even though the collection lives under `desktop-mode/v1`.
 *
 * @param array           $args    Query args.
 * @param WP_REST_Request $request Request.
 * @return array
 */
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

/**
 * Expose each coupon's band on its REST row.
 *
 * @return void
 */
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

/**
 * Expose the few product facts the site window's tiles need — stock
 * status for the out-of-stock band and badge, category slugs for the
 * category bands.
 *
 * A REST field rather than extra work in the bundle: products come
 * from core's `wp/v2/product` collection, so this is the only way to
 * widen that payload. The section declares the field in `listFields`
 * so `_fields` doesn't strip it back out.
 *
 * @return void
 */
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
					// The band this row belongs to, decided server-side
					// by the same rules that ordered the collection, so
					// the two can't disagree.
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

/**
 * Boot the integration's hooks. Called from the module bootstrap;

/**
 * Boot the integration's hooks. Called from the module bootstrap;
 * every callback re-checks `openstation_my_wordpress_woo_active()`
 * because WooCommerce loads on `plugins_loaded`, after this file.
 *
 * @return void
 */
function openstation_my_wordpress_woo_boot() {
	add_filter( 'openstation_my_wordpress_post_type_group', 'openstation_my_wordpress_woo_group', 10, 2 );
	add_filter( 'openstation_my_wordpress_entities', 'openstation_my_wordpress_woo_entities', 5 );
	add_filter( 'openstation_my_wordpress_post_type_entity', 'openstation_my_wordpress_woo_entity_icon', 10, 2 );
}
openstation_my_wordpress_woo_boot();

/* -------------------------------------------------------------------
 * REST
 * ---------------------------------------------------------------- */

/**
 * Whether the current user may read order data.
 *
 * @return true|WP_Error
 */
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

/**
 * Shape an order as a post-shaped row so the site window's existing
 * list and detail fetchers consume it unchanged.
 *
 * @param WC_Abstract_Order $order Order.
 * @param bool              $full  Include the `content` field (detail view).
 * @return array
 */
function openstation_my_wordpress_woo_order_row( $order, $full = false ) {
	$total = html_entity_decode(
		wp_strip_all_tags( wc_price( $order->get_total(), array( 'currency' => $order->get_currency() ) ) ),
		ENT_QUOTES,
		get_bloginfo( 'charset' )
	);

	$row = array(
		'id'             => $order->get_id(),
		// Tiles show a single line — number and total are what a
		// merchant scans for; everything else lives in the pane.
		'title'          => array(
			'rendered' => sprintf(
				/* translators: 1: order number, 2: formatted order total. */
				__( '#%1$s · %2$s', 'desktop-mode' ),
				$order->get_order_number(),
				$total
			),
		),
		'excerpt'        => array( 'rendered' => '' ),
		'date'           => $order->get_date_created()
			? $order->get_date_created()->date( 'c' )
			: '',
		// Deliberately `publish`: the tile's status ribbon only speaks
		// draft/pending/private/future, and a `wc-processing` value
		// would paint a meaningless ribbon on every order. The real
		// status is in the pane.
		'status'         => 'publish',
		// Refunds and custom order types don't carry an edit URL.
		'link'           => method_exists( $order, 'get_edit_order_url' )
			? $order->get_edit_order_url()
			: '',
		'featured_media' => 0,
		// The real status, for the tile bands. Kept out of `status`
		// above on purpose — see the note there. Declared in the
		// section's `listFields` so `_fields` doesn't strip it.
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

/**
 * Per-band counts for the Orders section, in display order.
 *
 * Each entry is `array( 'statuses' => string[], 'count' => int )`. The
 * catch-all band (the one declaring no statuses) collects every status
 * no earlier band claimed, so nothing is dropped and nothing is
 * counted twice.
 *
 * @param array $base Shared `wc_get_orders()` args (search, ordering).
 * @return array[]
 */
function openstation_my_wordpress_woo_order_band_slices( $base ) {
	$all    = array_map(
		static function ( $status ) {
			return substr( $status, 3 ); // Strip the `wc-` prefix.
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
			// Catch-all: whatever no earlier band took.
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

/**
 * `GET /woocommerce/orders` — paginated, post-shaped order list.
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response
 */
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

	/**
	 * Filter the query args for the site window's Orders section.
	 *
	 * Merged into every per-band query — `status`, `limit`, `offset`
	 * and `paginate` are set by the band walker and will be
	 * overwritten.
	 *
	 * **Status: Experimental**
	 *
	 * @param array           $args    `wc_get_orders()` args.
	 * @param WP_REST_Request $request The request.
	 */
	$base = (array) apply_filters( 'openstation_my_wordpress_woo_order_args', $base, $request );

	// Walk the status bands in display order and slice the requested
	// page out of the concatenation. Without this the client gets a
	// date-ordered page and bands materialise in whatever order their
	// first row happens to arrive, so the grouping visibly reshuffles
	// as the user scrolls. Ordering server-side means each band's rows
	// arrive together, in band order, and a band never appears above
	// content the user has already scrolled past.
	$slices = openstation_my_wordpress_woo_order_band_slices( $base );

	$total  = 0;
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
		// Skip bands that end before the requested offset.
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

		$orders    = array_merge( $orders, $batch );
		$remaining -= count( $batch );
		$cursor    += $count;
		$offset     = $cursor;
	}

	$results = (object) array(
		'orders'        => $orders,
		'total'         => $total,
		'max_num_pages' => max( 1, $pages ),
	);

	// `wc_get_orders()` returns a plain array unless `paginate` is
	// honoured by the active data store. Handle both so a store with
	// a custom order data store can't collapse the folder to empty.
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
		// A data store may hand back ids rather than objects.
		$order = is_scalar( $maybe_order ) ? wc_get_order( (int) $maybe_order ) : $maybe_order;

		// `WC_Abstract_Order`, not `WC_Order`: that's the type every
		// order class actually extends, including HPOS's overrides and
		// whatever a custom order type registers. Testing against
		// `WC_Order` silently dropped every row on some stores while
		// `total` still reported hundreds — an empty folder with a
		// confident count on its tile.
		if ( ! $order instanceof WC_Abstract_Order ) {
			++$skipped;
			continue;
		}
		try {
			$rows[] = openstation_my_wordpress_woo_order_row( $order );
		} catch ( Throwable $e ) {
			++$skipped;
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
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
	// Surfaced so an empty-folder-with-a-count can be diagnosed from
	// the network tab instead of guessed at.
	$response->header( 'X-Desktop-Mode-Woo-Rows', (string) count( $rows ) );
	$response->header( 'X-Desktop-Mode-Woo-Skipped', (string) $skipped );
	return $response;
}

/**
 * `GET /woocommerce/orders/<id>` — one post-shaped order.
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
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

/**
 * Format an amount in the store's currency, entity-decoded so the
 * bundle can render it as text.
 *
 * @param float       $amount   Amount.
 * @param string|null $currency Currency code.
 * @return string
 */
function openstation_my_wordpress_woo_price( $amount, $currency = null ) {
	$args = $currency ? array( 'currency' => $currency ) : array();
	return html_entity_decode(
		wp_strip_all_tags( wc_price( (float) $amount, $args ) ),
		ENT_QUOTES,
		get_bloginfo( 'charset' )
	);
}

/**
 * Merchant facts for one product.
 *
 * @param int $id Product id.
 * @return array|WP_Error
 */
function openstation_my_wordpress_woo_product_summary( $id ) {
	$product = wc_get_product( $id );
	if ( ! $product ) {
		return new WP_Error(
			'openstation_woo_no_product',
			__( 'Product not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	$on_sale     = $product->is_on_sale();
	$stock_status = $product->get_stock_status();
	$stock_labels = array(
		'instock'     => __( 'In stock', 'desktop-mode' ),
		'outofstock'  => __( 'Out of stock', 'desktop-mode' ),
		'onbackorder' => __( 'On backorder', 'desktop-mode' ),
	);

	$categories = wp_get_post_terms( $product->get_id(), 'product_cat', array( 'fields' => 'names' ) );

	// `wc_get_product_types()` is the registry — there is no
	// per-type label helper.
	$types      = function_exists( 'wc_get_product_types' ) ? wc_get_product_types() : array();
	$type       = $product->get_type();
	$type_label = isset( $types[ $type ] ) ? (string) $types[ $type ] : ucfirst( (string) $type );

	return array(
		'type'       => 'product',
		'sku'        => $product->get_sku(),
		'price'      => openstation_my_wordpress_woo_price( $product->get_price() ),
		'regular'    => $on_sale ? openstation_my_wordpress_woo_price( $product->get_regular_price() ) : '',
		'onSale'     => $on_sale,
		// Raw slug alongside the label: the bundle tints the stock
		// pill from the slug, which no translation can break.
		'stockStatus' => $stock_status,
		'stockLabel' => $stock_labels[ $stock_status ] ?? $stock_status,
		'stockLevel' => $product->managing_stock() ? (int) $product->get_stock_quantity() : null,
		'sold'       => (int) $product->get_total_sales(),
		'rating'     => (float) $product->get_average_rating(),
		'reviews'    => (int) $product->get_review_count(),
		'productType' => $type_label,
		'variations' => $product->is_type( 'variable' ) ? count( $product->get_children() ) : 0,
		'categories' => is_wp_error( $categories ) ? array() : array_values( $categories ),
		'permalink'  => (string) $product->get_permalink(),
		'editUrl'    => (string) get_edit_post_link( $product->get_id(), 'raw' ),
	);
}

/**
 * Merchant facts for one order.
 *
 * @param int $id Order id.
 * @return array|WP_Error
 */
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
		// Variations edit through their parent product's screen.
		$edit_id    = $product_id;
		$items[]    = array(
			'name'     => $item->get_name(),
			'quantity' => (int) $item->get_quantity(),
			'total'    => openstation_my_wordpress_woo_price( $item->get_total(), $order->get_currency() ),
			'id'       => $product_id,
			// A line item whose product has since been deleted has no
			// edit screen to link to; the bundle renders plain text.
			'editUrl'  => $edit_id && get_post( $edit_id )
				? (string) get_edit_post_link( $edit_id, 'raw' )
				: '',
		);
	}

	// Refunds and custom order types don't carry billing accessors.
	$name        = method_exists( $order, 'get_formatted_billing_full_name' )
		? trim( $order->get_formatted_billing_full_name() )
		: '';
	$customer_id = method_exists( $order, 'get_customer_id' )
		? (int) $order->get_customer_id()
		: 0;

	return array(
		'type'          => 'order',
		'number'        => $order->get_order_number(),
		'status'        => $order->get_status(),
		'statusLabel'   => $statuses[ $status ] ?? $order->get_status(),
		'total'         => openstation_my_wordpress_woo_price( $order->get_total(), $order->get_currency() ),
		'subtotal'      => openstation_my_wordpress_woo_price( $order->get_subtotal(), $order->get_currency() ),
		'shipping'      => (float) $order->get_shipping_total() > 0
			? openstation_my_wordpress_woo_price( $order->get_shipping_total(), $order->get_currency() )
			: '',
		'discount'      => (float) $order->get_discount_total() > 0
			? openstation_my_wordpress_woo_price( $order->get_discount_total(), $order->get_currency() )
			: '',
		'coupons'       => array_values(
			array_map(
				static function ( $coupon ) {
					return $coupon->get_code();
				},
				$order->get_items( 'coupon' )
			)
		),
		'paymentVia'    => $order->get_payment_method_title(),
		'datePaid'      => $order->get_date_paid() ? $order->get_date_paid()->date( 'c' ) : '',
		'placed'        => $order->get_date_created() ? $order->get_date_created()->date( 'c' ) : '',
		'customer'      => '' !== $name ? $name : __( 'Guest', 'desktop-mode' ),
		'customerUrl'   => $customer_id && current_user_can( 'edit_user', $customer_id )
			? (string) get_edit_user_link( $customer_id )
			: '',
		'email'         => $order->get_billing_email(),
		'itemCount'     => $order->get_item_count(),
		'items'         => $items,
		'editUrl'       => method_exists( $order, 'get_edit_order_url' )
			? $order->get_edit_order_url()
			: '',
	);
}

/**
 * Total discount a coupon has actually given customers — the number a
 * merchant wants and WooCommerce never surfaces.
 *
 * There's no aggregate for this, so it means walking paid orders and
 * summing the matching coupon line items. Bounded to the most recent
 * 500 orders and cached, because the coupon preview pane hits this on
 * every selection and the scan is by far the most expensive thing in
 * the summary.
 *
 * @param WC_Coupon $coupon Coupon.
 * @return float Total discount given.
 */
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

/**
 * Merchant facts for one coupon.
 *
 * @param int $id Coupon id.
 * @return array|WP_Error
 */
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

	// "Active" is expiry + usage-limit only. WooCommerce's full
	// validity check needs a cart to run against, and a coupon that
	// merely doesn't apply to the current (empty) cart isn't inactive.
	$expired = $expiry && $expiry->getTimestamp() < time();
	$used_up = $limit > 0 && $used >= $limit;

	$type_label = 'percent' === $coupon->get_discount_type()
		? sprintf(
			/* translators: %s: percentage off. */
			__( '%s%% off', 'desktop-mode' ),
			wc_format_localized_decimal( $coupon->get_amount() )
		)
		: sprintf(
			/* translators: %s: formatted discount amount. */
			__( '%s off', 'desktop-mode' ),
			openstation_my_wordpress_woo_price( $coupon->get_amount() )
		);

	// Resolve product / category restrictions to names with links —
	// WooCommerce's own coupon screen shows these as bare token
	// fields you have to click into.
	$link_terms = static function ( array $ids, $taxonomy ) {
		$out = array();
		foreach ( $ids as $id ) {
			$term = get_term( (int) $id, $taxonomy );
			if ( $term && ! is_wp_error( $term ) ) {
				$out[] = array(
					'label'   => $term->name,
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
					'label'   => $product->get_name(),
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

/**
 * `GET /woocommerce/summary/<type>/<id>`.
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
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
			return new WP_Error(
				'openstation_woo_bad_type',
				__( 'Unknown summary type.', 'desktop-mode' ),
				array( 'status' => 400 )
			);
	}

	if ( is_wp_error( $data ) ) {
		return $data;
	}

	/**
	 * Filter the merchant summary shown in the site window's right
	 * pane for a product, order, or coupon.
	 *
	 * **Status: Experimental**
	 *
	 * @param array  $data Summary payload.
	 * @param string $type One of `product`, `order`, `coupon`.
	 * @param int    $id   Object id.
	 */
	return rest_ensure_response(
		(array) apply_filters( 'openstation_my_wordpress_woo_summary', $data, $type, $id )
	);
}

/**
 * Permission check for a summary request — the capability depends on
 * what is being summarised.
 *
 * @param WP_REST_Request $request Request.
 * @return true|WP_Error
 */
function openstation_my_wordpress_woo_summary_permission( $request ) {
	$type = (string) $request['type'];
	$id   = (int) $request['id'];

	if ( 'order' === $type ) {
		return openstation_my_wordpress_woo_orders_permission();
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

/**
 * `GET /woocommerce/store` — headline numbers for the Woo folder.
 *
 * Deliberately three cheap queries: a revenue sum over paid orders
 * this month, a count of orders awaiting action, and a low-stock
 * count. Anything heavier belongs in WooCommerce Analytics.
 *
 * @return WP_REST_Response
 */
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

	// Read the statuses straight off the "Needs attention" band rather
	// than repeating them. They had drifted: the band counted
	// pending + processing + on-hold while this counted only the last
	// two, so the folder and the panel disagreed by every pending
	// order on the store.
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
		'revenue'     => openstation_my_wordpress_woo_price( $revenue ),
		'revenueRaw'  => round( $revenue, 2 ),
		'processing'  => isset( $processing->total ) ? (int) $processing->total : 0,
		'outOfStock'  => is_array( $low_stock ) ? count( $low_stock ) : 0,
		'ordersUrl'   => admin_url( 'admin.php?page=wc-orders' ),
	);

	/**
	 * Filter the store headline numbers shown on the Woo folder.
	 *
	 * **Status: Experimental**
	 *
	 * @param array $data Store totals.
	 */
	return rest_ensure_response(
		(array) apply_filters( 'openstation_my_wordpress_woo_store', $data )
	);
}

/**
 * Register the integration's REST routes.
 *
 * @return void
 */
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

/* -------------------------------------------------------------------
 * Assets
 * ---------------------------------------------------------------- */

/**
 * Register the integration bundle.
 *
 * @return void
 */
function openstation_my_wordpress_woo_register_assets() {
	wp_register_script(
		'os-my-wordpress-woocommerce',
		OPENSTATION_URL . 'assets/js/my-wordpress-woocommerce' . ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ? '' : '.min' ) . '.js',
		array( 'wp-hooks' ),
		OPENSTATION_VERSION,
		true
	);
	wp_set_script_translations( 'os-my-wordpress-woocommerce', 'desktop-mode' );

	wp_register_style(
		'os-my-wordpress-woocommerce',
		OPENSTATION_URL . 'assets/css/my-wordpress-woocommerce.css',
		array( 'desktop-mode-my-wordpress' ),
		OPENSTATION_VERSION
	);
}
add_action( 'init', 'openstation_my_wordpress_woo_register_assets', 5 );

/**
 * Enqueue the integration bundle.
 *
 * Only for users who can open the site window on a store — everyone
 * else pays nothing. The bundle subscribes to the site window's
 * `preview-extras` / `group-extras` actions, which is why it has to be
 * present before the (lazily loaded) window bundle paints.
 *
 * @return void
 */
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

	wp_enqueue_script( 'os-my-wordpress-woocommerce' );
	wp_enqueue_style( 'os-my-wordpress-woocommerce' );
	wp_add_inline_script(
		'os-my-wordpress-woocommerce',
		sprintf(
			'window.openStationWooConfig=%s;',
			wp_json_encode(
				array(
					'restRoot'   => esc_url_raw( rest_url( 'desktop-mode/v1/woocommerce/' ) ),
					'restNonce'  => wp_create_nonce( 'wp_rest' ),
					'canOrders'    => true === openstation_my_wordpress_woo_orders_permission(),
					'orderBands'   => openstation_my_wordpress_woo_order_bands(),
					'productBands' => openstation_my_wordpress_woo_product_bands(),
					'couponBands'  => openstation_my_wordpress_woo_coupon_bands_with_counts(),
					// Whether the catalogue is small enough to be
					// band-ordered server-side. Read it from the
					// console (`window.openStationWooConfig.ordering`)
					// when the Products bands look wrong: `capped`
					// means rows arrive stock-ordered only and the
					// category bands fill progressively.
					'ordering'     => openstation_my_wordpress_woo_ordering_state(),
				)
			)
		),
		'before'
	);
}
add_action( 'admin_enqueue_scripts', 'openstation_my_wordpress_woo_enqueue', 20 );
