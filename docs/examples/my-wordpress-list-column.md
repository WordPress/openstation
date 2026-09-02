# WP Explorer — add a column to the list view

*Status: Experimental.*

WP Explorer's list view (the Icons / List control in a section's
search band) paints a sortable table: ID, title, slug, author, dates,
comment count and so on for posts, with their own sets for media and
users. Your plugin can put its own facts in a column — read straight
off the row, which carries the same REST-visible fields the tiles do.

## The recipe

Register the meta so it rides the row (`show_in_rest`), then add the
column through the `os.my-wordpress.list-columns` JS filter.

```php
// PHP — the fact has to reach the browser first.
add_action( 'init', static function () {
	register_post_meta( 'ticket', '_lane', array(
		'type'         => 'string',
		'single'       => true,
		'show_in_rest' => true,
	) );
} );

// Ship the script with the explorer window.
add_filter( 'openstation_app_window_args', static function ( array $args, string $app_id ) {
	if ( 'my-wordpress' === $app_id ) {
		$args['scripts'][] = 'my-plugin-explorer';
	}
	return $args;
}, 10, 2 );
```

```js
// my-plugin-explorer.js
wp.hooks.addFilter(
	'os.my-wordpress.list-columns',
	'my-plugin/lane',
	( columns, section ) => {
		if ( section.id !== 'cpt-ticket' ) {
			return columns;
		}
		const { html } = wp.os.apps;
		columns.splice( 2, 0, {
			id: 'lane',
			label: 'Lane',
			// Render a badge from the kit; a plain string works too.
			render: ( item ) => {
				const lane = String( item.meta?._lane ?? '' );
				return lane
					? html`<os-badge tone=${ lane === 'blocked' ? 'danger' : 'info' } no-dot>${ lane }</os-badge>`
					: '—';
			},
		} );
		return columns;
	},
);
```

The column appears after the title, is offered in the column chooser
(users can hide it, and their choice is remembered per section), and
its cells never break the table: a renderer that throws paints an
empty cell.

## Making it sortable

A column sorts when the section's server orders include both of its
keys. The built-in orders come from the app's `sort_options()`; a
plugin section (one you added through
`openstation_my_wordpress_app_sections`) can be given more through
that same filter — every entry is `key => [ label, orderby, order ]`,
and `orderby` is whatever `WP_Query` accepts, `meta_value` included:

```php
add_filter( 'openstation_my_wordpress_app_sections', static function ( array $sections ) {
	// …your section…
	return $sections;
} );
```

Then point the column at the two keys:

```js
sort: { asc: 'lane-asc', desc: 'lane-desc', first: 'asc' },
```

A header whose keys the section lacks renders as a plain heading —
nothing to undo when the order is not available.

## Where the rest is

- The filter contract, the row shape and every built-in column id:
  [`os.my-wordpress.list-columns`](../javascript-reference.md#filter--osmy-wordpresslist-columns).
- Decorating the *tile* view instead:
  [`os.my-wordpress.list-tile`](../javascript-reference.md#action--osmy-wordpresslist-tile).
- The app itself: [My WordPress](../hooks-reference.md#my-wordpress).
