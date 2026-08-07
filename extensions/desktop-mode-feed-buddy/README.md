# OpenStation — SOL Inbound Monologue

**SOL Inbound Monologue** is a personal RSS/Atom reader for OpenStation.
“SOL” stands for **Syndicated Open Links**. It presents subscriptions as a
compact 1999–2001-inspired buddy list and opens articles in a native
conversation-style reader window. Feeds talk; you listen.

## What ships

- movable/resizable `feed-buddy/buddy-list` widget;
- taskbar/dock `feed-buddy-reader` native window;
- a `feed-buddy-reader` launcher icon, so the extension is listed in
  OS Settings → Apps & Icons and can be moved between the dock and the
  wallpaper (or hidden) like any other app;
- per-user subscriptions, groups, ordering, preferences, and unread state;
- safe server-side RSS/Atom fetching and homepage autodiscovery;
- normalized plain-text article excerpts with no remote images or feed HTML;
- optional original synthesized sign-on, sign-off, and new-post chimes,
  disabled by default;
- messenger-era away messages and status copy, plus a small keyboard easter
  egg: focus SOL Inbound Monologue and type `SOL`.
- unreachable feeds shown as offline, with an original synthesized sign-off
  cue when sound is enabled;
- a deliberately judgmental confirmation before adding feed buddy number 200.

The sound cues are generated at runtime with the Web Audio API. No AOL/AIM
audio, logos, icons, or other copied assets ship with the extension.

## Development

Install the repository dependencies from the OpenStation root with `npm ci`,
then run these commands from this extension directory:

```sh
npm run lint
npm run build
npm run typecheck
npm run test
```

From the OpenStation repository root, run the extension's WordPress integration
suite and coding standards inside `wp-env`:

```sh
npm run env:start:tests
npm run test:php:install

npx wp-env run --config=.wp-env.tests.json cli \
  --env-cwd=wp-content/plugins/desktop-mode \
  vendor/bin/phpunit --configuration tests/phpunit/phpunit.xml.dist \
  extensions/desktop-mode-feed-buddy/tests/phpunit

npx wp-env run --config=.wp-env.tests.json cli \
  --env-cwd=wp-content/plugins/desktop-mode \
  vendor/bin/phpcs \
  --standard=extensions/desktop-mode-feed-buddy/phpcs.xml.dist \
  extensions/desktop-mode-feed-buddy
```

The `feed-buddy-reader` window and the `feed-buddy/*` widget, shared-store, and
REST identifiers are the stable internal contract; SOL Inbound Monologue is
the user-facing product name.

The generated visual study under `design/` is reference evidence only. Runtime
UI is authored in TypeScript and CSS.
