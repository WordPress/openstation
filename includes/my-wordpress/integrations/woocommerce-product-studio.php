<?php
/**
 * OpenStation — WooCommerce Product Studio.
 *
 * A guided native product-creation flow backed by WooCommerce's CRUD
 * API. The browser sends a nonce-authenticated multipart request; the
 * server owns capability checks, validation, media ingestion, and the
 * final `WC_Product_Simple` save. No REST consumer key is exposed to
 * JavaScript.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Whether the current user may create products.
 *
 * @return true|WP_Error
 */
function openstation_my_wordpress_woo_product_studio_permission() {
	$products = get_post_type_object( 'product' );
	$cap      = $products instanceof WP_Post_Type && ! empty( $products->cap->edit_posts )
		? $products->cap->edit_posts
		: 'edit_products';

	if ( ! current_user_can( $cap ) ) {
		return new WP_Error(
			'openstation_woo_product_forbidden',
			__( 'Sorry, you are not allowed to create products.', 'desktop-mode' ),
			array( 'status' => rest_authorization_required_code() )
		);
	}

	return true;
}

/**
 * Whether the current user may publish products.
 *
 * @return bool
 */
function openstation_my_wordpress_woo_product_studio_can_publish() {
	$products = get_post_type_object( 'product' );
	$cap      = $products instanceof WP_Post_Type && ! empty( $products->cap->publish_posts )
		? $products->cap->publish_posts
		: 'publish_products';

	return current_user_can( $cap );
}

/**
 * Product Studio bootstrap data.
 *
 * @return WP_REST_Response
 */
function openstation_my_wordpress_woo_product_studio_bootstrap() {
	$terms = get_terms(
		array(
			'taxonomy'   => 'product_cat',
			'hide_empty' => false,
			'orderby'    => 'name',
			'order'      => 'ASC',
		)
	);

	$categories = array();
	if ( ! is_wp_error( $terms ) ) {
		foreach ( $terms as $term ) {
			$categories[] = array(
				'id'     => (int) $term->term_id,
				'name'   => (string) $term->name,
				'parent' => (int) $term->parent,
				'count'  => (int) $term->count,
			);
		}
	}

	return rest_ensure_response(
		array(
			'categories'     => $categories,
			'currencyCode'   => get_woocommerce_currency(),
			// WooCommerce returns symbols HTML-entity encoded (for example
			// `&#36;`). REST clients assign this value with `textContent`, so
			// send the actual glyph instead of leaking the entity into the UI.
			'currencySymbol' => html_entity_decode(
				(string) get_woocommerce_currency_symbol(),
				ENT_QUOTES | ENT_HTML5,
				'UTF-8'
			),
			'priceDecimals'  => wc_get_price_decimals(),
			'canPublish'     => openstation_my_wordpress_woo_product_studio_can_publish(),
			'maxImageBytes'  => wp_max_upload_size(),
			'maxImageLabel'  => size_format( wp_max_upload_size() ),
			'placeholderUrl' => OPENSTATION_URL . 'assets/images/woo-product-studio-placeholder.webp',
		)
	);
}

/**
 * Parse a boolean-ish multipart request value.
 *
 * @param mixed $value Raw request value.
 * @return bool
 */
function openstation_my_wordpress_woo_product_studio_bool( $value ) {
	return in_array( $value, array( true, 1, '1', 'true', 'yes', 'on' ), true );
}

/**
 * Validate the idempotency key carried by a product-creation request.
 *
 * @param mixed $raw Raw request value.
 * @return string|WP_Error
 */
function openstation_my_wordpress_woo_product_studio_request_id( $raw ) {
	$request_id = sanitize_text_field( (string) $raw );
	if ( ! preg_match( '/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i', $request_id ) ) {
		return new WP_Error(
			'openstation_woo_product_request_id_invalid',
			__( 'The product request could not be identified safely. Reload Product Studio and try again.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	return strtolower( $request_id );
}

/**
 * Acquire an atomic, short-lived lock for one user's creation request.
 *
 * WordPress option names are unique, so `add_option()` lets only one
 * concurrent request enter the media/product write section. A stale
 * lock is recoverable after five minutes if PHP exited unexpectedly.
 *
 * @param string $request_id Validated request id.
 * @return string|WP_Error Lock option name on success.
 */
function openstation_my_wordpress_woo_product_studio_acquire_lock( $request_id ) {
	$lock_name = '_openstation_woo_product_studio_lock_' . hash(
		'sha256',
		get_current_user_id() . ':' . $request_id
	);
	$now       = time();
	if ( add_option( $lock_name, $now, '', 'no' ) ) {
		return $lock_name;
	}

	$started = (int) get_option( $lock_name, 0 );
	if ( $started > 0 && ( $now - $started ) > 5 * MINUTE_IN_SECONDS ) {
		delete_option( $lock_name );
		if ( add_option( $lock_name, $now, '', 'no' ) ) {
			return $lock_name;
		}
	}

	return new WP_Error(
		'openstation_woo_product_request_in_progress',
		__( 'This product is already being created. Wait a moment, then try again.', 'desktop-mode' ),
		array( 'status' => 409 )
	);
}

/**
 * Release a Product Studio creation lock.
 *
 * @param string $lock_name Lock option name.
 * @return void
 */
function openstation_my_wordpress_woo_product_studio_release_lock( $lock_name ) {
	delete_option( $lock_name );
}

/**
 * Find a product already created for this user and request id.
 *
 * @param string $request_id Validated request id.
 * @return WC_Product|false
 */
function openstation_my_wordpress_woo_product_studio_existing_product( $request_id ) {
	$product_ids = get_posts(
		array(
			'post_type'              => 'product',
			'post_status'            => 'any',
			'posts_per_page'         => 1,
			'orderby'                => 'ID',
			'order'                  => 'DESC',
			'fields'                 => 'ids',
			'no_found_rows'          => true,
			'update_post_meta_cache' => false,
			'update_post_term_cache' => false,
			'meta_query'             => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- one exact, user-scoped retry lookup.
				'relation' => 'AND',
				array(
					'key'   => '_openstation_product_studio_request_id',
					'value' => $request_id,
				),
				array(
					'key'     => '_openstation_product_studio_user_id',
					'value'   => get_current_user_id(),
					'compare' => '=',
					'type'    => 'NUMERIC',
				),
			),
		)
	);
	if ( empty( $product_ids[0] ) ) {
		return false;
	}

	$product = wc_get_product( (int) $product_ids[0] );
	return $product instanceof WC_Product ? $product : false;
}

/**
 * Build the stable API response for a created or replayed product.
 *
 * @param WC_Product $product  Product instance.
 * @param int        $status   HTTP status.
 * @param bool       $replayed Whether an earlier request created it.
 * @return WP_REST_Response
 */
function openstation_my_wordpress_woo_product_studio_product_response( $product, $status = 201, $replayed = false ) {
	$product_id = (int) $product->get_id();
	$image_id   = (int) $product->get_image_id();
	$response   = new WP_REST_Response(
		array(
			'id'        => $product_id,
			'name'      => $product->get_name(),
			'status'    => $product->get_status(),
			'price'     => html_entity_decode( wp_strip_all_tags( wc_price( $product->get_price() ) ), ENT_QUOTES, get_bloginfo( 'charset' ) ),
			'editUrl'   => (string) get_edit_post_link( $product_id, 'raw' ),
			'viewUrl'   => 'publish' === $product->get_status() ? (string) get_permalink( $product_id ) : '',
			'thumbnail' => $image_id ? (string) wp_get_attachment_image_url( $image_id, 'medium' ) : '',
			'replayed'  => (bool) $replayed,
		),
		$status
	);
	if ( $replayed ) {
		$response->header( 'X-OpenStation-Idempotent-Replay', 'true' );
	}

	return $response;
}

/**
 * Parse selected product category ids from a multipart request.
 *
 * @param mixed $raw Raw JSON string or array.
 * @return int[]|WP_Error
 */
function openstation_my_wordpress_woo_product_studio_categories( $raw ) {
	if ( is_string( $raw ) ) {
		if ( '' === trim( $raw ) ) {
			$raw = array();
		} else {
			$decoded = json_decode( $raw, true );
			if ( ! is_array( $decoded ) ) {
				return new WP_Error(
					'openstation_woo_product_categories_invalid',
					__( 'The selected product categories are invalid.', 'desktop-mode' ),
					array( 'status' => 400 )
				);
			}
			$raw = $decoded;
		}
	}
	if ( ! is_array( $raw ) ) {
		return new WP_Error(
			'openstation_woo_product_categories_invalid',
			__( 'The selected product categories are invalid.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	foreach ( $raw as $value ) {
		if (
			( ! is_int( $value ) && ! ( is_string( $value ) && ctype_digit( $value ) ) ) ||
			(int) $value < 1
		) {
			return new WP_Error(
				'openstation_woo_product_categories_invalid',
				__( 'The selected product categories are invalid.', 'desktop-mode' ),
				array( 'status' => 400 )
			);
		}
	}
	$ids = array_values( array_unique( array_filter( array_map( 'absint', $raw ) ) ) );
	foreach ( $ids as $id ) {
		if ( ! term_exists( $id, 'product_cat' ) ) {
			return new WP_Error(
				'openstation_woo_product_category_missing',
				__( 'One of the selected product categories no longer exists.', 'desktop-mode' ),
				array( 'status' => 400 )
			);
		}
	}

	return $ids;
}

/**
 * Validate and ingest an optional product image.
 *
 * @param WP_REST_Request $request REST request.
 * @param string          $title   Attachment title fallback.
 * @return int|WP_Error Attachment id, or zero when no image was sent.
 */
function openstation_my_wordpress_woo_product_studio_image( WP_REST_Request $request, $title ) {
	$files = $request->get_file_params();
	$file  = isset( $files['image'] ) && is_array( $files['image'] ) ? $files['image'] : null;
	if ( ! $file || UPLOAD_ERR_NO_FILE === (int) ( $file['error'] ?? UPLOAD_ERR_NO_FILE ) ) {
		return 0;
	}

	if ( ! current_user_can( 'upload_files' ) ) {
		return new WP_Error(
			'openstation_woo_product_image_forbidden',
			__( 'Sorry, you are not allowed to upload product images.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	if ( UPLOAD_ERR_OK !== (int) ( $file['error'] ?? UPLOAD_ERR_NO_FILE ) || empty( $file['tmp_name'] ) ) {
		return new WP_Error(
			'openstation_woo_product_image_upload_failed',
			__( 'The product image could not be uploaded.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$file_size = (int) ( $file['size'] ?? 0 );
	if ( $file_size <= 0 ) {
		return new WP_Error(
			'openstation_woo_product_image_empty',
			__( 'The product image is empty.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	if ( $file_size > wp_max_upload_size() ) {
		return new WP_Error(
			'openstation_woo_product_image_too_large',
			__( 'The product image is larger than this site allows.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$checked = wp_check_filetype_and_ext(
		(string) $file['tmp_name'],
		sanitize_file_name( (string) ( $file['name'] ?? '' ) )
	);

	$allowed_types = array( 'image/jpeg', 'image/png', 'image/gif', 'image/webp' );
	if ( empty( $checked['type'] ) || ! in_array( $checked['type'], $allowed_types, true ) ) {
		return new WP_Error(
			'openstation_woo_product_image_invalid',
			__( 'Choose a valid JPEG, PNG, GIF, or WebP product image.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	require_once ABSPATH . 'wp-admin/includes/file.php';
	require_once ABSPATH . 'wp-admin/includes/image.php';
	require_once ABSPATH . 'wp-admin/includes/media.php';

	$attachment_id = media_handle_sideload( $file, 0, $title );
	if ( is_wp_error( $attachment_id ) ) {
		return new WP_Error(
			'openstation_woo_product_image_upload_failed',
			$attachment_id->get_error_message(),
			array( 'status' => 400 )
		);
	}

	update_post_meta( $attachment_id, '_wp_attachment_image_alt', $title );
	return (int) $attachment_id;
}

/**
 * Create a simple WooCommerce product from the guided flow.
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response|WP_Error
 * @throws RuntimeException Internally when WooCommerce returns no product id; converted to `WP_Error` before returning.
 */
function openstation_my_wordpress_woo_product_studio_create( WP_REST_Request $request ) {
	if ( ! class_exists( 'WC_Product_Simple' ) ) {
		return new WP_Error(
			'openstation_woo_product_api_unavailable',
			__( 'WooCommerce product creation is unavailable.', 'desktop-mode' ),
			array( 'status' => 503 )
		);
	}
	$request_id = openstation_my_wordpress_woo_product_studio_request_id( $request->get_param( 'requestId' ) );
	if ( is_wp_error( $request_id ) ) {
		return $request_id;
	}
	$existing = openstation_my_wordpress_woo_product_studio_existing_product( $request_id );
	if ( $existing ) {
		return openstation_my_wordpress_woo_product_studio_product_response( $existing, 200, true );
	}

	$name              = sanitize_text_field( (string) $request->get_param( 'name' ) );
	$description       = wp_kses_post( (string) $request->get_param( 'description' ) );
	$short_description = wp_kses_post( (string) $request->get_param( 'shortDescription' ) );
	$status            = sanitize_key( (string) $request->get_param( 'status' ) );
	$sku               = sanitize_text_field( (string) $request->get_param( 'sku' ) );
	$regular_raw       = trim( (string) $request->get_param( 'regularPrice' ) );
	$sale_raw          = trim( (string) $request->get_param( 'salePrice' ) );
	$regular_price     = '' === $regular_raw ? '' : wc_format_decimal( $regular_raw, wc_get_price_decimals() );
	$sale_price        = '' === $sale_raw ? '' : wc_format_decimal( $sale_raw, wc_get_price_decimals() );

	if ( '' === $name ) {
		return new WP_Error(
			'openstation_woo_product_name_required',
			__( 'Give the product a name before saving it.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	$decimal_pattern = '/^(?:\d+|\d*\.\d+)$/D';
	if ( '' !== $regular_raw && ! preg_match( $decimal_pattern, $regular_raw ) ) {
		return new WP_Error(
			'openstation_woo_product_regular_price_invalid',
			__( 'Enter a valid regular price.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	if ( '' !== $sale_raw && ! preg_match( $decimal_pattern, $sale_raw ) ) {
		return new WP_Error(
			'openstation_woo_product_sale_price_invalid',
			__( 'The sale price must be lower than the regular price.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	if ( ! in_array( $status, array( 'draft', 'publish' ), true ) ) {
		$status = 'draft';
	}
	if ( 'publish' === $status && ! openstation_my_wordpress_woo_product_studio_can_publish() ) {
		return new WP_Error(
			'openstation_woo_product_publish_forbidden',
			__( 'Sorry, you are not allowed to publish products.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}
	if ( 'publish' === $status && '' === $regular_price ) {
		return new WP_Error(
			'openstation_woo_product_price_required',
			__( 'Set a regular price before publishing the product.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	if ( '' !== $sale_price && ( '' === $regular_price || (float) $sale_price >= (float) $regular_price ) ) {
		return new WP_Error(
			'openstation_woo_product_sale_price_invalid',
			__( 'The sale price must be lower than the regular price.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	if ( '' !== $sku && function_exists( 'wc_product_has_unique_sku' ) && ! wc_product_has_unique_sku( 0, $sku ) ) {
		return new WP_Error(
			'openstation_woo_product_sku_exists',
			__( 'That SKU is already used by another product.', 'desktop-mode' ),
			array( 'status' => 409 )
		);
	}

	$manage_stock       = openstation_my_wordpress_woo_product_studio_bool( $request->get_param( 'manageStock' ) );
	$virtual            = openstation_my_wordpress_woo_product_studio_bool( $request->get_param( 'virtual' ) );
	$stock_quantity_raw = trim( (string) $request->get_param( 'stockQuantity' ) );
	if (
		! $virtual &&
		$manage_stock &&
		(
			'' === $stock_quantity_raw ||
			! ctype_digit( $stock_quantity_raw ) ||
			(float) $stock_quantity_raw > PHP_INT_MAX
		)
	) {
		return new WP_Error(
			'openstation_woo_product_stock_quantity_invalid',
			__( 'Enter a whole-number stock quantity of zero or more.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$stock_status   = sanitize_key( (string) $request->get_param( 'stockStatus' ) );
	$stock_status   = in_array( $stock_status, array( 'instock', 'outofstock', 'onbackorder' ), true )
		? $stock_status
		: 'instock';
	$stock_quantity = '' === $stock_quantity_raw ? 0 : (int) $stock_quantity_raw;
	if ( $virtual ) {
		$manage_stock = false;
	} elseif ( $manage_stock ) {
		$stock_status = $stock_quantity > 0 ? 'instock' : 'outofstock';
	}

	$categories = openstation_my_wordpress_woo_product_studio_categories( $request->get_param( 'categoryIds' ) );
	if ( is_wp_error( $categories ) ) {
		return $categories;
	}
	$lock_name = openstation_my_wordpress_woo_product_studio_acquire_lock( $request_id );
	if ( is_wp_error( $lock_name ) ) {
		return $lock_name;
	}
	$image_id = 0;
	$product  = null;
	try {
		$existing = openstation_my_wordpress_woo_product_studio_existing_product( $request_id );
		if ( $existing ) {
			return openstation_my_wordpress_woo_product_studio_product_response( $existing, 200, true );
		}
		$image_id = openstation_my_wordpress_woo_product_studio_image( $request, $name );
		if ( is_wp_error( $image_id ) ) {
			return $image_id;
		}
		$product = new WC_Product_Simple();
		$product->set_name( $name );
		$product->set_status( $status );
		$product->set_description( $description );
		$product->set_short_description( $short_description );
		$product->set_regular_price( $regular_price );
		$product->set_sale_price( $sale_price );
		$product->set_price( '' !== $sale_price ? $sale_price : $regular_price );
		$product->set_sku( $sku );
		$product->set_virtual( $virtual );
		$product->set_manage_stock( $manage_stock );
		if ( $manage_stock ) {
			$product->set_stock_quantity( $stock_quantity );
		}
		$product->set_stock_status( $stock_status );
		$product->set_category_ids( $categories );
		if ( $image_id ) {
			$product->set_image_id( $image_id );
		}
		$product->update_meta_data( '_openstation_product_studio_request_id', $request_id );
		$product->update_meta_data( '_openstation_product_studio_user_id', get_current_user_id() );

		$product_id = $product->save();
		if ( ! $product_id ) {
			throw new RuntimeException( 'WooCommerce returned an empty product id.' );
		}

		if ( $image_id ) {
			wp_update_post(
				array(
					'ID'          => $image_id,
					'post_parent' => $product_id,
				)
			);
		}
	} catch ( Throwable $error ) {
		$saved_product = openstation_my_wordpress_woo_product_studio_existing_product( $request_id );
		if ( $saved_product ) {
			if ( $image_id ) {
				wp_update_post(
					array(
						'ID'          => $image_id,
						'post_parent' => $saved_product->get_id(),
					)
				);
			}
			return openstation_my_wordpress_woo_product_studio_product_response( $saved_product, 201, true );
		}
		if ( $image_id ) {
			wp_delete_attachment( $image_id, true );
		}
		$message = $error instanceof WC_Data_Exception
			? $error->getMessage()
			: __( 'WooCommerce could not save the product.', 'desktop-mode' );

		return new WP_Error(
			'openstation_woo_product_save_failed',
			$message,
			array( 'status' => 400 )
		);
	} finally {
		openstation_my_wordpress_woo_product_studio_release_lock( $lock_name );
	}

	return openstation_my_wordpress_woo_product_studio_product_response( $product );
}

/**
 * Register the Product Studio REST routes.
 *
 * @return void
 */
function openstation_my_wordpress_woo_product_studio_register_routes() {
	if ( ! openstation_my_wordpress_woo_active() ) {
		return;
	}

	register_rest_route(
		'desktop-mode/v1',
		'/woocommerce/product-studio',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'openstation_my_wordpress_woo_product_studio_bootstrap',
			'permission_callback' => 'openstation_my_wordpress_woo_product_studio_permission',
		)
	);

	register_rest_route(
		'desktop-mode/v1',
		'/woocommerce/products',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'openstation_my_wordpress_woo_product_studio_create',
			'permission_callback' => 'openstation_my_wordpress_woo_product_studio_permission',
			'args'                => array(
				'requestId'        => array(
					'description' => __( 'Unique identifier used to make retries safe.', 'desktop-mode' ),
					'type'        => 'string',
					'required'    => true,
					'pattern'     => '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-4[a-fA-F0-9]{3}-[89aAbB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$',
				),
				'name'             => array(
					'description' => __( 'Product name.', 'desktop-mode' ),
					'type'        => 'string',
					'required'    => true,
				),
				'shortDescription' => array(
					'description' => __( 'Short storefront description.', 'desktop-mode' ),
					'type'        => 'string',
				),
				'description'      => array(
					'description' => __( 'Full product description.', 'desktop-mode' ),
					'type'        => 'string',
				),
				'regularPrice'     => array(
					'description' => __( 'Regular product price.', 'desktop-mode' ),
					'type'        => 'string',
				),
				'salePrice'        => array(
					'description' => __( 'Optional sale price.', 'desktop-mode' ),
					'type'        => 'string',
				),
				'sku'              => array(
					'description' => __( 'Optional unique stock-keeping unit.', 'desktop-mode' ),
					'type'        => 'string',
				),
				'virtual'          => array(
					'description' => __( 'Whether the product needs no shipping.', 'desktop-mode' ),
					'type'        => 'string',
				),
				'manageStock'      => array(
					'description' => __( 'Whether WooCommerce tracks stock quantity.', 'desktop-mode' ),
					'type'        => 'string',
				),
				'stockQuantity'    => array(
					'description' => __( 'Whole-number stock quantity.', 'desktop-mode' ),
					'type'        => 'string',
				),
				'stockStatus'      => array(
					'description' => __( 'WooCommerce stock status.', 'desktop-mode' ),
					'type'        => 'string',
					'enum'        => array( 'instock', 'outofstock', 'onbackorder' ),
				),
				'categoryIds'      => array(
					'description' => __( 'JSON-encoded product category ids.', 'desktop-mode' ),
					'type'        => 'string',
				),
				'status'           => array(
					'description' => __( 'Requested product status.', 'desktop-mode' ),
					'type'        => 'string',
					'enum'        => array( 'draft', 'publish' ),
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'openstation_my_wordpress_woo_product_studio_register_routes' );

/**
 * Render the Product Studio mount point.
 *
 * @return void
 */
function openstation_my_wordpress_woo_product_studio_template() {
	ob_start();
	?>
	<div class="os-woo-product-studio" data-os-woo-product-studio-root>
		<div class="os-woo-product-studio__loading">
			<os-spinner></os-spinner>
		</div>
	</div>
	<?php
	$html = (string) ob_get_clean();

	/**
	 * Filter the Product Studio window's template HTML.
	 *
	 * Keep `data-os-woo-product-studio-root` intact so the bundle can
	 * mount the guided flow.
	 *
	 * **Status: Experimental**
	 *
	 * @param string $html Default template HTML.
	 */
	$filtered = (string) apply_filters( 'openstation_my_wordpress_woo_product_studio_template_html', $html );

	if ( function_exists( 'openstation_kses_native_window_template' ) ) {
		echo openstation_kses_native_window_template( $filtered ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- helper kses-escapes.
	} else {
		echo wp_kses( $filtered, wp_kses_allowed_html( 'post' ) );
	}
}

/**
 * Register the Product Studio native window and desktop shortcut.
 *
 * @return void
 */
function openstation_my_wordpress_woo_product_studio_register_window() {
	if ( ! openstation_my_wordpress_woo_active() || ! function_exists( 'openstation_register_window' ) ) {
		return;
	}
	if ( true !== openstation_my_wordpress_woo_product_studio_permission() ) {
		return;
	}

	$args = array(
		'title'      => __( 'Product Studio', 'desktop-mode' ),
		'icon'       => 'dashicons-products',
		'template'   => 'openstation_my_wordpress_woo_product_studio_template',
		'script'     => 'os-my-wordpress-woocommerce',
		'style'      => 'os-my-wordpress-woocommerce',
		'width'      => 1180,
		'height'     => 680,
		'min_width'  => 680,
		'min_height' => 520,
		'placement'  => 'none',
	);

	/**
	 * Filter the Product Studio window's registration args.
	 *
	 * **Status: Experimental**
	 *
	 * @param array $args `openstation_register_window()` args.
	 */
	$args = (array) apply_filters( 'openstation_my_wordpress_woo_product_studio_window_args', $args );

	$registered = openstation_register_window( 'desktop-mode-woo-product-studio', $args );
	if ( is_wp_error( $registered ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[openstation] Product Studio window registration failed: ' . $registered->get_error_message() );
		return;
	}

	if ( ! function_exists( 'openstation_register_icon' ) ) {
		return;
	}

	$icon_args = array(
		'title'    => __( 'Add New Product', 'desktop-mode' ),
		'icon'     => 'dashicons-plus-alt2',
		'window'   => 'desktop-mode-woo-product-studio',
		'position' => 20,
	);

	/**
	 * Filter the Product Studio desktop shortcut's registration args.
	 *
	 * **Status: Experimental**
	 *
	 * @param array $icon_args `openstation_register_icon()` args.
	 */
	$icon_args = (array) apply_filters( 'openstation_my_wordpress_woo_product_studio_icon_args', $icon_args );

	$icon_registered = openstation_register_icon( 'desktop-mode-woo-product-studio', $icon_args );
	if ( is_wp_error( $icon_registered ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[openstation] Product Studio icon registration failed: ' . $icon_registered->get_error_message() );
	}
}
add_action( 'init', 'openstation_my_wordpress_woo_product_studio_register_window', 26 );
