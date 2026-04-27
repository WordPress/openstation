# Inject data into `wpDesktopConfig`

Add a feature flag + REST endpoint to the shell config so your TypeScript can read it without another `rest_url()` round-trip.

## Plugin file

```php
<?php
/**
 * Plugin Name: My Feature Flags
 */
defined( 'ABSPATH' ) || exit;

add_filter( 'desktop_mode_shell_config', function ( $config ) {
    $config['myFeature'] = array(
        'enabled'  => (bool) get_option( 'my_ext_feature_enabled' ),
        'endpoint' => esc_url_raw( rest_url( 'my-ext/v1/stats' ) ),
        'role'     => wp_get_current_user()->roles[0] ?? 'subscriber',
    );
    return $config;
} );
```

## Reading from JS

```javascript
document.addEventListener( 'wp-desktop-init', () => {
    const cfg = window.wpDesktopConfig;
    if ( ! cfg.myFeature?.enabled ) {
        return;
    }
    fetch( cfg.myFeature.endpoint, {
        credentials: 'same-origin',
    } )
        .then( ( r ) => r.json() )
        .then( ( data ) => console.log( 'stats', data ) );
} );
```

## Guidelines

- **Namespace your keys.** Use `myFeature`, `myExtSomething` — avoid generic names like `flags` or `config` that could collide with another plugin.
- **Always JSON-safe.** The config is JSON-encoded into a `<script>` block. Don't put resources, closures, or unserializable objects in it.
- **Don't put secrets.** The config is readable by anyone with access to the page. Use nonces for REST calls rather than trying to embed API keys.
- **Keep it small.** Everything here ships on every shell page-load.

## Related

- [Hooks Reference — `desktop_mode_shell_config`](../hooks-reference.md#desktop_mode_shell_config--stable)
- [JavaScript Reference — `wp-desktop-init`](../javascript-reference.md#wp-desktop-init--stable)
