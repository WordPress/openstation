# Add an opt-in card to Station Home

Use a Station Home card for a small current-status summary that belongs on the user's launch surface. The user remains in control: `default_enabled` chooses the initial state, and the **Customize Station Home** picker lets each user opt in or out later.

```php
<?php
/**
 * Plugin Name: My Orders Station Card
 */

defined( 'ABSPATH' ) || exit;

add_action( 'init', function () {
    if ( ! function_exists( 'openstation_register_station_home_card' ) ) {
        return;
    }

    $result = openstation_register_station_home_card(
        'my-orders-awaiting-fulfilment',
        array(
            'label'           => __( 'Orders', 'my-orders' ),
            'description'     => __( 'Orders waiting to be fulfilled.', 'my-orders' ),
            'provider'        => __( 'My Orders', 'my-orders' ),
            'icon'            => 'dashicons-cart',
            'default_enabled' => false,
            'order'           => 20,
            'capabilities'    => array( 'manage_options' ),
            'callback'        => function ( $user_id ) {
                $count = my_orders_count_for_user( $user_id );

                return array(
                    'value'        => number_format_i18n( $count ),
                    'detail'       => _n(
                        'Order ready to fulfil',
                        'Orders ready to fulfil',
                        $count,
                        'my-orders'
                    ),
                    'url'          => admin_url( 'admin.php?page=my-orders' ),
                    'action_label' => __( 'Open orders', 'my-orders' ),
                    'tone'         => $count > 0 ? 'warning' : 'success',
                );
            },
        )
    );

    if ( is_wp_error( $result ) ) {
        error_log( '[my-orders] Station Home card failed: ' . $result->get_error_message() );
    }
} );
```

The callback runs only for users who have the card switched on. Keep it bounded: read cached or local data, avoid triggering remote refreshes, and return `WP_Error` when no trustworthy snapshot is available.

Supported callback keys:

| Key | Shape |
|---|---|
| `value` | Short plain-text instrument value, such as `4` or `12 min` |
| `detail` | One short explanatory sentence |
| `url` | Safe destination URL; omit for a read-only card |
| `action_label` | Link label; defaults to **Open** |
| `external` | `true` to open the URL in a new browser tab |
| `tone` | `neutral`, `info`, `success`, `warning`, or `danger` |

Cards never inject markup or scripts into Station Home. If your plugin needs a full interactive surface, register a [native window](./native-windows.md) and make the card link to it through an admin URL remap.
