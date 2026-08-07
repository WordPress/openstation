# OAuth relay — connect to an external service

Every plugin that integrates with an external service (Tumblr, Mastodon, Bluesky, Spotify, Discord, …) reaches for the same five-step OAuth dance: generate a `state` nonce, persist it in a transient, open a popup, listen for the callback's `postMessage`, exchange the auth code for tokens, hand them to the plugin to store. ~120 LOC of fiddly lifecycle plumbing per plugin.

The framework ships a relay that owns those five steps. Plugins declare only what's plugin-specific: the authorize / token URLs, the client credentials, and a token-storage callback.

*Stable.*

## Register the relay (PHP)

```php
add_action( 'init', function () {
    openstation_register_oauth_relay( 'tumblrlike', array(
        'authorize_url' => 'https://www.example.com/oauth2/authorize',
        'token_url'     => 'https://api.example.com/oauth2/token',
        'client_id'     => MYPLUGIN_CLIENT_ID,
        'client_secret' => MYPLUGIN_CLIENT_SECRET,
        'scope'         => 'basic write',
        'on_success'    => function ( $user_id, $tokens, $service ) {
            // Persist tokens however your plugin needs.
            update_user_meta( $user_id, 'myplugin_tokens', $tokens );
        },
    ) );
} );
```

Need to undo it? `openstation_unregister_oauth_relay( $service )` removes a previously registered relay — the mirror of `openstation_register_oauth_relay()`, handy for plugins that register conditionally and for PHPUnit teardowns.

## Start the flow (JavaScript)

```js
document.getElementById( 'connect-button' )
    .addEventListener( 'click', async () => {
        try {
            const result = await wp.os.startOAuth( 'tumblrlike' );
            // result === { ok: true, service: 'tumblrlike' }
            wp.os.showToast( { message: 'Connected!' } );
        } catch ( err ) {
            // err.cause carries the failure payload:
            //   { ok: false, reason: 'invalid_state' | 'authorize_denied' |
            //                       'token_exchange_failed' | … , message: '…' }
            wp.os.showToast( { message: err.message } );
        }
    } );
```

## What the framework does

1. **`POST /desktop-mode/v1/oauth/start`** — issues a 32-char `state` nonce, persists it in a 10-minute transient keyed by the state value (with the issuing `user_id` stored in the transient payload), returns the assembled authorize URL with the state appended.
2. **`window.open( authorize_url, … )`** — centred popup with sensible window features.
3. **`postMessage` listener** — origin-checked against `window.location.origin`, type-discriminated on `'os-oauth-callback'`. Cross-origin or wrong-type messages are ignored.
4. **`GET /desktop-mode/v1/oauth/callback?code=…&state=…`** — server validates and *consumes* the state (single-use), POSTs to `token_url` with `grant_type=authorization_code`, parses JSON, calls the plugin's `on_success`, then renders an HTML page that `postMessage`s the opener and closes itself.
5. **Promise resolves** with the success payload on the opener side; rejects with a tagged `Error` (with the failure payload as `cause`) on every error path.

## What you DON'T have to write

- The state nonce — server-issued, server-validated, single-use, transient-backed (no DB writes).
- The popup orchestration — windowing math, a per-service named window target, popup-blocked detection. The popup deliberately keeps its `window.opener` reference (no `noopener`) so the callback page can `postMessage` the result back.
- The opener's `postMessage` listener — origin check, type check, single-fire detachment.
- The callback page that `postMessage`s the opener and closes — framework renders it.
- The token-exchange POST — framework `wp_remote_post`s the `token_url` with the standard parameters and parses JSON.

## Hooks the relay fires

| Hook | Type | Payload | Use |
|---|---|---|---|
| `openstation_oauth_relay_registered` | action | `( string $service, array $entry )` *(secrets redacted)* | Observability — log every relay that gets wired up. |
| `openstation_oauth_relay_connected` | action | `( string $service, int $user_id )` | Refresh badges, surface a "connected" toast in sibling windows via the activity bus. |
| `openstation_oauth_authorize_query` | filter | `( array $query, string $service, array $entry )` | Inject service-specific extras like `access_type=offline`, `prompt=consent`, etc. |

## Failure paths and `reason` codes

The `payload.reason` discriminator lets your client-side code branch on what went wrong:

| Reason | When |
|---|---|
| `invalid_state` | State nonce missing, expired, or already consumed (replay attempt). |
| `authorize_denied` | Provider returned `?error=…` — user clicked "deny" on the authorize page. |
| `unknown_service` | Relay was unregistered between the start and the callback. |
| `missing_code` | Provider returned a successful redirect without an authorization code (broken provider). |
| `token_request_failed` | `wp_remote_post` to the `token_url` errored at the transport layer (network, DNS, TLS). |
| `token_exchange_failed` | Token endpoint returned a non-2xx status or non-JSON body. |
| `on_success_threw` | The plugin's `on_success` callback threw — tokens may have been received but not persisted. |

## Capability gating

Default: any logged-in user can start a relay. Pass `capabilities` to require specific caps:

```php
openstation_register_oauth_relay( 'admin-only-service', array(
    /* … URLs and creds … */
    'capabilities' => array( 'manage_options' ),
) );
```

A user without the cap who tries to start the flow gets a `openstation_oauth_capability_denied` REST error and the popup never opens.

## Security notes

- **State nonces are single-use.** The first successful `consume_state` deletes the transient — a replay with the same state fails.
- **Origin check on the listener.** The opener-side listener only honours `postMessage` events whose `origin === window.location.origin`. A malicious cross-origin tab that knows the user's state can't impersonate the callback page.
- **Secrets stay server-side.** `client_secret` is never passed to the client — the token exchange runs entirely in the REST callback. The redaction also applies to the `openstation_oauth_relay_registered` action payload so observability logs don't leak credentials.
- **Capabilities are checked on the start endpoint**, NOT on the callback. The callback's gate is the state nonce — which only the user who started the flow has.

## See also

- [`docs/hooks-reference.md#oauth`](../hooks-reference.md) — the public PHP hooks above.
- [`api-index.md`](../api-index.md) — `wp.os.startOAuth` in the JS API table.
