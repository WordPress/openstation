# Workspaces

**Status: Stable**

A virtual desktop — a "Space" — is a container for windows and nothing else: it has an id and a name. A **workspace** is that container plus the answer to one more question: *what is this desk for?*

That answer is four things, and they travel with the desktop:

| | |
|---|---|
| **Which apps show** | The rails can be narrowed to the apps this desk is about. A shop desk shows the store; a writing desk shows Posts and Media and nothing else. |
| **Which widgets are on it** | The desk can carry its own widget column — drafts and a timer on a writing desk, traffic on a shop floor. |
| **What it looks like** | Wallpaper, accent, desktop theme, dock — the desk's whole appearance, painted on entry and handed back on exit. |
| **What it opens with** | A launch list. Entering the workspace for the first time opens it. |
| **How they are arranged** | `free`, `cascade`, `tile`, `columns` or `focus`. Applied once the launch list has opened. |
| **How it is labelled** | An icon and a colour, worn by its tile in Workspaces. |

There are no templates. **A workspace is made by saving the main desk** — see [Using them](#using-them).

---

## Using them

**A workspace is made on the desk, never in a form.** Set the **main desk** — the first one — up the way the job needs it: the windows you want open and where, the widgets, the apps on the rails (hide the rest from the rails' right-click menu), the wallpaper and accent. Then save it. That arrangement becomes a **new desk** carrying it as its workspace; the main desk stays exactly as it was, the workbench the next one is built on.

Three doors, one act:

- **Create a workspace** — the accent tile right after the `+` in Overview. It saves the main desk as a new workspace — its windows, widgets, apps and look — leaves Overview, and opens the Workspaces app on the new workspace's card, ready to name and share. (**✦ Build with MIO** in the app builds one by asking instead.)
- **Save main desk as new workspace** — hover the Workspaces tile in the dock; its menu also has *Manage workspaces…*. The same row is on the main desk's wallpaper right-click menu.
- **`/save-workspace`** in the command palette (⌘K).

The new desk is not switched to — you are still working on the one you saved — and it is not provisioned: its windows open, where they were, the first time you enter it. A toast names it and offers **Manage**.

The `+` in Workspaces makes a plain desk and nothing else. It used to open a wizard that built a workspace from a form; that wizard is gone (see [`migration-workspaces-app.md`](migration-workspaces-app.md)).

### Building one with MIO

With MIO and the AI assistant on (Preferences → Features) and a provider configured, a workspace can be described instead of arranged: *"A workspace for my users with the posts list on the left half, Add New Post in the top right and Orders in the bottom right."*

- **✦ Build with MIO** in the Workspaces app's header opens MIO's chat about a new workspace; **✦ Edit with MIO** on a card opens it about that one. The dock's Workspaces menu has *Build a workspace with MIO…*, which opens the app with the chat up (`wp.os.workspaces.manage()` with the `mio` param).
**MIO builds it WITH the user, one accepted step at a time**, in a chat docked beside the list (MIO's `chatLayout: 'side'`), and a live preview in the Workspaces window shows every proposal — a miniature desk: the 6 × 6 grid, each window a skeleton on its cells with its app's icon and title, the dock along the bottom with the proposed apps' real icons, the widget column down the right.

1. **Layout** — MIO proposes the windows and where they sit. The user accepts (**Accept layout** in the preview, or "yes" in the chat) or asks for a change, and MIO proposes again.
2. **Dock apps** — MIO proposes the icons; the preview lists every app on the site as a toggle button, so the user can add or take one out before accepting. The apps the windows open are always kept.
3. **Widgets** — the same, for the widget column.
4. **Notes** — MIO proposes the read-only notes the desk carries for the people using it (see [Workspace notes](#workspace-notes)) — a regular note or an **XL note**, each with a colour and a spot (`top-left`, `center`, `bottom-right`…). The preview shows them on the desk; take one out with its ×, or accept. "No notes" is a fine answer.
5. **Create** — only once all four are accepted: **Create workspace** in the preview, or telling MIO. **Discard** throws the draft away; a done step can be reopened from its pill.

The steps are enforced by the actions, not by the prompt: a proposal or a create out of order is refused with the step that is waiting. Nothing touches a desk until the create — a draft is memory. MIO reads the draft at the start of every reply, so an accept pressed in the preview, or an app unticked there, is what it works from. An Accept pressed in the preview also **tells MIO** (`lease.send()` — "I accepted the layout."), so it goes straight on to the next step. A step once accepted stays accepted: MIO repeating the same layout, or accepting a step already accepted, changes nothing — only a layout that actually changed sends the draft back to step 1.

- MIO reads the site first (`list_apps`, `list_widgets`), so it only ever uses screens and widgets that exist here — and every argument is checked against that scan again before it runs.
- `list_apps` is **every app on the site, native or not** — `wp.os.workspaces.apps()`: admin menus with their tabs, plugin apps, desktop icons, Trash, and OpenStation's native apps that have no menu of their own (Preferences…). A native app that only stands in for an admin screen (the native Posts app for `edit.php`) is not listed twice: the menu opens it. Any app can be a window; only apps with a dock icon can be kept on the dock.
- **An app is what its dock icon opens.** "The Posts app on the left" is the Posts window itself, with All Posts, Add Post, Categories and Tags as its tabs — stored as the app alone (no `url`), and opened through the app's own URL and the same native remap a dock click takes. A specific screen (`post-new.php`) is stored only when one is named.
- Windows go on the **6 × 6 grid**, by a named position (`left-half`, `top-right`, `bottom-right`, thirds, two-thirds…) or exact cells, and are stored as cells, so the desk keeps its shape on any screen.
- **Edit with MIO** on a card reworks that workspace through the same steps; small changes that need no preview (name, glyph, colour, "Hide settings", adding or removing a dock app) are one action.

These are **window-scoped MIO actions** (`list_apps`, `list_widgets`, `list_workspaces`, `get_draft`, `propose_layout`, `propose_apps`, `propose_widgets`, `propose_notes`, `accept_step`, `create_workspace`, `update_workspace`, `open_workspace`), registered on the Workspaces window's MIO lease — the same mechanism Preferences uses ([`mio-window-assistant.md`](mio-window-assistant.md)). They are **not WordPress abilities**: nothing reaches the Abilities API, the AI search tools or any other window. Nothing destructive is offered — MIO cannot delete a workspace, touch a share link or release anyone. A reply after a write offers **Go to workspace**, built from the write's confirmed receipt, never from the reply's text.

A window the desk places always opens floating on its cells, whatever size it was last remembered at.

### Restore main desk

The main desk can be put back the way a fresh install starts it: **Restore** under its tile in Workspaces, **Restore main desk** on its card in the Workspaces app, `/restore-main-desk`, or `wp.os.workspaces.restoreMain()`. It asks first, then closes the main desk's windows, resets the settings and the widget column to their defaults, and reopens the Dashboard.

Only the main desk. It has no workspace of its own — its look IS the user's settings — and every workspace carries all of its own settings, so the other desks are untouched, and so are shared links and the files on the desktop. An uploaded wallpaper image survives in the picker: it is something the user made, not a preference.

### The Workspaces app

Everything after saving happens in **Workspaces** — an app (`apps/workspaces/`), opened from **Manage** under a workspace's tile, the Save toast, `/workspace` → *Manage workspaces…*, or `wp.os.workspaces.manage()`. One card per workspace:

- **Workspace name**, edited in place with Enter or when leaving the field. A blank name keeps the previous name and explains why. Saving a new workspace from this window selects its name so it can be renamed immediately.
- **Saved windows**, with their titles, so the cards can be scanned by the work they contain. **Current desk** identifies the active workspace; its **Go to desk** button becomes **On this desk**.
- **Customize** folds away the icon, colour, **Hide settings** and deletion controls — see [Hide settings](#hide-settings). Open sections stay open through updates.
- **Edit on its desk** — switches to the workspace's desk, moves the Workspaces window out of the way (minimized), and puts a full-width bar across the top of the shell — *Editing workspace "…"* with **+ Note**, **+ XL note**, **Exit editing** and **Save changes** — that pushes the desk down rather than covering it. Arrange the desk and save, and the workspace opens that way from then on (the same capture `/keep-desk` makes: every window, where it is — two windows of one app are two windows). Either button ends the edit and brings the same Workspaces window back onto the desk you are on. The desk is the editor. **Exit editing** leaves the saved launch layout unchanged and discards note edits; it does not undo live window movements or Preferences edits, which are saved immediately.
- **Go to desk** is the primary action. **Delete workspace** is inside **Customize** and asks first.
- For someone who may share: **Sharing** folds away the link and recipients, with link status and the number using it visible on the summary. **Unpublished changes** and **Publish changes** remain visible even when Sharing is closed. Creating or publishing a link shows progress and prevents duplicate submissions — see [Sharing a workspace](#sharing-a-workspace).

The desks are the shell's, so the app reads and writes them through `wp.os.workspaces` and repaints whenever a desk changes, whoever changed it. Links and recipients are server truth, so they are the app's `data()` and actions.

### Workspace notes

A workspace can carry **notes** from whoever set it up — *"Orders live bottom right. Ask us before touching Plugins."* They hang on the desk's wallpaper in the sticky-note look, and for the people using the desk they are **read-only**: they can read one and **dismiss** it (the × on its corner), and nothing else. A dismissal is per person and survives reloads; it never touches the workspace, so the note stays for everyone else.

The author writes them two ways:

- **Edit on its desk** — the edit bar's **+ Note** and **+ XL note** add one in the middle of the desk, ready to type into. While editing, a note is editable, moves by dragging its pin, and its × deletes it. **Save changes** keeps them with the desk; **Exit editing** discards note edits.
- **MIO** — the Notes step when building or reworking a workspace.

An **XL note** is twice the size of a regular one, with larger type — for a proper welcome or a short how-to. A workspace holds up to 8 notes; a regular note holds 1,000 characters, an XL note 2,000. Notes are plain text. Sharing carries them to every recipient, and republishing updates them.

### On each tile

- **Rename** — double-click the desk's name, or its pencil. Not the **Main desk**: the first desk is the workbench every workspace is saved from, so its name is fixed ("Main desk", translated) and it can be neither renamed nor closed — `renameDesktop()` and `closeDesktop()` refuse it. For someone a shared workspace pins, their one desk carries the workspace's name instead. It becomes editable where it stands: Enter commits, Escape reverts, blur commits.
- **Manage** — under a workspace: the Workspaces app, on it.
- **Restore** — under a workspace with something to restore: put it back the way its workspace defines it — reopen the windows it names, remount its column, repaint its look, re-run its arrangement. It force-provisions (the once-per-workspace guard exists to stop the *shell* reopening windows on its own, not to stop the user asking), and it only appears where it has work to do. `wp.os.workspaces.provision( id, { force: true } )` is the programmatic equivalent for the windows half.

`/workspace` in the command palette is the keyboard route: it lists the desks that exist, then *Save desk as new workspace*, *Manage workspaces…* and *Keep this desk*. `/save-workspace` and `/restore-main-desk` are the two acts as commands of their own.

---

## Sharing a workspace

**For agencies handing a client a desk with fences on it.** Anyone who may share (the `manage_options` capability by default, `openstation_workspace_share_capability` to change it) gets **Create link** on each workspace in the Workspaces app. The link is `wp-admin/?os_workspace=<token>`, and it is copied as it is made.

**Opening the link duplicates the workspace into the opener's account — no dialog, no accept.** What happens depends on who opens it:

| Who | What the link does |
|---|---|
| Someone who cannot write content (a Subscriber, a store Customer — anyone without `edit_posts`, `openstation_workspace_claim_capability` to change it) | **Nothing.** They are told the link is not for their account; no pin, OpenStation is not switched on. |
| Someone who can write but cannot share (a client's editor, author, contributor, shop manager) | **Pins** it: their own desks are stashed, the workspace becomes their **main and only desk**, and OpenStation is switched on for them. |
| Someone who can share (an admin checking the link) | **Adds** it as an ordinary desk. An admin is never pinned — they must not be able to lock themselves out of their admin. |
| Anyone who already opened it | **Lands** them on their copy. A link duplicates once per user, ever; it stays useful as the way back. |
| Someone already pinned by another link | Nothing changes; they are told their desk is managed. |
| Anyone, once the link is turned off | Nothing changes. |

The shell says which with one toast, and takes the status off the address bar.

Share-token lookup and share listing honor WordPress query filters, so plugins can constrain which published shares those queries return.

### Pinned

A pinned user cannot delete, rename, re-arrange or leave the workspace, and cannot switch OpenStation off. That is enforced on the server, not by hiding buttons:

- **The session.** Every read and every save of a pinned user's session (the `openstation_session` filter) is reshaped to one desk — the workspace, as the share defines it *now* — with every window on it. A client that sends a second desk or an edited profile simply does not get it.
- **OpenStation stays on.** Writes that switch `desktop_mode_mode` off are refused, the admin-bar AJAX endpoint answers `openstation_workspace_pinned`, and `openstation_mode_enabled` cannot switch it off.
- **No classic admin.** `?desktop_mode_classic=1` is ignored for them, and the portal redirect cannot be opted out of.
- **The fence.** Admin screens the workspace does not include are refused with a 403, inside a window and out — see below.

The shell stops offering what would do nothing: no Overview, no Workspaces or Exit tiles, no `+`, no *Open in classic wp-admin*, no workspace commands. The body carries `os-workspace-pinned`.

### The fence

When the workspace narrows the apps (`apps.mode: 'only'`), a pinned user can reach exactly:

- the admin menus the workspace keeps, and every page under them — read from the **recipient's own admin menu** at request time, never from anything the client sent;
- the pages its launch list opens;
- what those imply: a post type's list implies its editor, a taxonomy's list its term screen, the Media library uploading;
- always: the shell, the Dashboard and their own profile (`openstation_workspace_fence_always_allowed`).

Anything else is refused on `current_screen`. `openstation_workspace_fence_allows` has the last word.

**This is a guardrail, not a security boundary.** It fences admin *screens*. Capabilities still decide what a user may do, and a REST or AJAX call is answered on the capability alone. To take a power away from someone, take it off their role.

### Releasing, turning off, republishing

All from the Workspaces app:

- **Release** a person (or **Release everyone**): their stashed desks come back, the workspace stays among them as an ordinary desk they now own, and OpenStation becomes theirs to switch off again.
- **Link is on** off: nobody new can claim it. People already using it keep their desk.
- **New link**: for a link that got out. The old one stops working at once; people already using the workspace keep it, because a claim is recorded against the share, never its token.
- **Publish changes**: when a shared workspace changed since it was shared, its card says so. Publishing keeps the link and bumps the share's version; every pinned recipient's desk takes the new definition — and opens its windows again — the next time it loads.
- **Delete** the workspace: your copy only. The link and everyone using it are untouched, and the link moves to *Other shared links*, where it can still be managed.
- **Delete link**: everyone it pinned is released first, then the link is gone.

Anyone who may share can manage **every** link on the site — including another admin's. A pin must never outlive the only person able to open it, so an admin who leaves hands their links to whoever can share; a share is not deleted with its author.

### Hide settings

One checkbox per workspace: leave out every screen that configures the site rather than working in it — Settings, OpenStation Preferences, plugins, themes, the Customizer, the file editors, menus and widgets, tools, users, updates and site health.

- **For the desk's owner** it is a view, like the rest of a workspace: those apps leave the rails.
- **For a pinned user** it is enforced whatever the workspace otherwise includes: the fence refuses those screens, and the App Framework refuses those apps (Preferences, Plugins, Users, Network, Code Blue, Workspaces) through `openstation_app_allows`.

The lists are the server's — `openstation_workspace_restricted_screens` and `openstation_workspace_restricted_apps` — and reach the shell as `config.workspaceRestricted`, so the rails hide what the server refuses.

---

## Narrowing never edits your settings

The navigation already has one answer to "where does this item show?" — `navPlacement`, the user's stored per-item override — and `computeNav` is a pure function of it. A workspace does not add a second mechanism: it computes the navigation with **extra `'hidden'` entries in that map**, fresh on every repaint.

**Switching to a shop desk and back leaves `navPlacement` byte-identical.** A workspace can be deleted without unpicking anything, and an item the user hid globally stays hidden inside every workspace.

Two things a workspace may never hide, structurally rather than by default:

- **OpenStation's own controls** — Workspaces, the System tile, Mio, Exit. A workspace that could hide these could strand the user on a desk with no way to change it, and the way out would be editing user meta. **Trash** is different: it sits in a control's tile but opens a window of its own, so a workspace keeps or hides it like any other app.
- **Locked items** — Exit OpenStation already refuses every other placement write.

An **open window always keeps its tile**, even on a desk that hides its app. `computeNav` mints an ephemeral tile for any window with nowhere to minimize back into, so narrowing can never strand a window you are looking at.

**On a phone there is no workspace.** While the mode is `mobile` the navigation is computed with no profile at all, so the home grid shows every app whatever desk is active; the desk's look, widget column and launch list are not applied either, and every window is on the one desk the phone shows. The desks and their profiles are untouched — they are all back on the crossing out of the band, and the session keeps recording each window on the desk it came from. See [`docs/mobile.md`](mobile.md#the-session-on-a-phone).

## Widgets are a layout, not a filter

A workspace's widget column follows a **different rule from its apps**, deliberately.

Narrowing apps can only ever *hide*, because the placement map it narrows is the user's own and adding to it would be editing their settings. A widget column is not a filter over anything — it is a layout, and "this desk has the drafts list and a timer" is a complete statement. So `widgets.mode: 'only'` mounts exactly what it names, **whether or not the user enabled those widgets globally**, and unmounts everything else.

What it shares with apps is the part that matters: **it writes nothing.** `WidgetLayer.setVisibleIds()` mounts and unmounts and never touches the persisted enabled list, so leaving the workspace — or deleting it — gives the user back the column they built, untouched.

A widget whose plugin has since been deactivated is skipped rather than reported: a shorter column, not a broken desk. It comes back on its own when the plugin does, because the profile still names it.

`widgets` is **optional on the profile**, and absent means `'all'`. Every profile written before workspaces had widgets is in that shape, and a field that defaulted to an empty `'only'` list would blank a user's column on upgrade.

## Settings are a view too

**Every workspace carries ALL of the OS settings, without exception** — the wallpaper and accent, the dock and layout, the navigation, the features — and applies them to its desk. The main desk has the user's own settings.

- **Saving** the main desk as a new workspace captures every setting. A workspace made any other way (`wp.os.workspaces.create()`, MIO) is completed on creation: the settings it does not name are the user's, as they are then. One saved before this, carrying only a few, is painted with the rest from the user's own and written complete the first time a setting is edited on it.
- **Editing on its desk** changes the workspace. Every change made in Preferences while a workspace's desk is on screen — through `update()`, a panel that edits in place and saves, or **Reset to defaults** — goes into that workspace (`OsSettings.onWorkspaceEdit`), not into the user's own settings, and stays with the desk across switches and reloads. On the main desk, a change is the user's own. On a pinned user's desk nothing is written to the workspace (see below).

`profile.appearance` is stored as given and applied only while the workspace is active. `OsSettings.setWorkspaceAppearance()` keeps the user's own state aside and puts it straight back on the way out. Switch to a shop desk, look at its dark ground and indigo accent, switch back — the settings are byte-identical.

Three things this has to get right, and each has a test:

- **Desk to desk.** Switching from an overridden workspace straight to another restores the user's base *first*, so the second desk's patch lands on their settings rather than on the first desk's.
- **Saving while standing on one.** Opening Preferences on a workspace's desk and saving writes the **user's** own values back untouched. Without that, one save would quietly adopt the workspace's wallpaper as their own.
- **Editing while standing on one.** A change goes to the workspace and stays on its desk; the user's own settings, and the main desk, are untouched. Where no workspace may be written (a pinned user), the change is the user's, and survives a switch.

A profile write to the desk on screen repaints the look only when it changed `appearance`. Recording a widget, provisioning or saving the arrangement re-applies the widget column alone, so a wallpaper picked on the desk survives adding a widget to it.

**Every key is honoured except one**: `appliedThemeRecommendations`, the shell's own ledger of which theme already seeded its recommendations — writing it from a profile would re-arm a theme's one-time seed. Both sides derive the list from the settings defaults (`WORKSPACE_APPEARANCE_KEYS` from `DEFAULTS`, `openstation_workspace_setting_keys()` from `openstation_default_os_settings()`), so a setting added later is overridable the day it ships. A profile is user meta round-tripped through an untrusted client, so the server runs every value through the settings' own sanitizer: a workspace can carry exactly the values a user could have saved, and nothing else.

### For the people a shared workspace pins

A pinned user's settings split in two:

- **Cosmetic** — wallpaper, accent, desktop theme, window corners, reveals, the unfocus effect, window-link visuals, Mio, the rail renderer, post-status ribbons (`openstation_workspace_cosmetic_settings`). The workspace is where they **start**: the values are copied into the user's own settings when they claim the link, and are theirs to change after. A republish does not overwrite them.
- **Everything else** is **held** by the workspace while they are pinned: laid over their settings on every read, on the server (`openstation_os_settings`), so a server-side check sees it too; and a save cannot change it (`openstation_os_settings_before_save` keeps their own stored value). A release gives back exactly what they had.

### Picking a look

A workspace takes the settings the main desk had when it was saved. To change them later, go to its desk and change them in Preferences — they are saved into the workspace as you make them. `wp.os.workspaces.captureAppearance()` and `setProfile()` do the same from code.

A share carries every setting too: `openstation_workspace_share_sanitize_snapshot()` fills in any the profile leaves out at their defaults, so a pinned recipient never keeps a value of their own that the workspace did not decide.

## Provisioning runs once; a reload restores the definition

The launch list is **arranged once per workspace**, guarded by `profile.provisioned`. Provisioning is the first-entry act: it opens the windows and runs the layout, then leaves your arrangement alone. Switch away and back within a session and the desk stays as you left it — a workspace has to be tidyable while you work.

A **reload is different**. A workspace's launch-list windows and its widget column are part of what the desk *is*, not a one-time suggestion, so a reload restores that definition: any launch window you had closed reopens, and any widget you had closed remounts. On boot, `reopenWorkspaceWindows()` runs after session restore and opens only the launch entries whose window the restore did not already bring back — it never opens a second copy of a window that is open, and never re-stamps `provisioned`. It re-runs the layout only when it reopened something: a window it brings back has no place of its own and would land on top of the others. A desk that came back whole is left exactly as it was, so a window you moved by hand stays where you put it. The widget column is re-asserted in the same beat by `applyWorkspaceView()`.

So the rule a launch window and a column widget both follow: **closing one hides it for the rest of this visit; arriving at the desk again restores it.** To take a window or widget off a desk for good, close it and **Save changes** (Edit on its desk, or `/keep-desk`), which writes the profile directly. This mirrors apps: you do not remove an app from a desk by closing its window.

**A launch entry opens the way a menu pick opens.** Its URL goes through the native-window remap first, so a page the viewer opted a native window into gets that window rather than a classic iframe of the URL, and an entry nothing claims is built with the menu's own metadata — `submenu`, `parentUrl`, `selfLabel` — so it comes up with its tab strip. Each entry gets a window **of its own**: a desk's list declares N windows, and two entries that resolve to the same one (the native Posts window on its Add Post tab beside the same window on its list) are two windows rather than one focused twice. No two entries take the same window, on a desk that already has them or on one being built. An entry takes a window the desk already has before it opens another, so pressing Restore on an intact desk re-tiles what is there instead of doubling it. It takes the closest one: the window opened under its own id, which survives in-window navigation and a reload; then one opened on its page, because a second desk's windows carry suffixed ids; then any window of its menu. Every entry gets its closer match before any entry falls back, so a writing desk missing its draft gets the draft back rather than a second Posts list. The reload pass follows the same rule: it fills the gaps a restore left, and re-arranges the desk only when it filled one.

The `provisioned` flag is claimed *before* the windows open: opening a window is asynchronous, and a second switch landing mid-pass would otherwise run the whole list again and leave the desk with two of everything.

The layout is applied on the next frame, not inline — every arrangement reads the work area and the windows' own boxes, and a window created in this tick has neither until the browser has laid it out.

`provision( id, { force: true } )` runs the whole list and the layout again. That is the user asking on purpose — Restore under a tile — which re-tiles even a desk that is whole, unlike the reload pass; so every automatic caller leaves the flag off.

A **closed widget is no longer recorded as an edit** to the desk. Under an `only` column, adding a widget still records it on the profile (the desk keeps what you gave it), but closing one does not remove it — otherwise the reload promise above could not hold. Permanent removal is a Save changes.

### Keep this desk

**`/keep-desk`** in the command palette (also a row in `/workspace`, and `wp.os.workspaces.saveDesk()`) makes the workspace open the way the desk is *now*: the open windows and **where they are**, the mounted widgets, the apps on the rails. It is the one write a workspace makes on purpose, and the cheapest way to turn a plain Space into a workspace — save it, and it is one.

Where each window is comes along in a form that survives a resized browser or a different display: a grid-snapped window keeps its cells (`gridSpan`), a free one becomes fractions of the work area (`place`, each of `x`, `y`, `width`, `height` in `[0, 1]`). The arrangement becomes `free`, because the positions *are* the arrangement now and an algorithm re-laying them out would undo the thing just kept. The desk is marked provisioned — what it would open is already open — and controls (Workspaces, System, Mio, Exit) are never written into the app list, since the narrowing cannot hide them anyway. Trash, an app, is kept when it is on the dock.

On a workspace desk with its own column, a widget's × takes it off *this* desk and a widget added from the picker joins *this* desk — the user's own column, geometry and docked heights are untouched either way, and the change is recorded on the profile so the desk comes back the same. That is what keeps "a workspace never writes the user's settings" true even for a write the user makes from inside one.

## The layouts

`columns` and `focus` are new arrangements, and both are on the window manager alongside `cascade()` and `tile()`:

```js
wp.os.windowManager.columns();      // full-height columns, side by side
wp.os.windowManager.focusLayout();  // one leading, the rest stacked in the margin
```

**`columns`** hands off to `tile()` past four windows — a fifth column is narrower than an admin table's own minimum width, and every window would grow a horizontal scrollbar.

**`focus`** leads with the **focused** window, not the first in the stack, so re-applying after clicking into the reference list does not demote the thing you just reached for. A workspace opening its launch list, Restore putting it back, or a reload reopening one of its windows leads with the list's first entry instead: a writing desk's blank draft, with the Posts list in the margin. With one window it degrades to "maximize politely". Its split is `0.64`, filterable through `os.arrange.focus.split`; a return outside `[0.3, 0.9]` falls back rather than being clamped.

---

## JavaScript API — `wp.os.workspaces`

```typescript
wp.os.workspaces.list(): Desktop[];
wp.os.workspaces.active(): Desktop | null;
wp.os.workspaces.getProfile( desktopId ): WorkspaceProfile | null;
wp.os.workspaces.setProfile( desktopId, profile | null ): boolean;
wp.os.workspaces.create( options? ): Desktop;
wp.os.workspaces.switchTo( desktopId ): void;
wp.os.workspaces.arrange( layout ): void;
wp.os.workspaces.provision( desktopId, { force? } ): void;
wp.os.workspaces.capture( desktopId ): WorkspaceProfile[ 'windows' ];
wp.os.workspaces.captureAppearance(): WorkspaceProfile[ 'appearance' ];
wp.os.workspaces.saveAs( sourceId? ): Desktop | null; // save a desk (the main one) as a NEW workspace
wp.os.workspaces.restoreMain(): Promise<boolean>; // the main desk, back to a fresh install (asks first)
wp.os.workspaces.edit( desktopId ): void;      // edit it on its desk, with a Save changes toast
wp.os.workspaces.manage( desktopId? ): void;   // the Workspaces app
wp.os.workspaces.rename( desktopId, label ): boolean;
wp.os.workspaces.remove( desktopId ): boolean; // never the last desk, never while pinned
wp.os.workspaces.isPinned(): boolean;          // pinned to a shared workspace
wp.os.workspaces.apps(): WorkspaceApp[];        // every app a workspace can use — see below
wp.os.workspaces.openCreator(): void;          // alias of saveAs(), kept for existing callers
wp.os.workspaces.saveDesk( desktopId? ): boolean; // keep the desk as it is — /keep-desk
```

`getProfile()` returns `null` for a plain Space, and that is meaningful: a desktop with no profile behaves exactly as it did before workspaces existed. Every session saved before them is in that state, so nothing may assume the field is there.

### Shapes

```typescript
interface Desktop {
    id:       string;
    label:    string;
    profile?: WorkspaceProfile;   // absent = a plain Space
}

type WorkspaceLayoutId = 'free' | 'cascade' | 'tile' | 'columns' | 'focus';

interface WorkspaceProfile {
    preset: string;               // legacy provenance, '' on every new desk
    icon:   string;               // dashicon class
    color:  string;               // '#rrggbb', or '' for the shell accent
    apps: {
        mode: 'all' | 'only';     // 'all' = show everything (the default)
        ids:  string[];           // nav ids kept visible under 'only'
    };
    // Optional. Absent means 'all' — the user's own column, untouched.
    widgets?: {
        mode: 'all' | 'only';     // 'only' = the column IS these ids
        ids:  string[];           // widget registry ids
    };
    // Sparse appearance patch, allowlisted keys only. Absent or empty
    // means the desk looks the way the user set the shell up.
    appearance?: Partial< Record< WorkspaceAppearanceKey, unknown > >;
    windows: Array< {
        match:  string;           // token tested against the navigation
        url?:   string;           // admin-relative URL to open instead
        title?: string;
        gridSpan?: GridSpan;      // where it goes, in cells (wins over place)
        place?: { x, y, width, height }; // where it goes, as fractions of the work area
    } >;
    layout: WorkspaceLayoutId;
    provisioned?: boolean;        // whether the launch list has run
    restricted?: boolean;         // "Hide settings" — see Sharing a workspace
    notes?: WorkspaceNote[];      // read-only notes on the desk — see Workspace notes
}

interface WorkspaceNote {
    id:    string;                // [a-z0-9-], stable: dismissals key on it
    text:  string;                // plain text, ≤ 1000 chars (≤ 2000 for 'xl')
    size:  'normal' | 'xl';       // 'xl' is twice the size
    color: 'butter' | 'blush' | 'sky' | 'mint' | 'lilac' | 'peach';
    x:     number;                // left edge, fraction of the desk (0–1)
    y:     number;                // top edge, fraction of the desk (0–1)
}

```

`WorkspaceApp` — one entry of `wp.os.workspaces.apps()`:

```typescript
interface WorkspaceApp {
    id:    string;                // a launch entry's `match`; a dock app's nav id
    title: string;
    icon:  string;
    pages: Array< { title: string; url: string } >; // main page first, then its tabs; [] for a window app
    dock:  boolean;               // has a dock icon a workspace can keep or hide
}
```

A launch entry whose `match` names a registered native window with no navigation item (Preferences, Station Home…) opens that window; before, it was dropped.

### JS hooks

| Hook | Kind | Status | Payload |
|---|---|---|---|
| `os.workspaces.updated` | action | Stable | `{ desktopId, profile }` — a workspace's profile changed. `profile` is `null` when it became a plain Space. |
| `os.workspaces.provisioned` | action | Stable | `{ desktopId, opened, layout }` — the launch list has run. `opened` is smaller than the list whenever an app it names is not installed. |
| `os.arrange.columns.starting` / `.applied` | action | Stable | `{ windowCount, cols }` |
| `os.arrange.focus.starting` / `.applied` | action | Stable | `{ windowCount, split }` |
| `os.arrange.focus.split` | filter | Stable | filters the lead window's share (default `0.64`); context `{ windowCount, areaWidth, areaHeight }`. Returns outside `[0.3, 0.9]` fall back. |

---

## PHP

### Persistence

A profile rides on the desktop inside the session (`desktop_mode_session` user meta) and is bounded by `openstation_sanitize_workspace_profile()`: at most 128 app ids, 32 widget ids and 12 launch entries, a `#rrggbb` colour or nothing, and a layout from the known set.

App ids are filtered to `[A-Za-z0-9_-]` rather than passed through `sanitize_key()`, which **lowercases** — a native window registered as `wpdcEditor` would be stored as `wpdceditor` and then match nothing on the client. Widget ids allow the slash too, because a widget id is a namespaced registry key (`desktop-mode/post-stats`) and stripping the separator would make every shipped widget stop matching.

A shared workspace lives somewhere else too — see [Shared workspaces, stored](#shared-workspaces-stored).

### Shared workspaces, stored

| Where | What |
|---|---|
| `openstation_ws_share` post type | One post per shared workspace: the frozen, sanitized snapshot as JSON in `post_content`, the name as its title, the admin who shared it as its author. `delete_with_user` is off — a share outlives its author. |
| `_openstation_ws_token` post meta | The link token. Unguessable, never the post id. |
| `_openstation_ws_desktop` post meta | The author's desk it was shared from. |
| `_openstation_ws_version` post meta | Bumped on every publish; a pinned desk re-provisions when it changes. |
| `_openstation_ws_disabled` post meta | `'1'` while the link is off. |
| `_openstation_ws_hash` post meta | The publishing client's fingerprint of the profile, for "Changed since you shared it". Opaque to the server. |
| `openstation_workspace_pin` user option | The share a user is pinned to, the version their desk last opened, and the stash of the session they had. Per site (`update_user_option()`), so a pin on one site never locks another. |
| `openstation_workspace_claims` user option | Every share the user has claimed, and the desk it landed on. What makes a link claim once. |
| `openstation_workspace_dismissed_notes` user option | The workspace notes the user has dismissed (ids, the most recent 200). |

### PHP hooks

Every one is in [`hooks-reference.md`](hooks-reference.md#shared-workspaces): `openstation_workspace_share_capability`, `openstation_workspace_share_snapshot`, `openstation_workspace_shared`, `openstation_workspace_share_claimed`, `openstation_workspace_share_redirect`, `openstation_workspace_pin_released`, `openstation_workspace_share_deleting`, `openstation_workspace_fence_always_allowed`, `openstation_workspace_fence_allows`, `openstation_workspace_restricted_screens`, `openstation_workspace_restricted_apps` — plus the two general ones the feature is built on, `openstation_session` and `openstation_app_allows`.

---

## See also

- [`docs/javascript-reference.md`](javascript-reference.md#virtual-desktops-spaces) — the underlying Spaces API
- [`docs/hooks-reference.md`](hooks-reference.md) — the PHP filter
- [`docs/event-driven-framework.md`](event-driven-framework.md) — why a workspace publishes hooks rather than the framework guessing
