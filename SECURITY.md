# Security policy

## Reporting a vulnerability

Please do not open a public issue or pull request for a security vulnerability.

Email **security@automattic.com** instead. Automattic's security team handles reports for OpenStation.
Include the plugin version, the steps to reproduce the issue, and what an attacker can do with it; the
user role needed to trigger it matters most, since OpenStation can be switched on by any logged-in
user. Encrypted reports are welcome if you prefer: ask for a key in your first message.

You will get an acknowledgement, and we will keep you informed while the issue is fixed. Please give
us a reasonable time to ship a fix before you disclose anything publicly.

## Supported versions

Only the latest release on [WordPress.org](https://wordpress.org/plugins/desktop-mode/) and the
`trunk` branch of this repository receive security fixes. Older releases are not patched; update to
the current version.

## What counts

OpenStation runs inside `wp-admin` with the privileges of the logged-in user. Anything that lets a
user do more than their WordPress role allows (read or change another user's data, reach a
capability they do not hold, run code, cross the boundary between sites of a multisite network or
between installs of an OpenStation network) is in scope, as is any way for an anonymous visitor to
reach the plugin's functionality. Anything an administrator can already do by design is not a
vulnerability.
