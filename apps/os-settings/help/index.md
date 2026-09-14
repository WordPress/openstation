# OpenStation Preferences help

Preferences changes the WordPress administration desktop for your account. It does not change the public website's WordPress theme, posts, pages or menus. Changes appear immediately, then save to your account. The browser keeps a local settings cache. MIO waits for the save confirmation before reporting success. If saving fails the existing Preferences store rolls back; MIO must report the failure.

## Find the right page

- [Appearance](appearance.md): wallpaper, accent colour, dock arrangement, size, placement, behaviour and WordPress admin bar.
- [Desktop themes](themes.md): choose a complete desktop appearance and apply its recommended layout.
- [Windows](windows.md): corners, unfocused effects, opening reveals, links, close-all confirmation.
- [Navigation and mobile](navigation.md): placement of individual launchers and the phone experience.
- [Features](features.md): optional tools, native apps, AI, developer mode and administrator-only site options.
- [Wallpaper images and configuration](wallpaper.md): gradients, existing media, uploads and Snow controls.
- [Components and About](reference.md): component examples, the journal and provider setup.
- [MIO actions and examples](actions.md): private action catalog, chained requests and intentional exclusions.

## Ask MIO

Use **Ask MIO** in the Preferences window. It appears only when MIO (the shared dock / Features → MIO API switch) and Features → AI assistant are enabled and WordPress has a compatible AI connector. Contextual tips and placement need the MIO API but do not need AI. Show MIO on wallpaper controls only the desktop mascot; turning it off keeps window chat and tips available. MIO belongs to this window while it is focused. A different window can claim MIO only by explicitly registering its own context. An ordinary window cannot take over its prompt or actions. Switching focus cancels unfinished work; already submitted changes may still finish. Closing Preferences discards its conversation. Closing just the chat keeps the in-memory conversation while that window remains open. Reloading discards it.

Your messages, relevant help excerpts and action results are sent to the AI provider configured in WordPress. OpenStation does not save MIO backscroll in WordPress, browser storage or an application log. Provider-side retention is governed by that provider. Do not paste credentials into the conversation.

## Multiple changes

“Please set rounded corners, unify the docks, and make them dynamic” is three actions: `set_window_radius` with `round`, `set_desktop_layout` with `unified`, then `set_dock_behavior` with `dynamic`. Each action validates its arguments and waits for its own save. A later failure does not undo earlier completed actions. MIO reports partial completion and stops instead of silently retrying writes.

“Make both docks dynamic” in Split mode means set both `dockBehavior` and `sideDockBehavior` to `dynamic`. In Unified there is only one rail and the sidebar setting has no visible effect. See [Appearance](appearance.md).

## Choosing accurately

Ask MIO to `list_options` before choosing a theme, wallpaper, accent or effect. These catalogs are live: plugins can register or remove choices. MIO must use returned ids, not invent them from labels. Theme selection can seed recommended settings once, so apply a theme before making explicit layout overrides in a chain. When a theme visually overrides a setting, explain that fact instead of repeatedly writing the same value.
