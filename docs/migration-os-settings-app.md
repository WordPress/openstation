# Migration — OpenStation Preferences becomes an App Framework app

The Preferences window (`desktop-mode-os-settings`) is an [App Framework](./app-framework.md) app now: `apps/os-settings/os-settings.os.php` declares the window, `os-settings.os.ts` paints every page as a client view, and the sheet rides the app as a first-open companion style. The window id, `wp.os.openOsSettings()`, `wp.os.registerSettingsTab()`, the settings REST route, the user meta key and every settings key are unchanged. Read this if you reached into the panel's bundle, its stylesheet handle, or its config key.

## What is gone

| Before | Now |
|---|---|
| The lazy `os-settings-panel[.min].js` bundle, `<script>`-injected on first open | The app's client view, `assets/js/apps/os-settings[.min].js`, loaded with the window like every other app |
| `openStationConfig.osSettingsPanelBundleUrl` | Removed. The window's script is a companion of its registration. |
| The `os-settings` stylesheet handle (`assets/css/os-settings.css`, deferred through `openstation_deferred_styles`) | `apps/os-settings/os-settings.css`, injected on the window's first open by the framework. A plugin that appended selectors after the `os-settings` handle should depend on the app's handle, `openstation-app-desktop-mode-os-settings`, or ship its own sheet. |
| `src/settings/panel.ts`, `src/settings/sections/*`, the section-builder `SettingsCtx` | Internal, and gone. Third-party code never had a supported import of them. |
| The desktop window opened from `desktop.ts` with an inline `render` callback | Registered by PHP; `wp.os.openOsSettings( { tabId } )` still opens or focuses it, passing the page as the open-time `tab` param and switching a live window through `wp.os.apps.local()`. |

## What changed in the public API

- **`wp.os.updateOsSettings( patch )` accepts every `OsSettingsState` key.** The write used to honour a hand-kept whitelist that left `customAccent`, `customGradient`, `customImage`, `wallpaperSettings`, `libraryHdOnly`, `heartbeatRate`, `showDesktopOnWallpaperClick`, `confirmCloseAllWindows`, `mioEnabled` and `mioStyle` reachable only from inside the panel. Every key now goes through the same sanitizer that reads user meta, with the current value as the fallback, so an invalid field is ignored rather than reset. The one exception stays: `appliedThemeRecommendations`, the seeded-theme ledger, is shell-owned and ignored.
- **Activating a theme through `updateOsSettings( { desktopTheme } )` seeds its recommended settings once**, the first time the user wears it — what the Themes tab always did, and what the documented recipe silently skipped. `wp.os.desktopThemes.applyRecommendedOsSettings()` remains the deliberate re-apply.
- **`wp.os.resetOsSettings()` is new** — the window's Reset button as an API call. The uploaded image survives.
- **`wp.os.getOsSettings()` returns the whole state.** `OsSettingsSnapshot` is now an alias of `OsSettingsState` (`src/settings/types.ts`); every key that was on the snapshot still is, with the ten above added.
- **A settings tab's `render( body, ctx )` runs once per registration**, not on every panel repaint: the host element survives the app's diffing renderer. A tab that re-registers itself (or is re-registered by a live plugin refresh) paints again. The `ctx` it receives is unchanged.

## What changed in the framework

- **`$os->refresh_menu()`** is a new effect: one menu-payload refresh after the response lands, for an action that changed what the server registers. The Extended Options action uses it, and it is the framework's form of the rule in AGENTS.md ("a setting that gates a server-side registration must spend a menu refresh when it saves").
- **`App::prefetch()`** computes `data()` once at registration and ships it with the window config, so a client view paints from the declared state the moment the window opens instead of behind a spinner for the length of the `mount` round trip — the beat in which the Preferences window's first click used to be lost. Opt-in; the app uses it because its `data()` is a handful of capability checks and options.
- **`focus` / `blur` lifecycle actions fire on transitions.** The shell reports a focus request on every pointerdown inside a window; the runtime now gates those, so a declared `focus` handler costs one round trip per return to the window rather than one per click.
- **The runtime asks the shell for an undefined `<os-*>` tag once per session**, not on every repaint (the Components tab's warner demo renders two such tags on purpose).
- **`wp.os.registerNamespace()` now reaches the live `wp.os` object.** It used to write onto the facade literal only, which is why `wp.os.apps` — the app runtime's own namespace — never existed on the page.
