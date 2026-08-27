# Revisions in their own window — extend or redirect "View revisions"

Core's revision browser is a whole admin screen, and the block editor can only reach it by navigating the editor away from itself. On a desktop it is simply another window.

Every post / page / CPT editor window — **Gutenberg and classic**, any post type that declares `revisions` support — carries a **"View revisions (N)"** row in its title-bar **⋯ menu**. Picking it opens `revision.php` as its own desktop window, placed beside the editor and **tied to it by a window link**: the two are one relation group, so the desktop draws a spline between them, and focusing either raises and highlights the other.

The row appears exactly where there is history to browse. A draft with no revisions has none; the block editor's save-watcher refetches the identity after every save, so the row shows up the moment the first revision exists — no reload. The count is re-read on every menu open, so it counts up while the window stays open.

Both ends are open: a **PHP filter** rewrites or suppresses the browser per post, and a **JS filter** reshapes the window before it opens.

## PHP — point a post type at your own history screen

```php
add_filter( 'openstation_window_revisions', function ( $revisions, $post ) {
	if ( 'acme_contract' !== $post->post_type ) {
		return $revisions;
	}

	// NOTE: the shell only accepts SAME-ORIGIN URLs — a cross-origin
	// rewrite hides the row entirely.
	return array(
		'url'   => admin_url( 'admin.php?page=acme-history&contract=' . $post->ID ),
		'count' => acme_contract_version_count( $post->ID ),
	);
}, 10, 2 );
```

The unfiltered `url` is `revision.php?revision={newest}`; `count` is the total `wp_get_post_revisions()` will list (autosaves included, matching Core's own revisions meta box and the block editor's revisions panel). Both are empty for attachments, post types without `revisions` support, posts with no revisions yet, and users lacking `edit_post`. A malformed return is sanitized back to `array( 'url' => '', 'count' => 0 )` — the identity is validated as a unit client-side, and one bad key would discard the whole thing.

To hide the row everywhere:

```php
add_filter( 'openstation_window_revisions', function () {
	return array( 'url' => '', 'count' => 0 );
} );
```

## PHP — give your own screen the same tie

The spline exists because the revision browser announces itself as a **child of the post** it belongs to. A custom history screen gets the same treatment by announcing the same shape:

```php
add_filter( 'openstation_window_content_identity', function ( $identity, $screen ) {
	if ( ! $screen || 'acme-history' !== ( $_GET['page'] ?? '' ) ) {
		return $identity;
	}
	$post_id = absint( $_GET['contract'] ?? 0 );
	if ( ! $post_id ) {
		return $identity;
	}
	return array(
		'type'  => 'acme/history',
		'id'    => $post_id,
		'label' => sprintf( 'History of %s', get_the_title( $post_id ) ),
		'root'  => array( 'type' => get_post_type( $post_id ), 'id' => $post_id ),
	);
}, 10, 2 );
```

A ref **with** `root` joins that root's group as a child — see [`window-links.md`](./window-links.md) for the full direction semantics.

## JS — reshape the window before it opens

```javascript
wp.hooks.addFilter(
	'os.revisions.window-config',
	'my-plugin/big-revisions',
	( config, { editorWindowId, content } ) => {
		console.log( 'opening revisions for', content.type, content.id );
		return { ...config, initialState: 'maximized' };
	},
);
```

The default config is `{ id: 'revisions-{type}-{id}', baseId: <same>, url, title, icon: 'dashicons-backup', content: { type: 'revisions', id, root: { type, id } }, …placement }`. An invalid return (missing `id` or `url`) is ignored with a console warning and the default opens.

**About the placement.** On a *first* open — nothing remembered for this window, a desktop-width viewport, a measurable editor — the shell computes geometry that leaves the editor visible: to its right if there is room, to its left if not, otherwise the corner diagonally opposite the editor's own. Once the user moves or resizes the window, the window manager's remembered geometry wins and the shell stops arranging. It is deliberately **not** a snap: snapped windows report no rect to the window-link frame, so the tidiest-looking arrangement is the one that would cost the spline. Override any of it by returning your own `x` / `y` / `width` / `height` from this filter.

## JS — react to it opening

```javascript
document.addEventListener( 'os-revisions-opened', ( e ) => {
	const { editorWindowId, revisionsWindowId, content } = e.detail;
	// e.g. park a note, start a timer, log the comparison
} );

// Same payload on the hook bus:
wp.hooks.addAction( 'os.revisions.opened', 'my-plugin/track', ( detail ) => {
	console.log( detail.revisionsWindowId );
} );
```

## Reading the current state

```javascript
const ref = wp.os.relations.get( windowId );
ref?.revisionsUrl;   // → string | undefined
ref?.revisionCount;  // → number | undefined
```

Reference: [hooks-reference](../hooks-reference.md#openstation_window_revisions--experimental) · [javascript-reference](../javascript-reference.md) · [window links](./window-links.md) · [window ⋯ menu rows](./window-action.md)
