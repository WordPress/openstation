# Migration: built-in activity channels move to the `os/` namespace

**Status:** shipped in 1.0.0. Affects plugins that subscribe to, or filter, one of the framework's own activity channels.

## What changed

The eleven channels the shell publishes on the activity bus were named `desktop-mode/<event>`. That prefix predates the OpenStation rebranding; the hook prefix (`os.activity.`), the broadcast topics (`os.data-changed`, `os.post.changed`, …) and the global (`wp.os`) had already moved. The channels now match:

| Before | After |
|---|---|
| `desktop-mode/toast-requested` | `os/toast-requested` |
| `desktop-mode/toast-shown` | `os/toast-shown` |
| `desktop-mode/notification-requested` | `os/notification-requested` |
| `desktop-mode/notification-shown` | `os/notification-shown` |
| `desktop-mode/window-attention-requested` | `os/window-attention-requested` |
| `desktop-mode/badge-changed` | `os/badge-changed` |
| `desktop-mode/open-requested` | `os/open-requested` |
| `desktop-mode/presence-changed` | `os/presence-changed` |
| `desktop-mode/presence-snapshot-applied` | `os/presence-snapshot-applied` |
| `desktop-mode/game-score-recorded` | `os/game-score-recorded` |
| `desktop-mode/upload-hud-complete` | `os/upload-hud-complete` |

**There is no alias.** The old names are not published and not filtered. A subscriber still registered against `desktop-mode/badge-changed` stops firing silently, because an activity subscription for a channel nobody publishes is not an error.

Payload shapes are unchanged. Only the channel slug moved.

Two adjacent renames ride along, both internal and neither part of the channel contract: the `createSharedStore` key backing the presence store (`desktop-mode/presence` → `os/presence`) and the five **planned**, not-yet-published folder-sharing channels in [`folder-sharing.md`](./folder-sharing.md).

## What to change

Rename the slug at every `subscribe` / `publish` / `filter` call site:

```diff
-wp.os.activity.subscribe( 'desktop-mode/badge-changed', repaint );
+wp.os.activity.subscribe( 'os/badge-changed', repaint );
```

If you register through raw `wp.hooks` instead of the activity API, the hook name changes with it — the channel's separator is a period on the hook bus, so the shell's own segment is now `os` rather than `desktop-mode`:

```diff
 wp.hooks.addFilter(
-    'os.activity.desktop-mode.notification-requested',
+    'os.activity.os.notification-requested',
     'my-plugin/dnd',
     ( intent ) => ( isDndActive() ? { ...intent, cancel: true } : intent ),
 );
```

**Search your whole project, not just the channels in the table above.** A plugin-owned channel of your own that happens to start with `desktop-mode/` is yours and must NOT be renamed; a blanket find-and-replace across a project will move it and break your own subscribers. Rename the eleven slugs by name.

### Typed payloads — the augmentation only works in module form

`ActivityChannelMap` is declared in `openstation/activity`. Augmenting it requires the `.d.ts` to be a **module**, which means at least one top-level `import` or `export`. Without one, TypeScript reads the block as an *ambient module declaration* — it invents a new, empty `openstation/activity` that shadows the real one, and you silently get no payload checking and no error saying so:

```diff
+import type {} from 'openstation/activity';
+
-declare module 'desktop-mode/activity' {
+declare module 'openstation/activity' {
     interface ActivityChannelMap {
         'my-plugin/something-happened': { id: number; reason: string };
     }
 }
```

The specifier moved with the package name (`openstation`), and `./activity` is now a declared `exports` subpath so it actually resolves. The bare `import type {}` line is load-bearing — with it, `publish( 'my-plugin/something-happened', { id: 'x' } )` is a compile error; without it, that call typechecks.

## What did NOT change

- **Your own channels.** The convention is still `<plugin>/<event>`; nothing about plugin-owned slugs moved. `os/` is now the shell's namespace — subscribe and filter freely, but publish under your own slug.
- **REST namespaces, options, tables, upload directories, cron hooks, post types, query vars and web-storage keys.** Everything reading `desktop-mode` / `desktop_mode_` there is frozen data that live installs already depend on, and it stays.
- **Broadcast topics.** `wp.os.broadcast()` topics were already `os.*`.
- **`wp.hooks` handler namespaces and `wp.os.fetch` `source:` tags.** Strings like `desktop-mode/commands-registry` (the second argument to `addAction`) and `source: 'desktop-mode/release-art'` still carry the old prefix. They are labels, not addresses — nothing subscribes by them — so they are a separate cosmetic pass rather than part of this contract change.

## Reference

- [The event-driven framework](./event-driven-framework.md#layer-3--activity-channels) — the full channel table.
- [JS reference — `activity`](./javascript-reference.md) — payload shapes and the hook-name mapping.
