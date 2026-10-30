# Review instructions

`AGENTS.md` (loaded through `CLAUDE.md`) is the rulebook for this repository. This file only says what a review should spend its attention on, how loud each finding should be, and what to leave alone. Most pull requests here are written by agents: every comment costs a commit and another review round, so a finding has to be worth that.

## What failure looks like here

OpenStation is a WordPress plugin that replaces wp-admin with a desktop shell. It fails in four ways, in this order of cost:

1. **It leaks.** A REST route, ability, AI tool or app action returns content the caller may not read.
2. **It loses data.** A stored name moves, and the user's icons, files, session or themes vanish while the rows sit untouched under the old name.
3. **It breaks a plugin author.** A documented hook, `wp.os.*` method, payload key or event changes shape, or the docs now describe something the code no longer does.
4. **It stops updating.** A change saves correctly and shows nothing until F5, or a value one bundle writes is invisible to another.

## What Important means here

Reserve 🔴 Important for findings in the four classes above, plus incorrect logic, unescaped HTML from WordPress data, and anything that leaves a control unreachable or a window unusable. Style, naming, refactors and missing docs rows are 🟡 Nit at most.

## Always check

Each rule has its reasoning in the named `AGENTS.md` section. Cite that section in the finding instead of restating it.

- **Read paths** ("A status is not a permission"). Any new or widened read over posts, comments, terms, users or attachments asks all four gates (`read_post`, the post password, `is_post_type_viewable()`, and the parent by the same rules), keeps counts and totals over the same set as the items, guards a zero id before `get_post()` / `get_comment()`, and re-checks any id a model returned. A `readonly` ability or a route gated on `is_user_logged_in()` alone is a finding. Important.
- **Frozen stored names** ("`desktop_mode_*` values are frozen"). Renaming an option, meta key, table, upload dir, cron hook, post type, REST namespace, query var, storage key or window id that reads `desktop_mode_*` / `desktop-mode` without a migration in `includes/migrations.php` is Important. Never suggest the rename yourself.
- **Build output** ("Never hand-edit JS in `assets/js/`"). A diff to `assets/js/**` other than `admin-bar.js` and `media-library-enhanced.js` with no matching change under `src/` or `apps/` is Important: the next build erases it.
- **The Legacy snapshot.** Any edit to `assets/desktop-themes/legacy/theme.json` is Important unless the PR says why Legacy should change forever.
- **Cross-bundle state** ("Cross-bundle state"). New module-level mutable state that more than one bundle reads, not routed through `createSharedStore`, is Important.
- **Settings that gate a server registration** (the last bullet of "Live-refresh"). A toggle the server reads on `plugins_loaded` that saves without spending a menu refresh is Important.
- **Public surface without docs.** A changed hook, JS API, event, payload key, stored name or REST gate whose page in `docs/` (or the table in `includes/rest/README.md`, or the inventory in `docs/data-model.md`) now says something false is Important. A new surface with no row yet is Nit. A backwards-incompatible change to a Stable surface with no `docs/migration-*.md` note is Important.
- **The palette and the accent.** A colour token declared on `:root` instead of `body.os-active` is Important (it repaints wp-admin inside every window). In feature stylesheets under `assets/css/`, which no test sweeps: a colour literal outside `variables.css`, a removed `var()` fallback literal, or `--os-ui-accent` used for decoration rather than state is Nit.
- **The work area.** Default placement or framing sized from `#os-area` / `clientHeight` instead of `workAreaRectOf()` / `workAreaInsetsOf()` is Important when the dock can cover a control, Nit otherwise.
- **Host-agnostic framework.** A WordPress function called from `includes/framework/` outside `wordpress.php` and `app/wordpress/` is Important.
- **Text from WordPress.** A title, name or label inserted as HTML without escaping is Important. One shown through `textContent` without decoding entities (`&amp;` on screen) is Nit; that slip recurs here often enough to check.
- **Version stamps.** `@since`, "added in 1.x" or a versioned status label outside `docs/migration-*.md` is Nit.

## Do not report

- Anything CI already enforces: ESLint (including raw `fetch()` and `window.confirm`), `tsc`, `phpcs -n`, Plugin Check, and the guard tests under `tests/vitest/` (palette, accent reach, token reachability, holo layer, CSS template hygiene).
- Generated, vendored or translation files: `assets/js/**` (except the two hand-written files above), `extensions/*/assets/js/`, `extensions/mio-js/dist/`, `extensions/desktop-mode-popup-siege/games/popup-breaker/assets/`, `assets/vendor/`, `languages/`, every `*.lock` and `*-lock.json`.
- The `openstation_` code / `desktop_mode_*` value mismatch. It is deliberate.
- Missing test coverage. This repository adds a test only when it would catch a real bug. Do flag a new test that cannot fail, or that reads a source file to assert a string outside the named guard tests.
- File-length warnings and suggestions to split a file.
- Release-zip contents: `bin/package.sh` is an allow-list.

In `bin/`, `tools/`, `reports/`, `extensions/` and `tests/`, report only what is near-certain and severe.

## Evidence

- Every finding cites `file:line` in the code it is about. A claim about what a function does needs the line that does it, not an inference from its name.
- A claim about WordPress Core behaviour (a capability mapping, a filter's arguments, what a REST controller allows) cites the Core function or controller it comes from. When the repository's rule and your reading disagree, Core's REST controller for that object wins.
- A docs finding quotes the sentence that is now wrong.

## Keep reviews converging

- Report at most three Nits per review, the most useful first.
- When one mistake appears in several places, post one finding for the class and list every location, so it is fixed once.
- Report a 🟣 Pre-existing bug only when the diff touches the function it lives in.
- On a re-review, do not repeat a finding already posted on this pull request, resolved or not.

## Summary

Open the summary with the counts, in the form `2 Important, 1 Nit, 0 Pre-existing`. When there is nothing to fix, say exactly that in one line.
