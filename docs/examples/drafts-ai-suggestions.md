# Retune the Drafts widget's AI writing assistant

**Experimental.**

The Drafts widget's 💡 button asks the model for title / excerpt / tag /
category suggestions plus a readiness check, then writes whichever the
user taps straight onto the draft. Everything the route decides is
filterable, so a plugin can bend the assistant to a site's house style
without forking `includes/widgets/widget-drafts.php`.

## House style in the system instruction

```php
<?php
/**
 * Plugin Name: House Style For Drafts
 */
defined( 'ABSPATH' ) || exit;

add_filter(
    'open_station_drafts_ai_instructions',
    function ( $instructions, $post ) {
        return $instructions . "\n\n" . implode(
            "\n",
            array(
                'House style: sentence case in titles, never Title Case.',
                'Never use an em dash in a title.',
                'Excerpts are one sentence, maximum 140 characters.',
            )
        );
    },
    10,
    2
);
```

## Send more (or less) of the draft to the model

The body is truncated to 4,000 characters by default — multibyte-safe, so
a long draft is never cut mid-character. Return `0` to send all of it.

```php
add_filter(
    'open_station_drafts_ai_content_limit',
    function ( $limit, $post ) {
        // Long-form review posts need the whole thing to be judged fairly.
        return has_category( 'reviews', $post ) ? 0 : $limit;
    },
    10,
    2
);
```

## Post-process the suggestions

`open_station_drafts_ai_suggestions` runs last, after tag-stripping and
truncation — drop, reorder or append entries without re-sanitizing.

```php
add_filter(
    'open_station_drafts_ai_suggestions',
    function ( $suggestions, $post ) {
        // Never offer a tag that isn't already on the site.
        $suggestions['tags'] = array_values(
            array_filter(
                $suggestions['tags'],
                function ( $tag ) {
                    return (bool) get_term_by( 'name', $tag, 'post_tag' );
                }
            )
        );
        return $suggestions;
    },
    10,
    2
);
```

## React to an accepted suggestion

`$applied` holds **only** what actually changed. An empty array means the
request was a no-op — for example an unknown category the user lacked
`manage_categories` to create.

```php
add_action(
    'open_station_drafts_suggestion_applied',
    function ( $post_id, $applied, $post ) {
        if ( empty( $applied ) ) {
            return;
        }
        my_log(
            sprintf(
                'AI suggestion applied to #%d: %s',
                $post_id,
                implode( ', ', array_keys( $applied ) )
            )
        );
    },
    10,
    3
);
```

## Adding a field to the response

Changing the schema changes the REST response shape too — the route only
normalizes the keys it knows about, and anything else passes through
untouched. The built-in widget UI ignores extra keys, so this is for
plugins that also consume `/desktop-mode/v1/draft-suggestions` directly.

```php
add_filter(
    'open_station_drafts_ai_schema',
    function ( $schema, $post ) {
        $schema['properties']['reading_time'] = array(
            'type'        => 'string',
            'description' => 'Estimated reading time, e.g. "4 min".',
        );
        $schema['required'][] = 'reading_time';
        return $schema;
    },
    10,
    2
);
```

## Gating

Nothing here bypasses the route's gates, and neither should your code:

- `/draft-suggestions` requires `edit_post` **first**, then a configured
  text-generation provider. An unauthorized caller always gets `403`, so
  the response can't be used to probe whether the site has AI set up.
- With no provider, an authorized caller gets `503
  open_station_ai_unavailable` and the 💡 button never renders —
  the widget degrades to exactly its pre-AI behavior.
- `/draft-apply` requires `edit_post` and nothing else; accepting a
  suggestion is a plain edit that keeps working if AI is switched off
  mid-session. Tags and categories are **appended**, never clobbered, and
  new categories are only created for users who can `manage_categories`
  (mirroring Core, where Authors may assign but not create).

See [Hooks Reference →
Drafts widget](../hooks-reference.md#drafts-widget--ai-writing-assistant-experimental).
