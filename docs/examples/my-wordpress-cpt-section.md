# WP Explorer — custom post types and their folder

Every custom post type your plugin registers shows up in the site
window automatically, grouped into a folder named after your plugin.
This page covers what you get for free, and the three hooks for the
cases where the defaults are wrong.

```php
defined( 'ABSPATH' ) || exit;
```

## What you get without writing anything

Register a post type the normal way and it becomes a browsable section:

```php
add_action(
	'init',
	static function () {
		register_post_type(
			'acme_recipe',
			array(
				'labels'       => array( 'name' => __( 'Recipes', 'acme' ) ),
				'public'       => true,
				'show_ui'      => true,
				'show_in_rest' => true,
				'menu_icon'    => 'dashicons-food',
				'supports'     => array( 'title', 'editor', 'thumbnail' ),
			)
		);
	}
);
```

The section appears inside an **Acme** folder at the root of the site
window, labelled from your plugin's `Plugin Name` header. Its tiles
show each recipe's featured image, and drag-to-trash, the lock badge,
and the live item counter all work the way they do for Posts.

Three details are worth knowing:

- **`show_ui => true` is the gate.** A type registered with
  `show_ui => false` is treated as internal bookkeeping and never
  appears. This is how OpenStation keeps its own private types out.
- **The current user must hold the type's `edit_posts` capability.**
  Users who can't edit recipes never see the folder.
- **`menu_icon` is reused as the section icon** — a Dashicons class,
  an image URL, or a base64 data URI all work. Types without one fall
  back to `dashicons-admin-post`.

## Types that aren't on the REST API

A type registered with `show_in_rest => false` has no `wp/v2`
collection, so OpenStation serves it from
`desktop-mode/v1/post-type/<slug>` instead. That route is **read and
trash only** — no create, no update — and requires the type's
`edit_posts` capability in every context, so it is never publicly
readable.

If your type holds something that should have no REST endpoint at all,
opt out:

```php
add_filter(
	'openstation_my_wordpress_post_type_rest_enabled',
	static function ( $enabled, $post_type ) {
		return 'acme_licence_key' === $post_type ? false : $enabled;
	},
	10,
	2
);
```

The section then disappears from the window rather than rendering a
folder that can't open.

## Hiding a type from the window

```php
add_filter(
	'openstation_my_wordpress_post_types',
	static function ( $slugs ) {
		return array_values( array_diff( $slugs, array( 'acme_import_log' ) ) );
	}
);
```

The capability check has already run by the time this filter fires, so
everything still in the array is editable by the current user.

## Sharing one folder across a plugin suite

Attribution follows whichever file called `register_post_type()`, so a
suite split across several plugins lands in several folders. Point them
at one:

```php
add_filter(
	'openstation_my_wordpress_post_type_group',
	static function ( $group, $post_type ) {
		$ours = array( 'acme_recipe', 'acme_menu', 'acme_ingredient' );
		if ( ! in_array( $post_type, $ours, true ) ) {
			return $group;
		}
		return array(
			'id'    => 'plugin:acme-suite',
			'label' => __( 'Acme Suite', 'acme' ),
			'icon'  => 'dashicons-food',
			'order' => 15,
		);
	},
	10,
	2
);
```

Returning `null` instead pulls a type out of its folder entirely and
renders it loose at the root, next to Posts and Pages.

Lower `order` values sort first; the built-in resolver uses `20` for
plugins and `30` for themes, so `15` puts your folder ahead of both.

## Turning thumbnails off for one section

Featured images replace the section icon by default. For a type where
the featured image carries no meaning at a glance, keep the uniform
icon grid:

```php
add_filter(
	'openstation_my_wordpress_post_type_entity',
	static function ( $entity, $post_type ) {
		if ( 'acme_import_log' === $post_type->name ) {
			$entity['thumbnails'] = false;
		}
		return $entity;
	},
	10,
	2
);
```

## Registering a section by hand

If you'd rather define the section yourself — a custom label, a
different REST collection, your own render kind — add it through
`openstation_my_wordpress_entities` with a `post_type` that matches.
The automatic pass skips any type a section already covers, so there's
no duplicate folder:

```php
add_filter(
	'openstation_my_wordpress_entities',
	static function ( $entities ) {
		$entities[] = array(
			'id'         => 'acme-recipes',
			'label'      => __( 'Recipes', 'acme' ),
			'icon'       => 'dashicons-food',
			'restPath'   => 'acme/v1/recipes',
			'kind'       => 'post',
			'post_type'  => 'acme_recipe',
			'thumbnails' => true,
			'group'      => 'plugin:acme-suite',
			'groupLabel' => __( 'Acme Suite', 'acme' ),
			'groupIcon'  => 'dashicons-food',
			'groupOrder' => 15,
		);
		return $entities;
	}
);
```

## See also

- [Hooks reference — WP Explorer](../hooks-reference.md#openstation_my_wordpress_entities--experimental)
- [JavaScript reference — WP Explorer](../javascript-reference.md#wp-explorer--extensibility-surface-experimental)
- [WP Explorer — add a preview-pane action button](./my-wordpress-media-action.md)
