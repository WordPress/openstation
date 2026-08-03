<?php
/**
 * OpenStation — My WordPress: custom post types as browsable folders.
 *
 * Every non-builtin post type the current user can edit becomes a
 * section in the site window, grouped into a folder named after the
 * plugin or theme that registered it (see `owner.php`). Types that
 * expose themselves over the REST API are read straight from
 * `wp/v2`; the rest go through the bridge controller in
 * `rest-post-type.php`.
 *
 * Core's builtin types are excluded — `post`, `page`, and `attachment`
 * are already root sections, and `wp_block` / `wp_template` /
 * `wp_navigation` and friends are editor infrastructure rather than
 * content someone browses. The `show_ui` requirement additionally
 * excludes internal bookkeeping types, including OpenStation's own
 * (`wpd_note`, agent conversations).
 *
 * Filterable surface:
 *
 *   - `openstation_my_wordpress_post_types`
 *   - `openstation_my_wordpress_post_type_entity`
 *   - `openstation_my_wordpress_post_type_rest_enabled`
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * REST namespace the bridge controller registers non-REST post types
 * under. Kept as a helper so the entity builder and the controller
 * cannot drift apart.
 */
const OPENSTATION_MY_WORDPRESS_POST_TYPE_NAMESPACE = 'desktop-mode/v1';

/**
 * Post types eligible to appear as sections in the site window.
 *
 * @return WP_Post_Type[] Keyed by post type name.
 */
function openstation_my_wordpress_eligible_post_types() {
	$types = array();

	foreach ( get_post_types( array(), 'objects' ) as $name => $post_type ) {
		if ( ! $post_type instanceof WP_Post_Type ) {
			continue;
		}
		// Builtins are either already root sections (post, page,
		// attachment) or editor infrastructure (wp_block, wp_template…).
		if ( ! empty( $post_type->_builtin ) ) {
			continue;
		}
		if ( empty( $post_type->show_ui ) ) {
			continue;
		}
		if ( empty( $post_type->cap->edit_posts ) || ! current_user_can( $post_type->cap->edit_posts ) ) {
			continue;
		}
		// A type that is neither REST-exposed nor bridgeable has no
		// endpoint to browse — don't render a folder that can't open.
		if ( empty( $post_type->show_in_rest ) && ! openstation_my_wordpress_post_type_is_bridged( $name ) ) {
			continue;
		}
		$types[ $name ] = $post_type;
	}

	/**
	 * Filter the post type slugs shown as sections in the site window.
	 *
	 * Runs after the capability check, so anything still present here
	 * is already editable by the current user. Adding a slug that is
	 * neither `show_in_rest` nor bridged will produce a folder with no
	 * working endpoint.
	 *
	 * **Status: Experimental** — the eligibility rules may tighten as
	 * more type shapes are encountered in the wild.
	 *
	 * @param string[] $slugs Eligible post type slugs.
	 */
	$slugs = apply_filters( 'openstation_my_wordpress_post_types', array_keys( $types ) );

	$out = array();
	foreach ( (array) $slugs as $slug ) {
		$slug = (string) $slug;
		if ( isset( $types[ $slug ] ) ) {
			$out[ $slug ] = $types[ $slug ];
			continue;
		}
		// Slug added by the filter — resolve it so callers always get
		// real objects back.
		$object = get_post_type_object( $slug );
		if ( $object instanceof WP_Post_Type ) {
			$out[ $slug ] = $object;
		}
	}

	return $out;
}

/**
 * Whether a post type should be served through the OpenStation bridge
 * controller rather than `wp/v2`.
 *
 * Only ever true for types that opted out of the REST API. Those types
 * are re-exposed under our own namespace behind a hard
 * edit-capability gate — see `rest-post-type.php` for the reasoning.
 *
 * @param string $post_type Post type slug.
 * @return bool
 */
function openstation_my_wordpress_post_type_is_bridged( $post_type ) {
	$object = get_post_type_object( (string) $post_type );
	if ( ! $object instanceof WP_Post_Type ) {
		return false;
	}
	if ( ! empty( $object->show_in_rest ) ) {
		return false;
	}

	$enabled = ! empty( $object->show_ui ) && empty( $object->_builtin );

	/**
	 * Filter whether a non-REST post type may be re-exposed through
	 * the OpenStation bridge route.
	 *
	 * The type's author set `show_in_rest => false`, so this is an
	 * opt-out worth honouring: return false to keep a type out of the
	 * site window entirely. The bridge is read-and-trash only and
	 * always requires the type's `edit_posts` capability, but a plugin
	 * that stores sensitive rows in a CPT may still prefer no endpoint
	 * at all.
	 *
	 * **Status: Experimental**
	 *
	 * @param bool   $enabled   Whether the bridge is allowed.
	 * @param string $post_type Post type slug.
	 */
	return (bool) apply_filters( 'openstation_my_wordpress_post_type_rest_enabled', $enabled, (string) $post_type );
}

/**
 * REST path a section should read from, relative to the REST root.
 *
 * @param WP_Post_Type $post_type Post type object.
 * @return string REST path (e.g. `wp/v2/product`).
 */
function openstation_my_wordpress_post_type_rest_path( $post_type ) {
	if ( empty( $post_type->show_in_rest ) ) {
		return OPENSTATION_MY_WORDPRESS_POST_TYPE_NAMESPACE . '/post-type/' . $post_type->name;
	}
	$namespace = ! empty( $post_type->rest_namespace ) ? $post_type->rest_namespace : 'wp/v2';
	$base      = ! empty( $post_type->rest_base ) ? $post_type->rest_base : $post_type->name;
	return $namespace . '/' . $base;
}

/**
 * Icon for a post type section. `menu_icon` may be a dashicon class, an
 * image URL, or a base64 data URI — the bundle's `renderIcon()` handles
 * all three, so it passes through untouched.
 *
 * @param WP_Post_Type $post_type Post type object.
 * @return string Icon reference.
 */
function openstation_my_wordpress_post_type_icon( $post_type ) {
	$icon = isset( $post_type->menu_icon ) ? (string) $post_type->menu_icon : '';
	// `'none'` is the documented way to opt out of a menu icon and
	// style it in CSS instead; treat it as absent.
	if ( '' === $icon || 'none' === $icon || 'div' === $icon ) {
		return 'dashicons-admin-post';
	}
	return $icon;
}

/**
 * Post types that should carry OpenStation's own REST fields
 * (`openstation_lock`, `openstation_contributors`,
 * `openstation_attached_media`).
 *
 * That is every public REST-exposed type — the historical set — plus
 * the types this module bridges, so a bridged section shows lock
 * badges and attached media exactly like a `wp/v2` one.
 *
 * Call on `rest_api_init` or later; post type discovery must be
 * complete.
 *
 * @return string[] Post type slugs.
 */
function openstation_my_wordpress_rest_field_post_types() {
	$types = get_post_types(
		array(
			'show_in_rest' => true,
			'public'       => true,
		),
		'names'
	);

	foreach ( openstation_my_wordpress_eligible_post_types() as $name => $post_type ) {
		if ( empty( $post_type->show_in_rest ) ) {
			$types[ $name ] = $name;
		}
	}

	return array_values( array_unique( $types ) );
}

/**
 * Build the entity descriptor for one post type.
 *
 * @param WP_Post_Type $post_type Post type object.
 * @return array Entity descriptor.
 */
function openstation_my_wordpress_post_type_entity( $post_type ) {
	$group = function_exists( 'openstation_my_wordpress_post_type_group' )
		? openstation_my_wordpress_post_type_group( $post_type->name )
		: null;

	$label = isset( $post_type->labels->name ) && '' !== $post_type->labels->name
		? (string) $post_type->labels->name
		: (string) $post_type->name;

	$entity = array(
		'id'         => 'cpt-' . $post_type->name,
		'label'      => $label,
		'icon'       => openstation_my_wordpress_post_type_icon( $post_type ),
		'restPath'   => openstation_my_wordpress_post_type_rest_path( $post_type ),
		'kind'       => 'post',
		'post_type'  => (string) $post_type->name,
		'thumbnails' => post_type_supports( $post_type->name, 'thumbnail' ),
		'group'      => $group ? (string) $group['id'] : null,
		'groupLabel' => $group ? (string) $group['label'] : null,
		'groupIcon'  => $group ? (string) $group['icon'] : null,
		'groupOrder' => $group ? (int) $group['order'] : null,
	);

	/**
	 * Filter the entity descriptor built for a single post type.
	 *
	 * Same contract as an entry in `openstation_my_wordpress_entities`
	 * — see that filter for the field list.
	 *
	 * **Status: Experimental**
	 *
	 * @param array        $entity    Entity descriptor.
	 * @param WP_Post_Type $post_type Post type object.
	 */
	return (array) apply_filters( 'openstation_my_wordpress_post_type_entity', $entity, $post_type );
}

/**
 * Append a section per eligible post type to the site window's entity
 * list.
 *
 * @param array[] $entities Existing entity descriptors.
 * @return array[] Entity descriptors with CPT sections appended.
 */
function openstation_my_wordpress_append_post_type_entities( $entities ) {
	if ( ! is_array( $entities ) ) {
		return $entities;
	}

	$existing = array();
	foreach ( $entities as $entity ) {
		if ( ! empty( $entity['post_type'] ) ) {
			$existing[ (string) $entity['post_type'] ] = true;
		}
	}

	foreach ( openstation_my_wordpress_eligible_post_types() as $name => $post_type ) {
		if ( isset( $existing[ $name ] ) ) {
			continue;
		}
		$entities[] = openstation_my_wordpress_post_type_entity( $post_type );
	}

	return $entities;
}
add_filter( 'openstation_my_wordpress_entities', 'openstation_my_wordpress_append_post_type_entities' );
