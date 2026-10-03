# Riffado design system

Living record of design decisions for the 2026 redesign (web, iOS, Android).
Source of truth for visuals: Paper file `riffado` (pages: 01 Foundations, 02 Web app, 03 Mobile app).
Update this file in the same session a decision is made. If a rule here and a design disagree, fix one of them before moving on.

Last updated: 2026-10-02

---

## 1. Product principles

1. **Intuitive by default, powerful on demand.** The default path needs zero decisions. Power features (glossary, agents, API keys, webhooks) live one level deeper and never clutter the main flow.
2. **The app does the work, not the user.** Detect before asking. Example: the recorder is found automatically over Bluetooth; the model picker only appears as a fallback when nothing is found.
3. **Always show where data lives.** Every recording shows its location and state (phone, uploading, server, failed). Privacy is shown, not claimed.
4. **Failures explain themselves and offer the fix.** Never a bare "Error". State the reason in plain words and give the next action (Fix key, Try another provider). Stop retrying permanent failures.
5. **Everything is intentional.** Every element must earn its place by serving something the user reads, decides or does on that screen. Aesthetic elements are allowed when they support that (the dot waveform shows where you are in the audio; the device photo helps you recognise your recorder). If you can't name the reason, remove it. Ask for each element: what does the user do with this here, and how often?
6. **Teach once, apply everywhere.** Corrections and speaker names are learned from normal editing (Always fix this, voice match), not from separate settings pages.

## 2. Product decisions

| Decision | Detail |
|---|---|
| Agent-first platform | Every capability is an MCP tool and CLI command first, over the same API. Users bring their own agent (Claude, ChatGPT, Cursor, Hermes, ...). |
| In-app Ask stays, thin | Ask is a client of the same tools, not a separate agent runtime. Runs on the user's provider: own API key, local Ollama/LM Studio, or Sign in with ChatGPT. |
| Mynah is transcription only | Mynah = transcription model included in the Riffado subscription. Never show it as an option for Ask, summaries, titles or any LLM feature. |
| Direct recorder connection | Recorder -> phone over Bluetooth -> user's chosen home (Riffado Cloud, own server, or only this phone). No vendor cloud in between. |
| Three homes | Riffado Cloud, Your own server, Only this phone. Changeable anytime. |
| Recorder detection | Auto-detect first. "We couldn't find it yet" + model grid only as fallback, to show wake instructions. |
| Live recording | Uses the phone mic unless we confirm recorders can stream live. Label honestly ("This phone"). |
| Highlights | One feed of moments worth returning to: what you marked (Mark during live recording, or later in the transcript), decisions, to-dos, open questions, pulled from every recording. Each item: type, quote/statement, who said it, which recording, play-from-timestamp. Web: sidebar entry + page with a "Your to-dos" rail (only tasks assigned to you). Mobile: entry row in Library, no extra tab. Exposed to agents as an MCP tool. Reason: people rarely reread transcripts; they come back for what was decided and what they owe. |
| Agents & tools (Settings) | Web: pick your client (Claude, ChatGPT, Cursor, Terminal, Other), choose permission (Read / Read and act, never deletes), one-click add plus copyable config, list of connections with revoke, webhooks. Each connection has its own key. Mobile: approve sign-in requests from new agents (device-flow code shown on both screens) and manage/revoke connections. Setup itself happens on the computer, where the agent lives. |
| AI for Ask & summaries (Settings) | Three choices: Sign in with ChatGPT (uses the ChatGPT plan), your own API key, or a model on your server. Always state what gets sent (transcript text only, never audio, and to whom). Transcription is a separate setting; Mynah lives there only. |
| Ask | Thin client over the same tools agents use. Every claim carries a numbered citation; sources list recording + quote + play-from-timestamp. Scope selector (e.g. This week) and the model in use ("Answers with ChatGPT") are always visible in the composer, so the user knows what is searched and who answers. Mobile: Ask tab with a glass composer above the tab bar and history behind a clock button. Follow-up suggestions only after an answer, labelled "Ask next". |
| First run | Empty states teach the one next action and show only what is real: no folder/recorder/count chrome when there is nothing. Mobile: recorder photo + "Your first recording" + upload fallback. Web: "Get the app" (QR, pairs the recorder and signs in to this server) + "Upload audio". |
| Server is not home-screen content | People rarely switch servers. The server lives in You / Settings. It appears on the home screen only when something is wrong (unreachable, auth expired) as a banner that says what is safe and what happens next. Per-recording location ("Your server", "On this phone") stays on rows and detail. |

## 2a. Release scope

Goal: ship v1 as soon as possible. Rule: v1 = the core loop end to end (recorder -> phone -> your server -> transcript + summary -> read and listen) plus a reskin of features that already exist. Anything needing new backend work is post-v1. Artboards in Paper are prefixed `v1 ·` or `later ·`.

**v1 mobile:** Welcome, Allow Bluetooth (pre-permission, before the system prompt), Sign in (self-host, email + password, matches current auth), Create Riffado Cloud account, Choose a home (Riffado Cloud / Your own server), Connect server, Pair (auto-detect + not-found fallback), Transfer, Transfer interrupted (recorder out of range: paused, nothing lost, resumes), Library (processing states, unreachable banner, first run), Recording (Overview, Transcript with speaker labels, glass mini player), Recorders, You/Settings (not designed yet). Tab bar: Library, Recorders, You. You screen: profile, Server group (server, transcription, summaries; each opens details), On this phone (Upload on Wi-Fi only, Remove audio after upload), Sign out.

**v1 web:** Library (All / Untranscribed filters), Recording (Overview, Transcript, player, Share, download, rename), Processing states, First run, Settings: Account, Recorders, Server & storage, Transcription, AI for summaries (own API key or model on your server), API & webhooks, Export & backup. Sidebar: Search, Library, Recorders, account.

**Post-v1:** Ask (web + mobile), Highlights, marking moments, speaker naming + voice match, corrections glossary, folders, MCP/agent connections and phone approval, Sign in with ChatGPT (PR #321), phone-mic recording + live transcription, Photo/Note capture, "Only this phone" home (needs on-device transcription), summary styles, automations, share sheet, transcription language display.

Mobile stack: Expo (decided 2026-10-02). Glass via `expo-glass-effect` behind a single `GlassSurface` wrapper. Build tasks: `docs/design/v1-tasks.md` (local, not yet published as issues).

Decided 2026-10-02: Sign in with ChatGPT, phone-mic recording and "Only this phone" are all post-v1.

## 3. Color

Palette is fixed (existing brand). One accent.

| Token | Hex | Role |
|---|---|---|
| `--color-background` | `#FAF9F5` | Cream ground (light) |
| `--color-surface` | `#F5F4EE` | Sidebar, quiet surface |
| `--color-card` | `#FFFFFF` | Raised surface, reader |
| `--color-secondary` | `#E9E6DC` | Selected row, hover |
| `--color-border` | `#DAD9D4` | Hairlines |
| `--color-muted` | `#83827D` | Tertiary text, large or non-critical only |
| `--color-subtle` | `#535146` | Secondary text |
| `--color-foreground` | `#3D3929` | Body text |
| `--color-ink` | `#141413` | Headlines, primary buttons |
| `--color-night` / `-deep` / `-raised` | `#262624` / `#1A1915` / `#30302E` | Immersive dark (recording, pairing, transfer, player) |
| `--color-night-text` | `#C3C0B6` | Text on night |
| `--color-primary` | `#C96442` | Terracotta. The one accent. |
| `--color-primary-bright` | `#D97757` | Terracotta on night |
| `--color-led-active` | `#11AD32` | Connected, synced, ready |
| `--color-led-warning` | `#D9A514` | Working, waiting |

Rules:
- Terracotta marks one thing per view: the primary live/record action, the playhead, the active timestamp, or something that needs the user. Never decoration.
- Status uses LED colors as 7px dots, never as filled backgrounds.
- Switches "on" are ink, not terracotta (several toggles on one screen would spend the accent). Sign out is ink too; the selected tab already uses terracotta.
- Night surfaces are for immersive moments (recording, pairing, transfer, playback), not a general dark theme. Full dark mode is a separate, later task.

## 4. Type

| Role | Font | Spec |
|---|---|---|
| Display | Funnel Display 500 | 40-72px, tracking -0.04 to -0.045em, line-height ~1.0 |
| Title | Funnel Display 600 | 20-34px, tracking -0.02 to -0.03em |
| Reading | Funnel Sans 400 | 17-19px / 27-31px line-height |
| UI | Funnel Sans 400/500/600 | 13-16px |
| Signal | Doto 700-900, `font-variation-settings: 'ROND' 100` | Timers, counts, live numbers only |

Rules:
- Doto always uses round dots (`ROND 100`) so it matches the dot-matrix logo. Square Doto is not allowed.
- Doto is reserved for numbers that are alive (timers, progress, counts). Never for words or labels.
- Use `font-variant-numeric: tabular-nums` for durations and timestamps in Funnel Sans.
- Minimum text size 12px, and 12px only for metadata. Body on mobile >= 15px.
- Avoid overusing spaced em dashes in copy (repo rule).

## 5. Shape and corners

Follows Apple's practice: continuous corners and concentric radii.

**Continuous corners.** Every radius >= 6px uses `corner-shape: squircle`. Because a squircle reads tighter than a circular arc, the CSS radius is ~1.5x the Apple point value.

| Token | Value (squircle) | Use |
|---|---|---|
| `--radius-inner` | 12px | Icon tiles, thumbnails, fields inside cards |
| `--radius-control` | 15px | Buttons and inputs 44-54pt tall |
| `--radius-card` | 30px | Cards with 16pt padding |
| `--radius-sheet` | 56px | Floating sheets, concentric with the device corner |

**Concentricity.** A nested shape's radius = parent radius - padding between them (min ~8px). Do not use the same radius at every nesting level.

**When a full capsule (pill) is allowed** (keep the list short):
- System Liquid Glass controls on iOS 26: tab bar, toolbar button groups, floating bottom accessory (mini player). This is the native shape.
- Circular controls: play, record, avatars, status dots, icon-only glass buttons.
- Toggles/switches, progress dots, the NotePin device silhouette.

**Not pills:**
- Content buttons: rounded rectangle (`--radius-control`).
- Status: dot + text, no container.
- Speaker labels: avatar + name, no container.
- Timestamps, playback speed, metadata tags: plain text.
- Filters and segmented controls: small radius (8-12px), not capsules.

## 6. Liquid Glass (iOS 26)

Liquid Glass ships in iOS 26 (and iPadOS/macOS 26). iOS 17 and 18 do not have it.

- **Glass is for the navigation layer only**: tab bar, nav bar buttons, toolbars, floating mini player, floating sheets. Content (cards, lists, transcripts) is never glass.
- Content must scroll **behind** glass. Design screens so content visibly passes under the tab bar and toolbars.
- Tab bar: floating capsule inset 16pt from edges, 28pt from bottom; selected tab gets an inner tinted capsule and terracotta icon/label. Record is a separate tinted glass circle at the trailing end (like the iOS 26 search tab role).
- Nav bar items are 44pt glass circles or grouped glass capsules. Never bare 22px icons (tap target).
- Glass recipe in mockups (approximates the real material; production uses the system material):
  - Light: `rgba(255,255,255,0.56)` + `backdrop-filter: blur(24px) saturate(180%)` + 1px `rgba(255,255,255,0.8)` rim + soft shadow + inner top highlight.
  - Dark (on night): `rgba(58,58,55,0.5)` + same blur + 1px `rgba(255,255,255,0.14)` rim.
  - Tinted (record): terracotta at 88% with glass rim.
- **Fallback (iOS 17-18, Android):** same layout, standard blur material (`.regularMaterial` / Material 3 surface). No layout differences between versions.
- **Minimum iOS: 26 at launch** (decided 2026-10-02). Lowering it later is planned for and cheap if:
  - all glass goes through one wrapper component (e.g. `GlassSurface`) that renders the system material on 26 and the standard blur fallback below it;
  - no iOS 26-only API is called outside that wrapper without an availability check.
- The non-glass fallback must be designed anyway, because Android has no Liquid Glass. Same layout, standard material.

## 6a. Android (Material 3)

Paper page "03b — Android". Same layout, content, colors, type and dot language as iOS; platform chrome follows Material 3:
- Large top app bar (back arrow, overflow menu), 48dp icon buttons.
- Bottom navigation bar with a pill active indicator (terracotta wash) instead of the glass tab bar.
- Tabs with an underline indicator instead of a segmented control.
- Buttons use M3 shapes (full-round filled buttons are native here); player is a tonal surface with 28dp corners and a 16dp-radius play button. Circular corners, no squircle.
- Gesture bar instead of the home indicator; 412x915 frame.
- No Liquid Glass and no blur materials.

## 7. Layout and touch (mobile)

- Frame 390x844. Status bar at top (Paper guide markup), home indicator at bottom (134x5, 8pt from bottom).
- Screen margins 16-20pt. Minimum tap target 44x44pt.
- Primary action anchored at the bottom (thumb zone), full width, 54pt tall.
- Bottom content padding must clear the floating tab bar (~100pt) so the last item can scroll above it.

## 8. Components

- **Recording row:** status dot lane (fixed 8px) | title + duration | snippet | meta. Dot lane keeps vertical alignment across rows.
- **Status line (processing):** one line per row: state + plain-language detail + one action. States: On your phone, Uploading, Transcribing (with part progress), Failed (reason + fix), Ready.
- **Speaker:** avatar circle + name. Unknown speaker = terracotta name and "?" avatar, no dashed chip.
- **Voice match card:** suggestion + two buttons (confirm / someone else) + "voices stay on your server" note.
- **Correction popover:** wrong -> right field, Fix button, "Always fix this" switch with scope count ("Also corrects 23 past recordings").
- **Player:** night bar, terracotta play/pause circle, dot waveform (played = cream, rest = dim, playhead = terracotta). On iOS 26 the floating mini player is a glass capsule.
- **Transcript actions:** one entry point per platform, same verbs. Mobile: long-press a paragraph -> lifted paragraph + glass context menu (Mark as highlight, Play from here, Fix a word, Change speaker, Copy). Web: hover a paragraph -> small toolbar (Mark, Play, Copy); clicking a word opens the correction popover. Mark is always first and terracotta.
- **Sheets (iOS 26):** partial sheets float inset 8pt from the screen edges with `--radius-sheet`, light glass at ~94% so text stays readable over the scrim.
- **Device imagery:** real product photos from the "imports from figma" page, cropped to the device shape. Used for recognition (pairing, transfer, library card, recorders list, web sidebar).

## 9. Signature elements

- **Dot-matrix language** from the logo: dot waveforms, round Doto numerals, dot progress bars, dot radar on pairing. Keep dots round and on a grid.
- One immersive dark moment per flow (welcome, pairing, transfer, live recording).

## 10. Copy rules

- Plain words for non-technical users: "Your server", "Only this phone", "Uploads when you're on Wi-Fi".
- Vendor-agnostic marketing positioning (see AGENTS.md). Device names are factual only.
- Never claim compliance we don't own.
- Don't invent hardware specs (removed "4 mics"). Verify before stating.
- Device photos show Plaud branding: fine for in-app recognition; check licensing before marketing or store screenshots.

## 11. Mistakes log (don't repeat)

| Mistake | Rule now |
|---|---|
| Used pills for buttons, tags, status, timestamps, speed | Section 5: pills only for system glass and circular controls |
| Asked the user which recorder they own up front | Detect first, ask only on failure |
| Implied Mynah could power Ask/summaries | Mynah is transcription only |
| Square Doto dots clashed with the round logo | Always `ROND 100` |
| Bare 22px nav icons | 44pt glass buttons |
| Same radius at every nesting level | Concentric radii + squircle |
| Invented device specs in subtitles | Only verified facts |
| Tab bar content wider than the frame | Measure: tabs + gap + record <= frame - 2 x inset |
| Empty-state mockup cloned a populated sidebar (counts, folders, recorders) | Empty states must strip every populated element. |
| "Searched 3 recordings" while citing 2 | Copy must match the data shown on the same screen. |
| SVG dots with `fill-opacity` rendered black in Paper | Use `opacity` on SVG shapes in Paper mockups. |
| Promised "Transcription is included" at Cloud sign-up | Mynah depends on the plan; don't promise it before checkout. |
| Stated a hosting region for Mynah ("in the EU") without knowing it | Never state infrastructure facts we haven't verified. |
| "Import over Wi-Fi only" (import is Bluetooth; Wi-Fi is the upload) | Name settings after the step they actually control. |
| Inserted a new element inside a sibling chip instead of next to it, and judged the result from a cropped screenshot | Check the target's parent before inserting; screenshot the whole container after structural edits. |
| Used Doto for a pairing code with letters | Doto is for live numbers only; codes use Geist Mono. |
| Showed two overlays (hover toolbar + correction popover) in one mockup | One transient overlay per frame; show other states as separate artboards. |
| Server switcher in the Library header | Infrequent settings never sit on the home screen. Surface them only when they need attention. |
| "Your server" card in the web sidebar | Same rule as mobile: removed; banner only when something is wrong. |
| Removed "Highlights" because no feature existed yet | Wrong test. We are designing the product, so "doesn't exist yet" is not a reason to cut. Ask whether the user needs it and define what it is. An entry point must have a designed destination, so design the feature or drop it, but decide on user value. |
| "Recorders" nav item duplicating the sidebar Recorders section | One entry point per thing. |

## 12. Competitive reference

Paper page "04 — Reference: Plaud & Pocket" (App Store screenshots, pulled via the iTunes lookup API; marketing frames, not verified flows). Mobbin has neither app.

- **Take:** capture photo/note during recording pinned to the timeline; summary styles; plain-language automations (When/Then); one share/export sheet; visible transcription language; recording consent line near record (Notion, Manus, Fireflies).
- **Already stronger:** cited answers, real data location instead of badges, persistent speaker names, honest processing states.
- **Skip:** mind maps, compliance badges, template counts as a selling point, decorative stickers/gradients.
- Positioning rule still applies: these are references for our design, never comparison copy.

## 13. Paper workflow notes

- `x-paper-clone` of the device photos keeps the source's absolute `left/top`; set `position: relative; left: 0; top: 0` on the clone.
- `set_text_content` takes `{ updates: [{ nodeId, textContent }] }`.
- Screenshots can lag right after a write; re-screenshot before judging.
- Paper supports `backdrop-filter` and `corner-shape: squircle`.
