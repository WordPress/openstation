# Workspaces

**Status: Stable**

A virtual desktop — a "Space" — is a container for windows and nothing else: it has an id and a name. A **workspace** is that container plus the answer to one more question: *what is this desk for?*

That answer is four things, and they travel with the desktop:

| | |
|---|---|
| **Which apps show** | The rails can be narrowed to the apps this desk is about. A Commerce desk shows the store; a writing desk shows Posts and Media and nothing else. |
| **Which widgets are on it** | The desk can carry its own widget column — drafts and a timer on a writing desk, traffic on a shop floor. |
| **What it looks like** | Wallpaper, accent, desktop theme, dock — the desk's whole appearance, painted on entry and handed back on exit. |
| **What it opens with** | A launch list. Entering the workspace for the first time opens it. |
| **How they are arranged** | `free`, `cascade`, `tile`, `columns` or `focus`. Applied once the launch list has opened. |
| **How it is labelled** | An icon and a colour, worn by its overview tile. |

Three workspaces ship, and they are three different jobs rather than three arrangements of the same one.

| Template | Layout | Widgets | Look | The desk |
|---|---|---|---|---|
| **Commerce** | `columns` | clock, site views | dark ground, indigo | A shop floor. WooCommerce orders, products and analytics are things you *compare*, so they get full-height columns side by side, on a flat ground three tables read cleanly against. |
| **Learning** | `tile` | clock, heartbeat, recent comments | aurora, emerald | A course studio. Sensei courses, lessons and learners are a set you move *between*, so they tile — with the room's pulse beside them: who is around, and what is being said. |
| **Publishing** | `focus` | drafts, post stats, focus timer, notes | mono, rose, dock folds away | A writing desk. A blank page takes two thirds of the screen and the library sits in the margin. Its instruments are about the page, not the audience — no traffic chart — and the quietest ground there is. The one template whose point is what it leaves out, made in paint as well as in the app list. |

**Named for the job, not for the plugin.** A desk called "Woo" is wrong on a store running something else, and wrong again the day the product is renamed — but the *work* is commerce either way. The products are still what the templates reach for: the tokens name WooCommerce and Sensei directly, so on a site that has them the Commerce desk is a WooCommerce desk in everything but its label. On a site that does not, it degrades to the core menus its tokens still match rather than promising a product that isn't there.

---

## Using them

Everything happens **in the overview top bar**, and there is **one door: the `+`**. It opens the wizard.

There used to be a dropdown beside the `+` as well. Two doors to the same room — one that created desks from templates, one that created a blank desk without asking — and a user had to know which did what. The dropdown is gone; the `+` is the obvious place to press, so it is the only one.

**Overview is the only surface that carries any of this, on purpose.** It is already the Spaces surface — it names every desk, renames them, closes them, and adds new ones — and it is where a user goes with the question "which desk?" already in mind. The desk itself belongs to the user's windows; a control parked on it would be shell chrome hovering over the thing they are working in, and would need a work-area claim or an apology for covering something. Overview needs neither.

Overview tiles wear each workspace's glyph and accent, so a row of desks is legible at a glance rather than a row of identical grey rectangles.

### The wizard

The wizard's first step is **Start**, and it is the escape hatch:

- **Blank desktop** is a card, preselected, and **Create desktop** is the focused button. `+` then Enter is a plain new desk — the same two gestures it was before the wizard existed. Nobody is walked through five steps to get an empty desk.
- The templates are cards beside it. Pick one and press **Create from template** and the desk is made from it exactly as the dropdown used to — the template is read against the navigation as it stands right now, and the `os.workspaces.profile` filter runs.
- Activating a card that is already selected (a second click, or Enter on it) creates. Click once to choose, again to go.
- **Customize** is the only way into the remaining steps: **Name** (name, glyph, colour) → **Apps** → **Widgets** → **Look** (wallpaper, accent, dock) → **Windows** (launch list and arrangement). On every one of them, **Create workspace** is still in the footer: the wizard can be left at any point with whatever has been set so far.

A blank start that the user never customized creates a plain Space — no profile at all, behaving exactly as a desktop did before workspaces existed.

The wizard takes its whole world as data (apps, widgets, wallpapers, accents, templates) and hands its whole result back through one callback, so it lives in its own lazy bundle (`workspace-wizard[.min].js`) and never reaches `desktop.min.js`.

### Under each tile

Two buttons sit in a column below a tile, outside its preview:

- **Restore** — always visible, but only on a desk with something to restore: put it back the way its workspace defines it — reopen the windows it names, remount its column, repaint its look, re-run its arrangement.
- **Edit** — revealed on hover and keyboard focus, like rename and close. Opens the same wizard on that desk, without the Start step, with Save where Create was and a Delete in the corner. Offered on plain Spaces too: for one of those it is how it *becomes* a workspace.

Restore is the counterpart to the wizard's "Use the … I have now" captures. One saves the desk into the workspace; Restore applies the workspace back onto the desk.

Three decisions worth naming:

- **It force-provisions.** The once-per-workspace guard exists to stop the *shell* reopening windows on its own, not to stop the user asking. A desk they have since tidied is exactly the case this button is for. Windows still open reuse their instance rather than doubling, so restoring an intact desk just brings it to order.
- **It only appears where it has work to do.** A plain Space has nothing stored, and neither does a workspace whose profile says nothing beyond its name and colour. A button that visibly does nothing is worse than no button, so its absence is information.
- **The word is short, the accessible name is not.** "Restore" alone could be read as the session restore the shell does at boot, so the `aria-label` and tooltip carry the whole sentence: *"Restore Commerce — reopen its windows, widgets and look"*.

`wp.os.workspaces.provision( id, { force: true } )` is the programmatic equivalent for the windows half; `arrange()`, `setProfile()` and a switch cover the rest.

`/workspace` in the command palette (⌘K) is the keyboard route — one command for the whole question. It lists the desks that exist, then the templates that could become one, then `New desktop…` (the wizard) and `Edit this workspace…`. An existing desk wins over a template of the same name, so `/workspace commerce` means "take me there" once a Commerce desk exists.

## Templates degrade, they do not break

A template cannot name nav ids directly and stay useful. The id of the Products menu is whatever the URL derived on this install, WooCommerce may not be installed at all, and a site that renamed its post types has different ids again.

So a template names what it is **about** — `'post_type=product'`, `'sensei'` — and those tokens are matched as substrings against each item's id, URL, window id and title. Everything that matches lands in the workspace's visible set; a launch entry that matches nothing is **skipped**.

The consequence worth stating: **the Commerce template on a site without WooCommerce is a smaller desk, not four "you do not have permission" pages.**

Every template also keeps Dashboard, Media and Settings, whatever else it names. A desk with no way to reach them is a dead end, and the user would have to leave the workspace to do anything its author did not think of.

## Narrowing never edits your settings

The navigation already has one answer to "where does this item show?" — `navPlacement`, the user's stored per-item override — and `computeNav` is a pure function of it. A workspace does not add a second mechanism: it computes the navigation with **extra `'hidden'` entries in that map**, fresh on every repaint.

**Switching to a Commerce desk and back leaves `navPlacement` byte-identical.** A workspace can be deleted without unpicking anything, and an item the user hid globally stays hidden inside every workspace.

Two things a workspace may never hide, structurally rather than by default:

- **OpenStation's own controls** — Overview, the System tile, Trash, Mio, Exit. A workspace that could hide these could strand the user on a desk with no way to change it, and the way out would be editing user meta.
- **Locked items** — Exit OpenStation already refuses every other placement write.

An **open window always keeps its tile**, even on a desk that hides its app. `computeNav` mints an ephemeral tile for any window with nowhere to minimize back into, so narrowing can never strand a window you are looking at.

## Widgets are a layout, not a filter

A workspace's widget column follows a **different rule from its apps**, deliberately.

Narrowing apps can only ever *hide*, because the placement map it narrows is the user's own and adding to it would be editing their settings. A widget column is not a filter over anything — it is a layout, and "this desk has the drafts list and a timer" is a complete statement. So `widgets.mode: 'only'` mounts exactly what it names, **whether or not the user enabled those widgets globally**, and unmounts everything else.

What it shares with apps is the part that matters: **it writes nothing.** `WidgetLayer.setVisibleIds()` mounts and unmounts and never touches the persisted enabled list, so leaving the workspace — or deleting it — gives the user back the column they built, untouched.

A widget whose plugin has since been deactivated is skipped rather than reported: a shorter column, not a broken desk. It comes back on its own when the plugin does, because the profile still names it.

`widgets` is **optional on the profile**, and absent means `'all'`. Every profile written before workspaces had widgets is in that shape, and a field that defaulted to an empty `'only'` list would blank a user's column on upgrade.

## Appearance is a view too

A workspace can carry a **wallpaper, an accent, a desktop theme and a dock configuration** — the same settings the Appearance tab holds — and it paints the desk with them on entry.

`profile.appearance` is a **sparse patch**: only the keys present are overridden, and only while the workspace is active. `OsSettings.setWorkspaceAppearance()` keeps the user's own state aside and puts it straight back on the way out. Switch to a Commerce desk, look at its dark ground and indigo accent, switch back — the settings are byte-identical.

Three things this has to get right, and each has a test:

- **Desk to desk.** Switching from an overridden workspace straight to another restores the user's base *first*, so the second desk's patch lands on their settings rather than on the first desk's.
- **Saving while standing on one.** Opening Preferences on an overridden desk and saving writes the **user's** value back for every key they did not touch. Without that, one save would quietly adopt the workspace's wallpaper as their own.
- **Editing while standing on one.** A key they *did* change is theirs, and it is saved. The rest go back.

**Only allowlisted keys are honoured** — `wallpaper`, `wallpaperSettings`, `customGradient`, `customImage`, `accent`, `customAccent`, `desktopTheme`, `desktopLayout`, `dockPlacement`, `dockSize`, `dockBehavior`, `sideDockBehavior`, `windowRadius`, `windowReveal`, `unfocusEffect`, `adminBarMode`. That is not tidiness. A profile is user meta round-tripped through an untrusted client, and an unfiltered patch spread onto the settings state at boot would be a way to write any settings key from anywhere. The server enforces the same list, and bounds the nesting of the array-valued members.

Everything on the list is visual and instantly reversible, which is the test for belonging: switching desks must never leave the user somewhere they cannot get back from.

### Picking a look

The wizard's **Look** step is a real picker — wallpaper swatches (the same previews the Preferences grid paints), accent swatches, and the dock's behaviour — plus **"Use the look I have now"**, which captures the shell's current appearance into the profile. `wp.os.workspaces.captureAppearance()` is the same call. The desktop theme and the finer dock settings are not in the wizard; they are set in Preferences and captured from there.

## Provisioning runs once, not once per visit

The launch list runs **once per workspace**, guarded by `profile.provisioned`. Close a window the workspace opened, switch away, come back — the desk stays as you left it. Without that, a workspace would refuse to be tidied.

The flag is claimed *before* the windows open: opening a window is asynchronous, and a second switch landing mid-pass would otherwise run the whole list again and leave the desk with two of everything.

The layout is applied on the next frame, not inline — every arrangement reads the work area and the windows' own boxes, and a window created in this tick has neither until the browser has laid it out.

`provision( id, { force: true } )` runs it anyway. That is the user asking on purpose — the wizard's **Open them now** button, or Restore under a tile — which is a different question from the shell deciding on its own, so every automatic caller leaves the flag off.

### Saving the arrangement you already have

The wizard's **Use the windows I have open now** captures the desk's open windows into the launch list — the desktop-OS gesture of saving an arrangement you arrived at by working rather than by planning. `wp.os.workspaces.capture( desktopId )` is the same call.

A captured entry's `match` is the window's own id, not a token: a captured list is about *this* install, so there is nothing to degrade gracefully against and an id is the exact answer. Capturing also marks the workspace provisioned — those windows are already on screen, and re-running the list on the next entry would open a second copy of everything.

## The layouts

`columns` and `focus` are new arrangements, and both are on the window manager alongside `cascade()` and `tile()`:

```js
wp.os.windowManager.columns();      // full-height columns, side by side
wp.os.windowManager.focusLayout();  // one leading, the rest stacked in the margin
```

**`columns`** hands off to `tile()` past four windows — a fifth column is narrower than an admin table's own minimum width, and every window would grow a horizontal scrollbar.

**`focus`** leads with the **focused** window, not the first in the stack, so re-applying after clicking into the reference list does not demote the thing you just reached for. With one window it degrades to "maximize politely". Its split is `0.64`, filterable through `os.arrange.focus.split`; a return outside `[0.3, 0.9]` falls back rather than being clamped.

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
wp.os.workspaces.edit( desktopId ): void;      // the wizard, on an existing desk
wp.os.workspaces.openCreator(): void;          // the wizard, as the + opens it
wp.os.workspaces.presets(): WorkspacePreset[];
wp.os.workspaces.registerPreset( preset ): void;
wp.os.workspaces.unregisterPreset( id ): void;
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
    preset: string;               // template it came from; '' = built by hand
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
    } >;
    layout: WorkspaceLayoutId;
    provisioned?: boolean;        // whether the launch list has run
}

interface WorkspacePreset {
    id: string;
    label: string;
    description: string;
    icon: string;
    color: string;
    apps: string[];               // match tokens; empty = show everything
    widgets?: string[];           // widget ids; empty = the user's own column
    appearance?: WorkspaceProfile[ 'appearance' ];
    windows: WorkspaceProfile[ 'windows' ];
    layout: WorkspaceLayoutId;
    defaultLabel?: string;
    order?: number;               // ascending; ships 10 / 20 / 30
}
```

`preset` is **provenance only**. A template is read once at creation time; editing the workspace afterwards never writes back to it, and a template that changes in a later release never reaches a desk already created from it.

### Adding a template

```js
wp.os.workspaces.registerPreset( {
    id: 'support',
    label: 'Support',
    description: 'Tickets, comments and the people behind them.',
    icon: 'dashicons-sos',
    color: '#2271b1',
    layout: 'columns',
    apps: [ 'edit-comments.php', 'users.php', 'my-helpdesk' ],
    widgets: [ 'clock', 'desktop-mode/recent-comments' ],
    windows: [
        { match: 'my-helpdesk' },
        { match: 'users.php', url: 'users.php' },
    ],
} );
```

`order` defaults to `0`, which sorts **ahead** of the three shipped desks — the right default for a site that installed a workspace on purpose.

### JS hooks

| Hook | Kind | Status | Payload |
|---|---|---|---|
| `os.workspaces.presets` | filter | Stable | `WorkspacePreset[]` — the wizard's template cards. Return a shorter list to drop one, a longer one to add your own. |
| `os.workspaces.profile` | filter | Stable | `WorkspaceProfile`, context `WorkspacePreset` — fires the moment a profile is read off a template, before the desktop is created. |
| `os.workspaces.updated` | action | Stable | `{ desktopId, profile }` — a workspace's profile changed. `profile` is `null` when it became a plain Space. |
| `os.workspaces.provisioned` | action | Stable | `{ desktopId, opened, layout }` — the launch list has run. `opened` is smaller than the list whenever an app it names is not installed. |
| `os.arrange.columns.starting` / `.applied` | action | Stable | `{ windowCount, cols }` |
| `os.arrange.focus.starting` / `.applied` | action | Stable | `{ windowCount, split }` |
| `os.arrange.focus.split` | filter | Stable | filters the lead window's share (default `0.64`); context `{ windowCount, areaWidth, areaHeight }`. Returns outside `[0.3, 0.9]` fall back. |

---

## PHP

```php
openstation_workspace_presets(): array
```

The server's view of the template list, shipped to the shell as `openStationConfig.workspacePresets`. Filterable, and the filter has both powers:

```php
// Drop the Commerce desk on a site with no store.
add_filter(
    'openstation_workspace_presets',
    function ( $presets ) {
        return array_values(
            array_filter(
                $presets,
                fn( $preset ) => 'commerce' !== $preset['id']
            )
        );
    }
);

// Ship a complete workspace from PHP alone — no JavaScript.
add_filter(
    'openstation_workspace_presets',
    function ( $presets ) {
        $presets[] = array(
            'id'      => 'support',
            'label'   => __( 'Support', 'my-plugin' ),
            'icon'    => 'dashicons-sos',
            'color'   => '#2271b1',
            'layout'  => 'columns',
            'apps'    => array( 'edit-comments.php', 'users.php' ),
            'windows' => array( array( 'match' => 'users.php' ) ),
            'order'   => 40,
        );
        return $presets;
    }
);
```

The three shipped entries deliberately carry **no** `apps` or `windows`: the client already has their token lists, and a second copy in PHP would be a second place to keep in step. A server entry naming a client built-in says only "this one still exists"; an entry with an id of its own is registered whole.

Every entry the filter returns is sanitized. A malformed template costs that template, not the wizard: an entry with no id is dropped, an unknown layout falls back to `free`, and one with no label is named after its id.

### Persistence

A profile rides on the desktop inside the session (`desktop_mode_session` user meta) and is bounded by `openstation_sanitize_workspace_profile()`: at most 128 app ids, 32 widget ids and 12 launch entries, a `#rrggbb` colour or nothing, and a layout from the known set.

App ids are filtered to `[A-Za-z0-9_-]` rather than passed through `sanitize_key()`, which **lowercases** — a native window registered as `wpdcEditor` would be stored as `wpdceditor` and then match nothing on the client. Widget ids allow the slash too, because a widget id is a namespaced registry key (`desktop-mode/post-stats`) and stripping the separator would make every shipped widget stop matching.

---

## See also

- [`docs/javascript-reference.md`](javascript-reference.md#virtual-desktops-spaces) — the underlying Spaces API
- [`docs/hooks-reference.md`](hooks-reference.md) — the PHP filter
- [`docs/examples/workspace-preset.md`](examples/workspace-preset.md) — a copy-paste template
- [`docs/event-driven-framework.md`](event-driven-framework.md) — why a workspace publishes hooks rather than the framework guessing
