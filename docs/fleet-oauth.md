# Fleet OAuth

OpenStation can authorize a Fleet for OpenStation hub to use a managed site's WordPress REST API. The connection uses OAuth 2.0 Authorization Code with PKCE (S256); it does not require a client secret or a permanent WordPress Application Password.

This is an **Experimental** server surface. Fleet is a public client: its client id identifies one hub installation, but is not treated as a secret.

## What the permission means

The only scope is `site:manage`. It means “use the REST API as the WordPress user who approved this connection.”

The scope does not bypass WordPress permissions. After a bearer token is accepted, OpenStation establishes the approving user as the current user and then gets out of the way. Core and plugin REST endpoints still run their own `permission_callback`, `current_user_can()` checks, validation, and sanitization. An administrator therefore exposes the full API authority of an administrator; a lower-privileged approver would expose less.

Authorization is intentionally limited to users with `manage_options`, because Fleet is designed for whole-site administration and the consent describes that authority plainly.

## Discovery

Fleet starts with the managed site's REST root:

- the root index advertises `authentication.openstation-fleet-oauth` with the issuer, metadata URL, and scope;
- RFC 8414 metadata is available at `/.well-known/oauth-authorization-server` (including WordPress installations in a subdirectory);
- OAuth endpoints live under `/wp-json/openstation/v1/oauth/*`.

OAuth is advertised only when the site's public home URL uses HTTPS.

## Authorization flow

1. Fleet creates a random `state` value and a high-entropy PKCE verifier.
2. Fleet stores the verifier encrypted, sends only its S256 challenge, and opens the managed site's authorization endpoint.
3. WordPress requires an authenticated administrator and presents the exact hub host plus the `site:manage` permission.
4. Approval creates a single-use authorization code that expires after five minutes.
5. The managed site redirects to the exact HTTPS callback with `code`, `state`, and its `iss` value.
6. Fleet checks `state` and `iss`, then exchanges the code with the original verifier.

The first approval binds a client UUID to an exact callback URI. Later requests for that client must match it byte-for-byte. Authorization codes are also bound to the client, callback, and PKCE challenge.

## Tokens and storage

- Access tokens are opaque bearer tokens and expire after 15 minutes.
- Refresh tokens rotate on every use, expire after 30 days of inactivity, and have a 90-day absolute lifetime.
- Reusing an older refresh token revokes the complete token family.
- The managed site stores only SHA-256 token hashes, never bearer-token plaintext.
- Fleet encrypts its access and refresh tokens at rest with its existing per-site secretbox storage.
- Token and revocation responses send `Cache-Control: no-store`.

The server throttles the connection's “last used” write to once per five minutes so normal API use does not update an option on every request.

## Revocation

A connection can be revoked in either direction:

- Fleet revokes its refresh-token grant when the site is disconnected from the hub.
- The approving user, or an administrator allowed to edit that user, can revoke it under the standard WordPress user profile's **Fleet connections** section.
- Changing the approving user's password or deleting the user revokes all of that user's grants.
- Refresh-token replay revokes the affected grant automatically.

The revocation endpoint returns success for unknown tokens, so it cannot be used as a token-existence oracle.

## Endpoint map

| Endpoint | Method | Purpose |
|---|---|---|
| `/.well-known/oauth-authorization-server` | GET | Authorization-server metadata |
| `/wp-admin/admin.php?page=openstation-fleet-authorize` | GET | Administrator consent |
| `/wp-admin/admin-post.php?action=openstation_fleet_oauth_decide` | POST | Approve or deny the request |
| `/wp-json/openstation/v1/oauth/token` | POST | Exchange a code or rotate a refresh token |
| `/wp-json/openstation/v1/oauth/revoke` | POST | Revoke an access token or refresh-token grant |

## Standards profile

The implementation follows the published OAuth specifications used by the current OAuth security best practice: RFC 6749, RFC 6750, RFC 7009, RFC 7636, RFC 8414, RFC 9207, and RFC 9700. OAuth 2.1 is still an Internet-Draft, so OpenStation does not claim OAuth 2.1 conformance.

Implementation: `includes/fleet-oauth.php`. Tests: `tests/phpunit/tests/fleetOAuth.php`.
