# Inject data into `openStationConfig`

Add a feature flag + REST endpoint to the shell config so your TypeScript can read it without another `rest_url()` round-trip.

## Plugin file

```php
<?php
/**
 * Plugin Name: My Feature Flags
 */
defined( 'ABSPATH' ) || exit;

add_filter( 'open_station_shell_config', function ( $config ) {
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
document.addEventListener( 'os-init', () => {
    const cfg = window.openStationConfig;
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

- [Hooks Reference — `open_station_shell_config`](../hooks-reference.md#open_station_shell_config--stable)
- [JavaScript Reference — `os-init`](../javascript-reference.md#os-init--stable)
