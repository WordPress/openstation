# Migration — workspaces are saved from the main desk, managed in an app, and templates are gone

The workspace wizard is gone. A workspace is now made by arranging the
**main desk** and saving it, and managed — renamed, shared, deleted, its
recipients released — in the **Workspaces app** (`apps/workspaces/`).
Workspaces can also be **shared with a link** that pins them as the
opener's only desk; see [workspaces.md](./workspaces.md#sharing-a-workspace).

## Removed

| What | Instead |
|---|---|
| The wizard bundle (`assets/js/workspace-wizard[.min].js`, `window.openStationWorkspaceWizard`, `openStationConfig.workspaceWizardBundleUrl`) | The Workspaces app, `wp.os.workspaces.manage()`. |
| The `os-workspaces` stylesheet handle (`assets/css/workspaces.css`, `.os-workspace-wizard`) | `apps/workspaces/workspaces.css`, loaded with the app window. |
| The `+` opening the wizard | The `+` makes a plain desk. The **Create a workspace** tile beside it in Overview (it opens the Workspaces app) (or the dock's Workspaces tile menu, or `/save-workspace`) makes a workspace. |
| The pencil under a tile opening the wizard | The pencil renames in place; **Manage** under a workspace opens the app. |
| `/workspace` rows *New: <template>*, *New workspace…*, *Edit this workspace…* | *Save this desk as a workspace*, *Manage workspaces…* — and `/save-workspace`. |
| Workspace templates — Commerce, Learning, Publishing — and their whole surface: `wp.os.workspaces.presets()` / `registerPreset()` / `unregisterPreset()`, `create( { preset } )`, the `os.workspaces.presets` and `os.workspaces.profile` JS filters, the `openstation_workspace_presets` PHP filter, `openStationConfig.workspacePresets` | Arrange the main desk and save it. Code that wants to hand someone a ready-made desk calls `wp.os.workspaces.create( { label, profile } )` with a profile of its own. |

## Changed

- **`wp.os.workspaces.edit( id )`** switched to the desk and opened the
  wizard; it now switches to the desk and keeps a **Save changes** toast
  up (the desk is the editor), then opens the Workspaces app.
- **`wp.os.workspaces.openCreator()`** made a blank desk and opened the
  wizard; it is now an alias of the new `saveAs()` — save the main desk
  as a new workspace.
- **`/keep-desk` on the main desk** saves it as a new workspace instead of
  turning the main desk itself into one.
- **`createWorkspacesApi( deps, ops )`** takes its shell-bound operations
  as one object (`manage`, `currentLook`, `saveAs`, `edit`, `saveDesk`)
  instead of positional arguments. Internal to the shell bundle.
- **`WorkspaceOverviewDeps`** carries `saveAsWorkspace` and `openManager`
  instead of `openCreator` and `openEditor`; `createWorkspaceFromOverview`
  and `editWorkspaceFromOverview` became `saveWorkspaceFromOverview` and
  `manageWorkspaceFromOverview`. Internal to the shell bundle.

## Unchanged

- Every existing workspace and its profile, including desks made from a template before. Nothing is migrated; their `preset` field is kept as inert provenance.
- Restore, `/keep-desk` on a workspace desk, `provision()`, `capture()`,
  `captureAppearance()`, `setProfile()` and the `os.workspaces.updated` / `os.workspaces.provisioned` hooks.

## Changed: a workspace carries every setting

A workspace's `appearance` patch used to take 16 appearance keys. It now
takes **every** OpenStation setting except `appliedThemeRecommendations`,
derived from the defaults on both sides, and the server sanitizes each
value with the settings' own sanitizer. `OPENSTATION_WORKSPACE_APPEARANCE_KEYS`
is gone (`openstation_workspace_setting_keys()`), and so is the separate
depth bound. For a user a shared workspace pins, cosmetic settings are
seeded and theirs to change; the rest are held
(`openstation_workspace_cosmetic_settings`).

## New

Building and editing workspaces by asking MIO, in the Workspaces window (window-scoped actions — not WordPress abilities). 
Every workspace carries ALL of the OS settings, and a change made in Preferences on a workspace's desk is saved into that workspace (`OsSettings.onWorkspaceEdit`, `userSettings()`); the main desk keeps the user's own. The `openstation_os_settings` and `openstation_os_settings_before_save` filters; `wp.os.workspaces.saveAs()`, `restoreMain()` (also `/restore-main-desk` and Restore under the main desk's tile), `manage()`, `rename()`, `remove()`,
`isPinned()`; the profile's optional `restricted` flag ("Hide
settings"); the profile's optional `notes` (read-only, dismissible
desk notes, regular or XL — the edit bar's **+ Note** / **+ XL note**
and MIO's Notes step) with the `workspace-notes/dismiss` REST route;
the shell config keys `workspacePin`, `workspaceArrival`,
`workspaceCanShare`, `workspaceRestricted`, `workspaceDismissedNotes`; and the PHP hooks listed in
[hooks-reference.md](./hooks-reference.md#shared-workspaces), including
the general `openstation_session` and `openstation_app_allows`.
