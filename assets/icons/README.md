# OpenStation icons

The eleven icons that are ours. Everything else the shell uses comes from
WordPress: Core owns the verbs (save, search, trash, settings), OpenStation
owns the nouns, the vocabulary that exists because this is a desktop and
wp-admin is not.

These are registered as the `openstation` collection in
[`includes/icons.php`](../../includes/icons.php) and can be rendered anywhere
with `wp_get_icon( 'openstation/window' )` on WordPress 7.1 or newer.

## Do not edit these by hand

They are generated. The drawings live in the brand repository as 1.5 monoline
strokes; these are the outlines of those strokes, expanded to filled paths.

That is not a style choice. WordPress sanitises registered icon markup through
`wp_kses` and keeps only `<svg>`, `<path>` and `<polygon>`, with no `stroke`
attribute on any of them, so a monoline icon registered as drawn loses its
stroke and renders as a solid blob. Expanding the stroke into a filled outline
is what survives, and it looks identical: SVG scales stroke geometry with the
shape either way.

Two consequences worth knowing before editing anything here:

- Every path carries `fill="currentColor"`. `wp_get_icon()` adds no fill, and a
  path without one paints black instead of following text color.
- There is no `<title>`. It would be stripped. The accessible name comes from
  the `label` passed to `wp_register_icon()`, or from the button around it.

## License

GPL-2.0-or-later, like the rest of the plugin.
