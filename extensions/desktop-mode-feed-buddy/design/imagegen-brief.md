# SOL Inbound Monologue Imagegen brief

The retained generated artifacts use the earlier short title “SOL IM.” The
shipping product name is now **SOL Inbound Monologue**; those images remain
historical composition references rather than production UI.

## Selected artifact

- Mode: built-in Imagegen
- Taxonomy: `ui-mockup`
- File: `sol-im-messenger-north-star-v3.png`
- Pixels: 1536 × 1024
- SHA-256: `9d17d3bc25fa9a4f27dfe21c95138f1af26a97128893b7a74761da184067c44d`
- Role: composition and surface-character reference only; no generated UI is shipped.

## Locked visual contract

- Historical reference: compact 1999–2001 desktop instant-messenger software.
- Shape language: square windows, one-pixel borders, inset panes, crisp bevels.
- Palette: system gray and white surfaces, cobalt title bars, pale blue groups,
  restrained green/amber/red status accents.
- Hierarchy: signed-in buddy identity and dense grouped roster beside a larger
  chronological one-way conversation transcript.
- Type: live system-sans typography; generated text is never used at runtime.
- Anti-era cues: no glass, neon, soft blobs, large rounded cards, glossy Web 2.0
  chrome, mobile-app spacing, AOL marks, or copied messenger assets.

## Initial prompt

```text
Use case: ui-mockup
Asset type: OpenStation visual-direction north star
Primary request: Create a high-fidelity, realistic, shippable product UI mockup for “FeedBuddy,” an original personal RSS reader inspired by compact 1999–2001 desktop instant messengers.
Scene/backdrop: A clean OpenStation-style desktop workspace showing two related live surfaces: a narrow floating buddy-list widget and a larger native reader window. The desktop context should be quiet and secondary.
Subject: The narrow widget groups RSS feeds like buddies, with tiny original presence/status marks, compact group headers, feed rows, and restrained unread badges. The reader window shows one newly arrived article as an incoming chat-style entry with a clear headline area, short excerpt area, timestamp area, and obvious open-article action. The two surfaces must visibly belong to one product.
Style/medium: Authentic late-1990s/early-2000s desktop productivity software UI; practical product design, not concept art, not a marketing poster.
Composition/framing: Wide landscape desktop view. Widget approximately 280 × 460 on the right side; reader window approximately 720 × 580 centered-left; clear spatial relationship and readable hierarchy at native scale.
Lighting/mood: Bright, cheerful, utilitarian, friendly, lightly nostalgic, crisp rather than cinematic.
Color palette: Windows-era system gray, cobalt blue title bars, pale blue group headers, black text, white content panes, restrained green/amber/red status accents.
Materials/textures: Crisp one-pixel borders, square bevels, inset white panes, tiny pixel-like status marks, extremely subtle period-appropriate dithering; no glossy depth.
Text (verbatim): Render exactly these labels and no other readable words: “FeedBuddy”, “NEWS”, “BLOGS”, “Mark all read”.
Constraints: Original interface only. Preserve clear hierarchy and enough breathing room to reproduce every element in responsive HTML and CSS. Widget must read as passive glanceable status; reader must read as the active tool. No AOL logo, no AIM wordmark, no running-man icon, no copied buddy icons, no copied sounds, no trademarks, no watermark, no fake web browser chrome, no extra logos or emblems. No dense readable article prose; use clean abstract text lines for content outside the four exact labels.
Avoid: glassmorphism, neon glow, large rounded cards, modern mobile spacing, soft gradient blobs, glossy Web 2.0 styling, illegible pseudo-text, decorative clutter, false extra controls, excessive title bars, photorealistic desk or hardware.
```

## Targeted revision

The first result established the product relationship but gave the reader an
ambiguous icon toolbar and too much dead space. The revision changed only the
reader interior:

```text
Use case: precise-object-edit
Asset type: OpenStation visual-direction north-star revision
Input images: Image 1 is the edit target and approved composition anchor.
Primary request: Change only the interior content layout of the large reader window. Consolidate it into one coherent, compact instant-message transcript: remove the ambiguous five-icon toolbar; keep one prominent incoming article message with a compact feed identity row, headline bars, excerpt bars, timestamp/status area, and one clearly separated bottom action row. Reduce the oversized empty lower half so the active reader feels purposeful, but retain quiet breathing room.
Invariants: Keep the entire narrow FeedBuddy widget unchanged. Keep both window sizes, positions, title bars, cobalt/system-gray palette, square bevel language, desktop background, taskbar, all exterior chrome, and the exact labels “FeedBuddy”, “NEWS”, “BLOGS”, and “Mark all read” unchanged. Do not add new readable words, logos, marks, controls, panels, windows, or decorative objects.
Constraints: The revised reader must still look like practical 1999–2001 desktop software and remain reproducible in responsive HTML/CSS. Preserve the original clean geometry and one-pixel period detailing.
Avoid: modern rounded cards, glass, gradients, glossy Web 2.0 styling, extra toolbar icons, fake controls, dense pseudo-text, decorative clutter.
```

## Product-name revision

The initial and targeted-revision prompts above are retained verbatim as the
generation record for the original working name. After the product was renamed
to SOL IM, one precise text-only edit was made:

```text
Edit this existing approved OpenStation UI north-star mockup with exactly one targeted change: replace every visible product-title instance of “FeedBuddy” with the exact text “SOL IM”. Preserve all window positions, dimensions, controls, feed names, article copy, typography style, cobalt/system-gray palette, one-pixel borders, desktop background, and every other visual detail unchanged. Do not redesign, add, remove, move, or restyle anything. No logos, wordmarks, running-man icon, AOL branding, watermark, or new text.
```

Native and 420 px thumbnail inspection confirmed that the composition, palette,
surface character, and hierarchy are unchanged; only the product title changed.

## Messenger-first redesign

After runtime feedback that the first implementation still read as an RSS
dashboard, a new concept was generated from scratch. This prompt intentionally
makes the messenger metaphor the three-second read:

```text
Use case: ui-mockup
Asset type: OpenStation visual-direction north star for a shippable desktop plugin
Primary request: Redesign “SOL IM,” a personal RSS reader, so the first three-second read is unmistakably a 1999–2001 desktop instant messenger rather than an RSS dashboard. Show a narrow buddy-list window and a larger one-on-one conversation window, both functioning as practical OpenStation surfaces.
Scene/backdrop: A restrained late-1990s Windows-like OpenStation desktop. No browser chrome.
Subject: The narrow buddy list has a compact signed-in identity strip with a tiny original avatar tile, “Online” presence, grouped feed buddies under NEWS and BLOGS, dense one-line buddy rows, tiny square presence marks, away/offline state cues, and small unread counts. The conversation window is titled for one selected feed and looks like an active IM conversation: a menu strip, a small utility toolbar, a recessed transcript pane, multiple chronological incoming article messages from the same feed buddy with bold colored buddy name, timestamp, article title, two-line excerpt, and a compact underlined open-article link. At the bottom, use a shallow recessed action shelf with “Mark read” and “Open article” controls—not a fake message composer and no Send button.
Style/medium: High-fidelity realistic product UI mockup, authentic 1999–2001 desktop instant-messenger software; practical and reproducible in HTML/CSS, not concept art.
Composition/framing: Landscape 3:2 desktop view. Buddy list approximately 260 × 520 on the left, conversation window approximately 720 × 560 on the right, both large enough to inspect. Strong visual relationship and clear IM hierarchy. Keep the desktop quiet.
Color palette: Windows-era system gray, saturated cobalt title bars, white recessed transcript, pale blue selection, black text, dark-blue buddy names, restrained lime/amber/red presence marks.
Materials/textures: Crisp one-pixel borders, square bevels, inset fields, compact Tahoma/Verdana-like UI typography, tiny original pixel-style status marks, almost no rounded corners, minimal shadow.
Text (verbatim): “SOL IM”, “Online”, “NEWS”, “BLOGS”, “WordPress News”, “Mark read”, “Open article”. Render these exact labels clearly and do not add other readable brand text.
Constraints: Original interface only. Make it feel inhabited and conversational, with at least three visibly separate incoming article messages in the transcript. Dense desktop spacing, menu-strip and transcript rhythm, clear focus state, operational controls reproducible in HTML/CSS. No AOL logo, no AIM wordmark, no running-man icon, no copied buddy icons, no copied sounds, no watermark, no fake browser chrome. The RSS premise must remain legible through article titles/excerpts and unread counts.
Avoid: dashboard cards, chat bubbles, large empty panels, modern mobile spacing, glassmorphism, neon glow, pill buttons, large rounded cards, glossy Web 2.0 styling, pseudo-text clutter, oversized typography, decorative wallpaper clutter, fake message composer, Send button.
```

## Real-content revision

The first messenger-first output established the winning grammar but invented
retro feed names and historical article copy. One content-only edit replaced
those names with the real demo feeds and current seeded article titles while
locking all geometry and surface styling:

```text
Use case: text-localization
Asset type: revised OpenStation SOL IM UI north star
Input images: Image 1 is the approved messenger-layout edit target.
Primary request: Change only the feed/content text inside the buddy roster and conversation transcript so it uses the real SOL IM demo feeds and current demo article titles. Preserve the full messenger layout, window geometry, title bars, menu strips, toolbar, avatar, presence marks, counts, spacing, typography style, transcript separators, buttons, desktop background, and every other visual detail.
Buddy roster text: Under NEWS show “WordPress News”. Under BLOGS show “Developer Blog” and “Make WordPress Core”. Remove the invented BBC, Reuters, Slashdot, TechCrunch, Ars Technica, Wired, Boing Boing, Daring Fireball, kottke.org, MetaFilter, Engadget, Jason Kottke, Cameron Moll, and TUAW names; replace any remaining roster rows with short gray abstract placeholder bars rather than readable names.
Conversation text: Keep “WordPress News” as the selected conversation and sender. Use these three article titles: “WordPress 7.1 Beta 3”, “WordPress 7.0.2 Release”, and “WordPress 7.1 Beta 1”. Use short clean two-line abstract excerpt bars rather than invented historical prose. Keep the underlined “Open article” action for each message.
Constraints: This is a text/content-only revision. Do not move, resize, add, remove, or restyle windows, controls, menu bars, toolbars, transcript rows, buttons, scrollbars, presence indicators, or the avatar. Preserve exact cobalt/system-gray palette and one-pixel bevel character. No AOL logo, AIM wordmark, running-man icon, fake logos, new brands, watermark, or pseudo-text.
```

The final output was inspected at 1536 × 1024 and 420 × 280. The production
translation uses live text, Dashicons, and `<os-*>` controls; neither generated
avatar art nor generated toolbar icons ship.
