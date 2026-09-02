# Ship a workspace template

**Status: Stable**

A [workspace](../workspaces.md) is a desktop plus the answer to what it is for: which apps show on it, which windows it opens with, and how they are arranged. A **template** is how a plugin offers one — it appears as a card on the wizard's Start step, beside Blank desktop, and picking it mints a desk.

## From PHP alone — no JavaScript

The whole template can live in a filter. This one is a support desk: comments and users side by side, with the helpdesk plugin's own screen leading.

```php
add_filter(
    'openstation_workspace_presets',
    function ( $presets ) {
        $presets[] = array(
            'id'          => 'support',
            'label'       => __( 'Support', 'my-plugin' ),
            'description' => __( 'Tickets, comments and the people behind them.', 'my-plugin' ),
            'icon'        => 'dashicons-sos',
            'color'       => '#2271b1',
            'layout'      => 'columns',
            // Match TOKENS, not ids. Each is tested as a substring
            // against every navigable item's id, URL, window id and
            // title — so this finds the helpdesk menu whatever slug it
            // registered under.
            'apps'        => array( 'my-helpdesk', 'edit-comments.php', 'users.php' ),
            // Widget ids, not tokens — a widget id is a registry key,
            // so it is named exactly. One whose plugin is absent is
            // skipped at mount: a shorter column, not a broken desk.
            'widgets'     => array( 'clock', 'desktop-mode/recent-comments' ),
            // How the desk looks. A sparse patch over the user's own
            // settings, painted on entry and handed back on exit —
            // allowlisted keys only.
            'appearance'  => array(
                'wallpaper' => 'dark',
                'accent'    => 'wp-blue',
            ),
            // Windows the desk opens with. An entry whose `match` finds
            // nothing is skipped, so this template is safe to ship on a
            // site that has not activated the helpdesk yet.
            'windows'     => array(
                array( 'match' => 'my-helpdesk' ),
                array( 'match' => 'edit-comments.php' ),
                array( 'match' => 'users.php' ),
            ),
            // Ascending. The shipped desks claim 10 / 20 / 30, so this
            // lands after them; leave it out to lead the list.
            'order'       => 40,
        );
        return $presets;
    }
);
```

That is the whole integration. The client resolves the tokens against the live navigation the same way it resolves a built-in's.

**Every template keeps Dashboard, Media and Settings** on top of whatever it names — a desk with no way to reach them is a dead end.

## Drop a shipped template

The same filter removes one. A blog with no store has no reason to be offered a Commerce desk:

```php
add_filter(
    'openstation_workspace_presets',
    function ( $presets ) {
        return array_values(
            array_filter(
                $presets,
                fn( $preset ) => 'commerce' !== $preset['id']
            )
        );
    }
);
```

## From JavaScript

Same shape, registered on the client. Use this when the template depends on something only the browser knows:

```js
wp.os.workspaces.registerPreset( {
    id: 'support',
    label: 'Support',
    description: 'Tickets, comments and the people behind them.',
    icon: 'dashicons-sos',
    color: '#2271b1',
    layout: 'columns',
    apps: [ 'my-helpdesk', 'edit-comments.php', 'users.php' ],
    widgets: [ 'clock', 'desktop-mode/recent-comments' ],
    windows: [
        { match: 'my-helpdesk' },
        { match: 'edit-comments.php' },
    ],
} );
```

## Adjust a shipped template instead of replacing it

`os.workspaces.profile` fires the moment a profile is read off a template, before the desktop is created. This adds a plugin's own screen to the Commerce desk without redefining it:

```js
wp.hooks.addFilter(
    'os.workspaces.profile',
    'my-plugin/commerce-extras',
    ( profile, preset ) => {
        if ( 'commerce' !== preset.id || 'only' !== profile.apps.mode ) {
            return profile;
        }
        const shipping = wp.os
            .getNavItems()
            .find( ( item ) => item.id.includes( 'my-shipping' ) );
        if ( ! shipping ) {
            return profile;
        }
        return {
            ...profile,
            apps: {
                ...profile.apps,
                ids: [ ...profile.apps.ids, shipping.id ],
            },
        };
    }
);
```

## React to a desk being provisioned

`os.workspaces.provisioned` fires once per workspace, after its launch list has opened and its layout has been applied. `opened` is smaller than the list whenever an app it names is not installed:

```js
wp.hooks.addAction(
    'os.workspaces.provisioned',
    'my-plugin/welcome',
    ( { desktopId, opened, layout } ) => {
        const desk = wp.os.workspaces
            .list()
            .find( ( d ) => d.id === desktopId );
        if ( desk?.profile?.preset === 'support' && opened > 0 ) {
            wp.os.showToast( `Support desk ready — ${ opened } windows, ${ layout }.` );
        }
    }
);
```

## Build one on the fly

`create()` takes an explicit profile when a template is not the right shape — a desk minted for one customer, say:

```js
wp.os.workspaces.create( {
    label: `Order #${ orderId }`,
    profile: {
        preset: '',
        icon: 'dashicons-cart',
        color: '#7f54b3',
        apps: { mode: 'all', ids: [] },
        // Omit `widgets` (or use mode 'all') to leave the user's own
        // column alone; 'only' makes the column exactly these ids
        // while the desk is active, and restores theirs on the way out.
        widgets: { mode: 'only', ids: [ 'desktop-mode/recent-comments' ] },
        windows: [
            { match: 'wc-orders', url: `admin.php?page=wc-orders&id=${ orderId }` },
            { match: 'users.php', url: `user-edit.php?user_id=${ customerId }` },
        ],
        layout: 'columns',
        provisioned: false,
    },
} );
```

`provisioned: false` is what makes the launch list run when the desk is entered. Set it `true` and you get an arranged, empty desk.

## What a workspace may never do

Narrowing the rails is a **view**, not a settings edit: it computes the navigation with extra `'hidden'` placements and leaves the user's stored `navPlacement` untouched. And it can never hide OpenStation's own controls — Overview, System, Trash, Exit — or an open window's tile. See [Workspaces](../workspaces.md#narrowing-never-edits-your-settings).

The widget column follows the same "writes nothing" rule by a different route: `'only'` mounts exactly what it names, whether or not the user enabled those widgets globally, and hands their own column back the moment they leave. See [Widgets are a layout, not a filter](../workspaces.md#widgets-are-a-layout-not-a-filter).

So does the look. A workspace's `appearance` is a sparse patch over the user's settings, restored on exit — and saving Preferences while standing on an overridden desk still writes **their** values back for every key they did not touch. Only allowlisted keys are honoured, on both sides. See [Appearance is a view too](../workspaces.md#appearance-is-a-view-too).
