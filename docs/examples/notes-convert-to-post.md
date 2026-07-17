# Customize note → post conversion

Pinned notes can be turned into draft posts — via the inline "Convert
to post" button on an owned note, or by dragging the note's pushpin
onto the **Posts** dock tile. Both go through
`POST /desktop-mode/v1/notes/:id/convert`, which:

1. spawns a **draft `post`** authored by the note owner, titled from
   the note's first line, with the body wrapped in `wp:paragraph`
   blocks (blank lines split paragraphs, single newlines become
   `<br>`);
2. **trashes the note** and links it to the draft, so the standard
   restore route (the Undo toast) reverses both sides — the note comes
   back and the draft is discarded;
3. auto-opens the draft in the block editor.

The affordances only appear for users who can author posts
(`current_user_can( 'edit_posts' )`, surfaced to the shell as
`desktopModeConfig.canCreatePosts`).

## Reshape the draft it creates

Use `desktop_mode_notes_convert_post_args` to change the post
type/status, assign a taxonomy, or rewrite the block markup. It filters
the array handed to `wp_insert_post()`.

```php
<?php
/**
 * Plugin Name: Notes → Posts policy
 */
defined( 'ABSPATH' ) || exit;

// File converted notes into the "Notes" category and hold them for
// review instead of saving a plain draft.
add_filter( 'desktop_mode_notes_convert_post_args', static function ( $args, $note ) {
    $args['post_status'] = 'pending';

    $term = get_term_by( 'slug', 'notes', 'category' );
    if ( $term ) {
        $args['post_category'] = array( $term->term_id );
    }

    return $args;
}, 10, 2 );
```

The convert route is owner-only and `edit_posts`-gated regardless of
what this filter returns — it shapes the draft, it doesn't widen who
may create one.

## React after a conversion

`desktop_mode_notes_converted` fires once the draft exists and the note
has been trashed — a good place to seed post meta, notify an editor, or
log the event.

```php
add_action( 'desktop_mode_notes_converted', static function ( $post_id, $note ) {
    update_post_meta( $post_id, '_from_pinned_note', (int) $note->ID );
}, 10, 2 );
```

## Related

- [Hooks Reference — `desktop_mode_notes_convert_post_args`](../hooks-reference.md#desktop_mode_notes_convert_post_args--experimental-filter-since-096)
- [Hooks Reference — `desktop_mode_notes_converted`](../hooks-reference.md#desktop_mode_notes_converted--experimental-action-since-096)
- [JavaScript Reference — Pinned-note drag payloads](../javascript-reference.md#pinned-note-drag-payloads--experimental-since-096)
