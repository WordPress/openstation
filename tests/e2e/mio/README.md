# MIO browser verification

Use a local development site with the built plugin synced, desktop mode enabled, and an AI provider that supports tool calls. This is the browser checklist; deterministic tests live in `tests/vitest/mio-*.test.ts`, `apps/os-settings/mio.test.ts` and `tests/phpunit/tests/mioAssistant.php`.

Use a test account: the write examples below intentionally change its Preferences. They do not change the public site theme.

1. Open **OpenStation Preferences**. With MIO disabled, verify there is no **Ask MIO** button. Enable MIO using its dock button, then click **Ask MIO** once. It must open immediately. Disable MIO from the dock again: both the companion and chat/launcher must disappear. Re-enable before continuing. Verify the companion shrinks/grows into the window and remains visible beside a wide conversation.
2. Ask: “From the Preferences help, explain dynamic dock versus dynamic sidebar. List the installed desktop themes and identify a darker choice. Do not change anything.” Verify that the answer distinguishes Unified from Split, uses the actual installed theme catalog, and leaves settings unchanged. This exercises linked help retrieval and parameterless tool calls through the real WordPress AI Client.
3. Ask: “Switch to that darker desktop theme, set rounded corners, unify the docks, and make the dock dynamic.” Check the **Themes**, **Windows** and **Appearance** controls, not just MIO's answer. Each requested setting must be saved. Reload and verify that the settings survive but chat history is empty.
4. Drag MIO across controls and toward the outside of the window. Controls and other windows must not be obstacles while resident; the owning body still bounds it. Maximize, restore and resize the window: the residency frame must continue to match the body.
5. Minimize Preferences. MIO must return to the desktop. Restore Preferences and it must claim MIO again. Focus an unregistered window: that window must not receive a resident frame or chat.
6. For two cooperating test apps using the [registration example](../../../docs/examples/mio-window-assistant.md), alternate focus. Only one frame may own the single MIO layer. Each chat retains only its own in-memory history. Disposing one lease must not remove the other app's companion.
7. While a request is running, press **Stop**, close chat, or change focus. A late reply must not execute more actions. Already-submitted writes may finish; MIO must not promise rollback. Reopen chat and confirm the account's actual settings before continuing.
8. Tab to the launcher, submit with Enter, and close with Escape. Verify the close button has the accessible name **Close MIO chat**. Test both the built-in palette and Legacy: input, Send, Stop and close labels must remain readable. Enable reduced motion and repeat a handoff; ownership still changes without scale animation.
9. Use a non-administrator test account. Site-wide Extended Options and AI comment controls must not be offered as actions. Destructive reset, theme deletion and share-data purging are absent for every account. Private MIO names must not appear in WordPress Abilities discovery.

Provider responses are intentionally not snapshot-tested. Judge factual grounding, actual saved state, ownership and cancellation. Do not capture credentials or transcripts in application logs to debug these tests.

## Motion and per-window controls

- Toggle MIO off in the dock: the window’s portrait fades out, Ask MIO disappears, and any pending chat stops. Toggle on: the portrait fades in.
- Toggle the portrait off: the slash appears, only this window loses residency. Toggle the dock off/on: that local choice stays off. Reenable the portrait to claim MIO again.
- Open chat: MIO smoothly approaches its chat home. Drag MIO across the window and release: it returns from any distance. Resize chat or the window while moving: it retargets without jumping. Close chat: it eases to its previous position. Rapidly reopen/close and change focus: no obsolete return runs in the new owner.
- Ask a question: upward gaze, halo and chat dots blend in; answer, Stop, close and disable all end thinking. Reduced motion shows a still indicator.
- Change Galaxy to Graphite: verify the visible wallpaper changes and the response describes an actual change. Request Graphite again: only this second request may report already selected.

- Request a reply longer than the conversation viewport: its first line remains visible on arrival. Scroll down manually; it does not pull you back. Reopen a long conversation and verify the latest message begins in view.

- Hover Ask MIO over a light Preferences window: the label stays readable on an opaque MIO-themed surface. Check keyboard focus and the same ghost controls inside chat.

- Open Preferences on Appearance: Ask MIO has a subtly translucent background and readable text; the mascot is hidden. Open chat: the mascot fades in. Close chat: it fades out.
- Visit About: MIO follows the journal heading with a dark “Visit our blog!” bubble matching the chat surface. Leave and return: the tip returns. Dismiss it, change tabs, and toggle MIO off/on: it stays dismissed. Close and reopen Preferences: About presents the tip again.
- Open chat while the tip is visible: chat takes priority. Close chat: the tip resumes. Disable MIO locally or globally: the tip cannot appear.
- Drag a window resize handle continuously with chat open: MIO remains painted throughout. Resize and scroll About: the tip remains inside the window and follows the journal heading; it hides when the heading leaves the window.

- Toggle the MIO dock button: Features → MIO API tracks it immediately. Toggle the checkbox: the dock active indicator, mascot, title-bar icon, chat and tips follow. Reload and confirm the choice persists.
- Disable Show MIO on wallpaper in Make it yours: MIO stays hidden on the desktop, but window chat and undismissed tips still appear. The MIO dock context menu can restore wallpaper visibility. Features shows the same choice; reload preserves it.
- With MIO API on, disable AI assistant: Ask MIO disappears, but About still offers its undismissed blog callout. Re-enable AI with a compatible connector: Ask MIO returns. Without a connector (or AI support), it stays hidden; window controls and callouts remain usable.

- With a consumer implementing structured validation, provide invalid arguments twice and verify MIO receives exact field paths and saves once after correction. A third invalid candidate stops without claiming a save.
- With a caller-owned large draft, verify full reads preserve all fields, only superseded reads are compacted, and a request exceeding the UTF-8 byte budget is stopped before HTTP.
- Cancel a pending save, inspect its operation using the application's read-only status resolver, and confirm that reconciliation never calls the write action again. Permission loss must remain terminal.
- Read a help file past 12,000 characters using its continuation cursor, then use a section ID to fetch a late rule directly. Exact component IDs should rank ahead of common words.


## Response action fixture

Run `npx vite --host 127.0.0.1 --port 8897` from the plugin root and open
`http://127.0.0.1:8897/tests/e2e/mio/response-actions.html`. This isolated fixture
simulates one form save and provider loop. It never contacts WordPress or an AI
provider. Send any message to create the saved reply.

- Preview opens/focuses the bound form 42 region. Provider/save counters stay fixed;
  a double click while pending produces one preview. Click again after completion.
- Read saved form details produces a local error; the saved reply stays intact.
- Tab to buttons, activate with Enter/Space, and check polite pending/error output.
  Focus must remain on the same button after an error; navigating may focus preview.
- Close during the pending read, reopen, then retry. No preview opens from canceled work.
- Revoke access after rendering and click Preview: no navigation and a local availability error.
- Toggle narrow layout and RTL; controls wrap without clipping. Check default tokens,
  light and dark chat token overrides, and reduced-motion settings.

Vitest additionally covers confirmed receipt binding after switching forms, failed
validation/unknown outcomes, immutable snapshots, descriptor validation, disposal,
conversation eviction, restored custom stores and provider-history exclusion.
