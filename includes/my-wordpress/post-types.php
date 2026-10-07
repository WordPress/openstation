<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_MY_WORDPRESS_POST_TYPE_NAMESPACE = 'desktop-mode/v1';

function openstation_my_wordpress_eligible_post_types() {
	$types = array();

	foreach ( get_post_types( array(), 'objects' ) as $name => $post_type ) {
		if ( ! $post_type instanceof WP_Post_Type ) {
			continue;
		}

		if ( ! empty( $post_type->_builtin ) ) {
			continue;
		}
		if ( empty( $post_type->show_ui ) ) {
			continue;
		}
		if ( empty( $post_type->cap->edit_posts ) || ! current_user_can( $post_type->cap->edit_posts ) ) {
			continue;
		}

		if ( empty( $post_type->show_in_rest ) && ! openstation_my_wordpress_post_type_is_bridged( $name ) ) {
			continue;
		}
		$types[ $name ] = $post_type;
	}

	$slugs = apply_filters( 'openstation_my_wordpress_post_types', array_keys( $types ) );

	$out = array();
	foreach ( (array) $slugs as $slug ) {
		$slug = (string) $slug;
		if ( isset( $types[ $slug ] ) ) {
			$out[ $slug ] = $types[ $slug ];
			continue;
		}

		$object = get_post_type_object( $slug );
		if ( $object instanceof WP_Post_Type ) {
			$out[ $slug ] = $object;
		}
	}

	return $out;
}

function openstation_my_wordpress_post_type_is_bridged( $post_type ) {
	$object = get_post_type_object( (string) $post_type );
	if ( ! $object instanceof WP_Post_Type ) {
		return false;
	}
	if ( ! empty( $object->show_in_rest ) ) {
		return false;
	}

	$enabled = ! empty( $object->show_ui ) && empty( $object->_builtin );

	return (bool) apply_filters( 'openstation_my_wordpress_post_type_rest_enabled', $enabled, (string) $post_type );
}

function openstation_my_wordpress_post_type_rest_path( $post_type ) {
	if ( empty( $post_type->show_in_rest ) ) {
		return OPENSTATION_MY_WORDPRESS_POST_TYPE_NAMESPACE . '/post-type/' . $post_type->name;
	}
	$namespace = ! empty( $post_type->rest_namespace ) ? $post_type->rest_namespace : 'wp/v2';
	$base      = ! empty( $post_type->rest_base ) ? $post_type->rest_base : $post_type->name;
	return $namespace . '/' . $base;
}

function openstation_my_wordpress_post_type_icon( $post_type ) {
	$icon = isset( $post_type->menu_icon ) ? (string) $post_type->menu_icon : '';

	if ( '' === $icon || 'none' === $icon || 'div' === $icon ) {
		return 'dashicons-admin-post';
	}
	return $icon;
}

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

	return (array) apply_filters( 'openstation_my_wordpress_post_type_entity', $entity, $post_type );
}

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
