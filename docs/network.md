# OpenStation Network

*Experimental.* Separate WordPress installs, each with OpenStation,
that show one site switcher and move between each other as if they were
sites of one network. What a WordPress multisite gives sites of one
install, this gives installs anywhere.

## The idea

On a multisite, every site is its own OpenStation and the overview's
switcher lists them all, because they share one database (see
[multisite.md](./multisite.md#site-instances)). An install elsewhere
shares nothing: no tables, no users, no salts. So the network is made of
two things an install can do on its own, publish a key and verify a
signature, plus one place that keeps the list.

- The **hub** keeps the list. A multisite is always a hub, managed
  from its network admin's shell; a single site becomes one by admitting
  its first member.
- A **member** is an install that belongs to a hub. It fetches the
  hub's list and shows the same switcher the hub's own sites show.

Every install, hub or member, owns one Ed25519 keypair, generated on
first use (`openstation_network_keypair()`) and kept in an option, a
network option on a multisite. The public half is what
`GET /desktop-mode/v1/network/identity` publishes, with the install's
name, URL and shell screen. WordPress carries the crypto: native
libsodium where the host has it, its bundled polyfill where it does not.

## Pairing, one address on each side

On the hub, an administrator opens the **Network** app and adds the
member by its address. The hub fetches the member's identity over HTTPS
and **pins** its public key. On the member, an administrator opens the
same app and enters the hub's address; the member pins the hub's key
and asks for the list. The two steps can happen in either order: until
the hub has added the member, the hub refuses the list, and the member
shows that it is waiting.

Pinned means pinned. A key that later differs is flagged (`key-changed`
in the registry) and everything signed with the new key is refused,
until an administrator removes the member and adds it again. A changed
key is either a reinstall the admin should confirm or someone else
answering at that address, and neither should pass silently.

Plain HTTP is allowed only where `wp_get_environment_type()` is `local`
or `development`, which is what lets two wp-env instances pair.

## The list

`GET /desktop-mode/v1/network` on the hub answers with the network's
name, URL, shell screen and key; its Network Admin (URL, shell screen
and every row of the Network Admin tile, since a member cannot know a
user's network role and the hub gates them on arrival); and `sites`,
the switcher entries: the hub's local sites (`kind: local`; every site
by path on a multisite, capped like the super admin's row) followed by
its members (`kind: member`, each with its pinned public key).

A member asks with a **signed request**: three headers,
`X-OpenStation-Key`, `X-OpenStation-Timestamp` and
`X-OpenStation-Signature`, the last an Ed25519 signature over
`METHOD\nROUTE\nTIMESTAMP` (`openstation_network_signed_headers()`).
The hub answers a key it pinned and nothing else, within five minutes
of the timestamp; a logged-in administrator of the hub may read it too.
The route, not the URL, is signed, because the address an install is
reached by is not always the address it knows itself by.

The member caches the list on its hub entry and serves the shell from
the cache. When the cache is older than an hour a background refresh is
scheduled (`openstation_network_refresh_list` on cron); the request
that paints the shell never waits on another install. **Sync now** in
the app refreshes on the spot.

## What the switcher shows

Identical rows everywhere. On the hub, the members are appended after
the local sites (`openstation_multisite_sites()`, `member:<id>` ids).
On a member, `openstation_network_member_payload()` builds the same
multisite block the shell always boots with: the hub's sites and
members, this site current (the entry carrying its own key), and the
hub's Network Admin for the member's administrators. Picking any entry
is the ordinary instance hop, a navigation to that install's shell
screen with `openstation_overview=1`, landing in its overview.

## Login on arrival

The browser carries no login across origins, so the origin install
vouches for the user in the one channel the browser cannot block: the
URL. When the switcher picks a site on another origin it asks its own
shell for a **hop token** (`POST /desktop-mode/v1/network/hop`, a
logged-in user with OpenStation enabled, target restricted to the
switcher's own entries) and navigates to the URL the route answers:
the target's shell, in overview, token attached. The token is the
origin's Ed25519 signature over a small JSON payload: `iss` (the
issuer's identity URL), `aud` (the target's origin), `sub` (the user's
email), `name`, `dir` (the slide direction), `iat`, `exp` (60 seconds)
and a random `jti`.

The target spends it on `init`, before Core's `auth_redirect()` can
send an anonymous request to the login screen
(`openstation_network_redeem_hop()`): it looks up the key it pinned for
`iss` (its own, its hub's, or a member's from the list), verifies the
signature, checks `aud` against its own admin origin and `exp` against
its clock (a minute of skew), records `jti` in a transient so the
token is spent once, then finds the local user with that email and, if
nobody is logged in there, sets its own auth cookie. It redirects to
the same URL without the token and with `openstation_hop_from` carrying
the direction, so the desk slides in from the right side even though
the sessionStorage hint could not follow. A token that fails any check
is dropped the same way, silently: the user lands where they would
have without it, the login screen included.

What the token cannot do: create an account (an unknown email is a
plain login screen), replace a session (a browser already logged in as
someone else is left alone), travel over plain HTTP outside a local
environment, or be spent anywhere but the origin it names. What it
shares with every magic-login link: for sixty seconds the URL is a
credential, which HTTPS covers on the wire and the redirect covers in
history. Same origin never mints one; the hub's own subdirectory sites
switch as they always did.

## The Network app

`apps/network/network.os.php`, an App Framework window (see
[app-framework.md](./app-framework.md)). On a multisite it lives in
the **network admin's shell** and nowhere else, which is what
`App::admin( 'network' )` declares: a window says which admin offers it
(`site`, the default and the right one for every site-scoped window;
`network`; or `any`), and the native-window payload keeps the ones that
belong instead of leaving the network admin empty
(`openstation_native_window_offered_here()`). On a single site it lives
in the site's shell. The gate is `manage_network` on a multisite and
`manage_options` elsewhere.

Three faces: the **hub's** (every site with its status, Check sites,
Add site); a **member's** (the network it belongs to, the list as last
synced, Sync now, Leave); and a site in **neither role**, which is
offered both doors. Adding, removing, joining and leaving take effect in
the switcher on the next shell load.

## Developer surface

- `GET /desktop-mode/v1/network/identity`, public.
- `GET /desktop-mode/v1/network`, signed by a pinned member or read by
  an administrator.
- `POST /desktop-mode/v1/network/hop`, a logged-in user minting a hop
  token towards one of the switcher's entries; `openstation_hop` and
  `openstation_hop_from` are one-shot boot args of the shell screen.
- `openstation_network_request_url` (filter): the URL one install
  reaches another by, for proxies, internal hostnames and containers.
  See [hooks-reference.md](./hooks-reference.md#openstation_network_request_url--experimental).
- `openstation_multisite_sites` (filter) still shapes the row on the
  hub, members included.
- Options: `openstation_network_keypair`, `openstation_network_members`
  (hub), `openstation_network_hub` (member). Install-wide: network
  options on a multisite.
- The multisite block of the shell config (`wp.os.config.multisite`,
  `MultisiteConfig`) is the one contract the switcher reads, so a member
  needs no client change.

Pinned by `tests/phpunit/tests/openStationNetwork.php`.

## Trying it locally

Two wp-env instances pair on one machine. See
[DEVELOPMENT.md](./DEVELOPMENT.md#a-local-openstation-network-two-instances).
