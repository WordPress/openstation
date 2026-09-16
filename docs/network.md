# OpenStation Network

*Experimental.* Separate WordPress installs, each with OpenStation,
that show one site switcher and move between each other as if they were
sites of one network. What a WordPress multisite gives sites of one
install, this gives installs anywhere.

**Off by default.** An administrator turns it on in OpenStation
Preferences → Features → Extended options (the `network` extended
option; filter `openstation_network_enabled`, see
[hooks-reference.md](./hooks-reference.md#openstation_network_enabled--experimental)).
While it is off, `includes/network/bootstrap.php` loads none of the
module: no keypair is minted, no route registered, no Network window
offered, no token minted or spent, and a multisite keeps the switcher
it has on its own. Pairings already made are options that survive a
disable and are back when the option is on again. Each install of a
network turns it on for itself.

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
the hub has added the member, the hub refuses the list, the member
shows that it is waiting, and it asks again in the background every
five minutes when its shell is painted, so the switcher appears there
once the hub has added it, without anyone pressing Sync now.

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

The browser carries no login across installs, so the install the user
leaves vouches for them in the one channel the browser cannot block:
the URL. When the switcher picks an entry of **another install** it
asks its own shell for a **hop token** (`POST
/desktop-mode/v1/network/hop`, a logged-in user with OpenStation
enabled, target restricted to the switcher's foreign entries) and
navigates to the URL the route answers: the target's shell, in
overview, token attached. The token is the issuer's Ed25519 signature
over a small JSON payload: `v` (2), `iss` (the issuer's identity URL),
`aud` (the target install's identity URL), `sub` (the user's id on the
issuer, which they cannot edit), `email` and `name` (for display only),
`dir` (the slide direction), `iat`, `exp` (60 seconds) and a random
`jti`.

Another install, not another origin. Two installs at `example.test/a/`
and `example.test/b/` share a hostname and nothing else (their own
salts, cookie names and paths), so a switch between them needs the
token just the same, while a site of this very install never does. The
payload's `foreign` flag on each switcher entry is what says which is
which; `openstation_network_hop_targets()` is the server's list, keyed
by shell URL with each install's identity URL as the audience.

The target spends it on `init`, before Core's `auth_redirect()` can
send an anonymous request to the login screen
(`openstation_network_redeem_hop()`): it looks up the key it pinned for
`iss` (its own, its hub's, or a member's from the list), verifies the
signature, checks `aud` against its own identity and `exp` against
its clock (a minute of skew), claims `jti` with one `INSERT IGNORE`
into the main site's options table so the token is spent once, on any
site of the install and by only one of two racing requests, then finds
the local user who **linked** that source account and, if nobody is
logged in there, sets its own auth cookie. It redirects to the same
URL without the token and with `openstation_hop_from` carrying the
direction, so the desk slides in from the right side even though the
sessionStorage hint could not follow. A token that fails any check is
dropped the same way, silently: the user lands where they would have
without it, the login screen included.

**Linking is the whole point, and an email match is not it.** On the
issuing install a user can set their own email to anything, an
administrator's on the target included (Core's REST users endpoint
applies it without confirmation), so an email in a token proves nothing
about who holds an account on the target. A token can only ever name
a source account; a target account is claimed once, by the person who
holds it. The first time a switch arrives with a token while the user
is **logged in on the target**, the target keeps the offer for ten
minutes (`config.hopLinkOffer`, with who arrived and from where) and
the shell asks once: *link that account to yours, and a switch from
there logs you in as you?* The answer is a nonced request from that
logged-in session (`POST /desktop-mode/v1/network/link`, `accept`),
which is the proof: the token proved the source account, the session
proves the target one. A yes is a row of user meta,
`openstation_network_link` = `<issuer id>|<source user id>`; a no is
remembered so the same account is not offered again. From then on a
token from that source account logs that target account in when nobody
is logged in there. The Network window lists a user's linked accounts
under **Linked accounts**, each with Unlink.

What the token cannot do: create an account, log in an account nobody
linked to it (an unknown or unlinked source lands on the login screen),
replace a session (a browser already logged in as someone else is left
alone, and offered the link instead), travel over plain HTTP outside a
local environment, or be spent on any install but the one it names.
What it shares with every magic-login link: for sixty seconds the URL
is a credential, and a browser history or a proxy log that keeps it
keeps a spent one.

## The Network app

`apps/network/network.os.php`, an App Framework window (see
[app-framework.md](./app-framework.md)). It is offered on **every
shell** of the network, the network admin's and each site's, which is
what `App::admin( 'any' )` declares: a window says which admin offers
it (`site`, the default and the right one for every site-scoped window;
`network`; or `any`), and the native-window payload keeps the ones that
belong instead of leaving the network admin empty
(`openstation_native_window_offered_here()`). The gate is
`manage_network` on a multisite and `manage_options` elsewhere, so on a
multisite only a super admin sees it, wherever they stand. It opens from a
desktop icon, not a dock tile, so Preferences > Navigation lists it and
the user can move it to the dock or hide it.

Three faces: the **hub's** (every site with its status, Check sites,
Add external site); a **member's** (the network it belongs to, the list
as last synced, Sync now, Leave); and a site in **neither role**, which
is offered both doors. Adding, removing, joining, leaving and syncing take
effect in the switcher at once: the action spends `$os->refresh_menu()`,
the menu payload carries the multisite block (`multisite`, the same
block the shell boots with), and overview, when open, rebuilds the row
above its tiles on the spot. Every row but this shell's own
carries **Open**, which switches to that site exactly as a pick in the
switcher does, slide and login token included: the action queues a
`hop` effect naming the switcher entry (`$os->effects->add( 'hop',
array( 'site' => $id ) )`) and the shell runs `switchToSite()` for it,
ignoring any value the row does not offer.

## Developer surface

- `GET /desktop-mode/v1/network/identity`, public.
- `GET /desktop-mode/v1/network`, signed by a pinned member or read by
  an administrator.
- `POST /desktop-mode/v1/network/hop`, a logged-in user minting a hop
  token towards one of the switcher's foreign entries; `openstation_hop`
  and `openstation_hop_from` are one-shot boot args of the shell screen.
- `POST /desktop-mode/v1/network/link`, a logged-in user answering the
  offer to link a source account to theirs (`accept`); the links are
  user meta, `openstation_network_link`.
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
