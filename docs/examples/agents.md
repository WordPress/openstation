# Agents — read and write agents from a plugin

Desktop Mode agents are stored using the same `wp_guideline` CPT
conventions used by Dolly, Push MD, and Intelligence. Any plugin
that follows the conventions can read or write them — no Desktop
Mode dependency needed.

Status: **Experimental** (since 0.23.0).

## The storage contract, in one sentence

Each agent is one `wp_guideline` post tagged with the `skill` term,
authored by a synthetic `wp_users` row that carries the cross-link
in user meta.

| Where it lives          | Field                                       | Value                                              |
| ----------------------- | ------------------------------------------- | -------------------------------------------------- |
| `wp_users`              | `display_name`                              | Agent name                                         |
| `wp_users` meta         | `_desktop_mode_agent`                       | `'1'` (marker)                                     |
| `wp_users` meta         | `_desktop_mode_agent_guideline_id`          | Linked `wp_guideline.ID`                           |
| `wp_users` meta         | `_desktop_mode_agent_triggers`              | JSON-encoded trigger array (Layer 3)               |
| `wp_users` meta         | `_desktop_mode_agent_model`                 | Optional model override                            |
| `wp_users` meta         | `_desktop_mode_agent_rate_limit`            | Optional rate limit                                |
| `wp_guideline`          | `post_title`                                | Agent display name (wp-admin label only)           |
| `wp_guideline`          | `post_name`                                 | Stable slug — drives pushmd's `SKILL.md` path AND its YAML `name:` field |
| `wp_guideline`          | `post_excerpt`                              | "When to use this agent" — pushmd's `description:` |
| `wp_guideline`          | `post_content`                              | System prompt (raw markdown body)                  |
| `wp_guideline`          | `post_author`                               | Agent's `wp_users.ID`                              |
| `wp_guideline` taxonomy | `wp_guideline_type`                         | `skill`                                            |
| `wp_guideline` meta     | `guideline_source`                          | `desktop-mode/<slug>` (Push MD idempotency key)    |
| `wp_guideline` meta     | `_desktop_mode_skill_abilities`             | Allowed-ability slugs (provisional namespace)      |

## List every agent on a site

```php
function my_plugin_list_agents() {
    $users = get_users( array(
        'meta_key'   => '_desktop_mode_agent',
        'meta_value' => '1',
        'number'     => 200,
    ) );

    $out = array();
    foreach ( $users as $user ) {
        $guideline_id = (int) get_user_meta( $user->ID, '_desktop_mode_agent_guideline_id', true );
        $post         = $guideline_id ? get_post( $guideline_id ) : null;
        $out[] = array(
            'id'           => (int) $user->ID,
            'name'         => $user->display_name,
            'role'         => reset( $user->roles ),
            'instructions' => $post ? $post->post_content : '',
        );
    }
    return $out;
}
```

## Create an agent from PHP

```php
function my_plugin_install_agent() {
    if ( ! function_exists( 'desktop_mode_agent_create_user' ) ) {
        return; // Desktop Mode is not active
    }

    $user = desktop_mode_agent_create_user( array(
        'name' => 'My Auto-tagger',
        'role' => 'editor',
        'slug' => 'my-auto-tagger',
    ) );
    if ( is_wp_error( $user ) ) {
        return;
    }

    $installed = wp_install_skill(
        'desktop-mode/my-auto-tagger',
        'My Auto-tagger',
        'Tags new posts based on a topic taxonomy.',
        "You are a tagging assistant. For every saved post you propose three\n" .
        "tags from the existing taxonomy, ranked by topical confidence.",
        array( 'post_author' => (int) $user->ID )
    );

    if ( is_wp_error( $installed ) ) {
        return;
    }

    desktop_mode_agent_link_guideline( (int) $user->ID, (int) $installed['id'] );
    desktop_mode_agents_set_abilities( (int) $installed['id'], array(
        'wordpress/list-posts',
        'wordpress/update-post-meta',
    ) );
}
add_action( 'admin_init', 'my_plugin_install_agent' );
```

## Subscribe to lifecycle events

```php
add_action( 'desktop_mode_agent_created', function ( $user_id, $guideline_id, $args ) {
    error_log( sprintf(
        '[my-plugin] Agent #%d created: %s (guideline %d)',
        $user_id,
        $args['name'],
        $guideline_id
    ) );
}, 10, 3 );

add_action( 'desktop_mode_agent_deleted', function ( $user_id, $guideline_id ) {
    error_log( sprintf(
        '[my-plugin] Agent #%d removed (guideline %d)',
        $user_id,
        $guideline_id
    ) );
}, 10, 2 );
```

## Extend the abilities catalogue

```php
add_filter( 'desktop_mode_agent_abilities_catalogue', function ( $catalogue ) {
    $catalogue[] = array(
        'slug'        => 'my-plugin/process-image',
        'label'       => 'Process image',
        'description' => 'Apply my plugin\'s image pipeline to an attachment.',
    );
    return $catalogue;
} );
```

The new entry appears in the Tools section of every agent's detail
panel and can be toggled per agent. The slug round-trips through
`_desktop_mode_skill_abilities` post-meta on the guideline.

## Read agents from the REST API (JS)

```js
const response = await window.wp.desktop.fetch(
    '/wp-json/desktop-mode/v1/agents',
    { credentials: 'same-origin' },
    { source: 'my-plugin/agents' }
);
const agents = await response.json();
```

Or `import { listAgents } from '<…>/my-wordpress/agents-rest'` from
inside a Desktop Mode-bundled module.

## Ecosystem note — Dolly / Push MD / Claude Code

Because the underlying storage is `wp_guideline` with the `skill`
term and the standard `guideline_source` meta convention,
**agents you create through Desktop Mode appear automatically**:

- in Dolly's skill picker on this site,
- in `pushmd pull`'s `wp_guideline/skills/<slug>/SKILL.md` working
  tree,
- in Claude Code, Codex, and Cursor through the pushmd-aliased
  `AGENTS.md` / `.claude/skills/` symlinks.

Bindings (triggers, model override, rate limit) live as user meta
and are intentionally NOT in the portable layer — they are
site-specific invocation policy, not behaviour.
