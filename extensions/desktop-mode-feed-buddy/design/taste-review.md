# OpenStation taste review

## Decision

- Verdict: `ship`
- Winner: neutral Option B, the messenger-first revision
- Intended context: 280 px buddy widget plus a 760 px native reader window
- Confidence: high for direction; live browser capture remains policy-blocked

## Why this wins

Option B reads as an instant messenger before it reads as a feed reader. The
signed-in identity block, dense grouped buddy rows, selected-buddy highlight,
plain chronological transcript, cobalt sender names, and shallow action shelf
create one coherent late-1990s software world. Option A retained the palette
but behaved like an RSS dashboard with an unusually large empty article card.

## Protect

Protect the compact buddy-list density, the white recessed transcript, the
absence of chat bubbles/cards, and the one-way “incoming article” rhythm.

## Refine in production

1. Use only real actions and visible labels; omit decorative generated toolbar
   icons and false menus.
2. Keep article entries separated by rules rather than boxed as cards.
3. Preserve the selected-buddy highlight and signed-in identity at the widget’s
   smallest supported size.

## Panel evidence

- First impression: Option B immediately says “buddy list plus conversation.”
- Blind pairwise comparison: Option B wins because its identity strip, roster,
  and transcript work together; Option A depends mostly on cobalt chrome.
- System coherence: every inset, status mark, row, and action bar supports the
  messenger premise without requiring copied brand assets.
- Adversarial critique: the generated avatar and decorative utility icons would
  become false authorship or affordances if shipped, so the implementation uses
  a CSS monogram, Dashicons, and real controls instead.
- Context proof: the buddy/conversation split and three-message transcript
  survive at 420 × 280; Option A’s article detail becomes an empty rectangle.
- Meaningful disagreement: Option A is quieter, but that restraint removes the
  conversational specificity the user explicitly requested.

## Objective blockers

The in-app browser rejects agent access to the localhost demo under its network
policy. The generated image is therefore the comparative visual evidence for
this pass; runtime behavior is verified separately through automated UI tests
and activation of the packaged plugin in `wp-env`.

## Generated-art QA

- Verdict: `pass-with-notes`
- Composition: clear buddy-list/conversation relationship at native and
  thumbnail size.
- Identity: original SOL Inbound Monologue framing with no AOL/AIM identity or
  copied mascot.
- Prop/world logic: window chrome, roster density, transcript, and action shelf
  agree spatially.
- AI tells: the generated avatar and toolbar icons have uneven specificity, but
  they are explicitly excluded from production.
- Production: 1536 × 1024 RGB PNG retained only as a design artifact.

## Calibration record

- Human choice: make the implementation look more like an IM messenger.
- Human reason: the prior build was “pretty good” but not messenger-specific
  enough.
- Rejected reference: the earlier large article-card reader.
- Approved reference: messenger-first buddy identity, roster, transcript, and
  bottom action shelf.
- Agent recommendation: ship Option B’s grammar using only functional HTML/CSS
  controls.
- Override: no

## Easter-egg refinement

- Human choice: rename the product to “SOL Inbound Monologue,” with SOL
  explained as “Syndicated Open Links,” and lean into the joke that RSS is
  one-way.
- Decision: `ship with restraint`.
- Protected choice: keep the roster and transcript quiet; concentrate the joke
  in an About panel, short status lines, away state, and opt-in synthesized
  cues.
- Rejected direction: copying AOL/AIM recordings, marks, or filling every
  surface with parody controls.
