---
title: "Local transcription research 6: competitor transcript UX"
description: "Written by GPT-6.1 Sol via Codex, comparing competitor transcript and caption UX."
sidebar:
  order: 6
---

> Evidence, kept verbatim (2026-11-15, design of [NIW2-818](https://linear.app/niway/issue/NIW2-818/local-transcription-with-parakeet-transcript-panel-and-subtitle-export)). The [spec](/specs/2026-11-15-local-transcription-design/) wins where they disagree.

## Brief

is a claim, and it needs this search first:

1. Every branch and commit: `git fetch origin`, then
   `git log --all --oneline -S'<text>'`.
2. Open PRs: `gh pr list --search '<text>'` (account per the GitHub section).
3. Uncommitted work: `git status` and `git worktree list` in the repo.
4. T3 threads: `t3_thread_search`, then `t3_thread_read` every match before
   ruling it out. A match with the topic in its title is the place to look,
   not a duplicate of the current thread.

Only after all four come back empty, say what was searched and ask.

## GitHub account selection

Before repository-related GitHub CLI operations, read and follow
`~/GITHUB_ACCOUNTS.md` (resolve `~` to the current user's home directory).
It is the canonical SSH alias-to-GitHub-account mapping and PR workflow.
Do not assume the active `gh` account is correct for the current repository.

## Other machines

Before running anything on another of the owner's machines (M4, Mac mini), read
`~/AGENT_HOSTS.md`: which machines exist, how to reach them over SSH, and what
to bring back. Run the work there and return only the result.
<cwd>~/Documents/Workspace/Personal/kaipu-record-monorepo</cwd>
<shell>zsh</shell>
<current_date>2026-11-15</current_date>
<timezone>America/Lima</timezone>
<filesystem><workspace_roots><root>~/Documents/Workspace/Personal/kaipu-record-monorepo</root></workspace_roots><permission_profile type="disabled"><file_system type="unrestricted" /></permission_profile></filesystem>
Act as the research sub-agent for this task.

Research task, read-only. Do not edit any file. Answer in English.

Context: Kaipu Record is a desktop screen recorder with a video editor (timeline with clips, trims, cuts). Each recording has a microphone track and a system audio track. We plan local transcription (NVIDIA Parakeet) to show a transcript side panel in the editor and to produce subtitles. Before proposing UX we need to know how established products do it.

Research how these products handle transcripts and captions (cite docs/help-center/changelog URLs): Screen Studio, Descript, Loom, Cap (cap.so, open source — read its code/issues if useful), Tella, CapCut desktop, Camtasia, Riverside, Final Cut Pro transcription, Premiere Pro Text-Based Editing, DaVinci Resolve transcription/subtitles, MacWhisper, Kapwing.

For each, find: local vs cloud transcription; when it runs (automatically after recording, on demand, background); which audio it transcribes when there are multiple tracks (mic vs system audio, speaker labels/diarization); transcript panel interactions (click word to seek, highlight the currently spoken word, search, edit text to fix typos, delete text to cut video, filler-word removal); how the transcript stays in sync after timeline edits (trims, cuts, speed changes); caption features (on-video styled captions, burned-in vs soft subtitles, line length, word-by-word highlight); export formats (SRT, VTT, TXT, DOCX, JSON); language selection; cost/paywall placement.

Reply shape: 1) a 6–10 line synthesis of the common pattern and the notable differences; 2) a table product × (local?, trigger, multi-track, panel interactions, sync after edits, captions, exports); 3) 8–15 findings, each one sentence + URL; 4) which features look like table stakes vs differentiators for an MVP. Mark anything unverified. Keep under 1800 words.

## Report

I’ll check official documentation and Cap’s public implementation, and mark gaps explicitly—especially audio-track selection and synchronization after edits, which help pages often leave unspecified.
The clearest split is between transcripts that drive video edits and captions generated as separate timeline objects. Premiere explicitly recommends captioning after the edit; Tella uses one transcript for cuts and subtitles. Screen Studio also documents a relevant limitation: it transcribes microphone voiceover only.
**1. Synthesis**

Established products follow two patterns: transcripts that drive editing, and captions generated as timeline objects.  
Descript, Tella, Riverside and Premiere support editing video through text; Screen Studio concentrates on caption generation.  
Local transcription is established in desktop products; cloud sharing products usually process uploaded recordings.  
Automatic transcription after recording is common in sharing tools; desktop editors commonly expose an explicit Generate command.  
Audio selection varies materially: Screen Studio requires microphone audio, while Premiere exposes track selection.  
Correcting spelling and deleting footage are distinct operations in the stronger implementations.  
A synchronized transcript does **not** necessarily mean captions automatically survive subsequent timeline edits.  
Styled burned-in captions plus a separate SRT file are the clearest shared export baseline.

**2. Product comparison**

Checked November 2026 against public sources; no hands-on testing. **U = unverified**, not unsupported. “Sync” describes documented behavior, not an inferred guarantee. Export lists contain verified formats only.

| Product                                                                                                                                           | Local? / trigger                                                                                            | Multiple audio tracks                                                                                            | Transcript interactions                                                              | Sync after edits                                                                                     | Captions                                                              | Exports                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------- |
| [Screen Studio](https://screen.studio/guide/captions)                                                                                             | Local Whisper or Apple Speech; on demand                                                                    | **Microphone voiceover only**; unavailable without mic recording; diarization U                                  | Correct typos; navigation, search, text cuts U                                       | Trims/cuts/speed behavior U                                                                          | Preview captions; size control; detailed styling/word highlight U     | Separate transcript file; format U                |
| [Descript](https://help.descript.com/getting-started/get-started-with-descript)                                                                   | Cloud workflow; import/recording transcription; processing locality not explicitly verified here            | Multitrack sequences and speaker labels; mic/system selection U                                                  | Text cuts, corrections, filler removal; exact playback highlighting U                | Text edits drive media; corrections trigger realignment; speed edge cases U                          | Styled captions; separate subtitle export; maximum characters/line    | SRT, VTT, TXT, DOCX, HTML, MD, RTF                |
| [Loom](https://support.atlassian.com/loom/docs/loom-video-transcription-and-closed-captions/)                                                     | Cloud; automatic after recording/upload                                                                     | Mic/system selection and diarization U                                                                           | Transcript correction; broader text editing available; word-level behavior U         | Corrections update CC; cut/speed synchronization U                                                   | Toggleable player CC; paid stylized captions                          | SRT; other formats U                              |
| [Cap](https://cap.so/docs/recording/studio-mode)                                                                                                  | **Studio: local**, on demand; one-time model download                                                       | “Project audio”; precise mic/system mixing and diarization U                                                     | Segment text/timing correction; deleting text differs from explicit **Cut video**    | Exports edited-timeline captions; arbitrary trim/speed behavior U                                    | Burned-in; presets, active-word highlight, animation                  | SRT, VTT                                          |
| [Tella](https://www.tella.com/features/automated-subtitles)                                                                                       | Automatic when recording finishes; cloud processing inferred, locality U                                    | Mic/system selection and diarization U                                                                           | Script deletion cuts video; find/replace; Auto Cut removes fillers, silence, retakes | Subtitles follow transcript edits; speed behavior U                                                  | Player CC, burned-in; active-word/single-word styles; lines control   | SRT; translated tracks also VTT                   |
| [CapCut desktop](https://www.capcut.com/help/how-to-recognise-subtitles)                                                                          | On-demand Generate; locality U                                                                              | Audio-source selector; speaker detection varies by region/version                                                | Caption text/timing/style editing; transcript navigation/text cuts U                 | Separate timeline captions; automatic propagation through edits U                                    | Fonts/animation; precise word-highlight and line controls U           | SRT, TXT                                          |
| [Camtasia](https://support.techsmith.com/hc/en-us/articles/26713588518413-Dynamic-Captions-Best-Practices)                                        | Editor transcription local; on-demand dynamic captions                                                      | Dynamic captions show **topmost transcribed media**; diarization U                                               | Caption correction; text cuts/audio cleanup through Audiate                          | Dynamic transcript belongs to source; Audiate offers all-track synchronization                       | Burned-in dynamic captions; separate closed-caption workflow          | SRT; VTT supported in current Mac version         |
| [Riverside](https://support.riverside.com/hc/en-us/articles/5262262435485-Download-transcript-of-full-recording)                                  | Cloud workflow after upload/processing; automatic                                                           | Participant tracks/speaker labels; **recording transcript excludes screen-share audio and Media Board playback** | Search, correct/all, delete text to cut; exact word-follow behavior U                | Edited transcript reflects cuts; corrections propagate; speed U                                      | Styled/animated burned-in captions; SRT line/character limits         | TXT, SRT                                          |
| [Final Cut Pro](https://support.apple.com/en-gb/guide/final-cut-pro/vere399dab5e/mac)                                                             | On-device model; selected clips, on demand                                                                  | Selected clips; overlapping dialogue can reduce accuracy; diarization U                                          | Caption editor/index; general transcript-driven video cutting U                      | Connected captions move/delete with clips; Apple warns later dialogue edits can desynchronize        | Closed captions plus styled subtitle titles, including word highlight | SRT, iTT, CEA-608 caption workflow                |
| [Premiere Pro](https://helpx.adobe.com/in/premiere/desktop/edit-projects/edit-video-using-text-based-editing/overview-of-text-based-editing.html) | Downloaded language packs; automatic import or on demand; offline execution not independently verified here | Dialogue-tagged audio or specific track; optional speaker labels                                                 | Navigate/search, correct/replace, cut/rearrange text, bulk filler deletion           | **Dynamic sequence transcript**; captions are separate—generate after editing; speed edge cases U    | Styled burned-in, sidecar or embedded; caption track editing          | TXT, CSV, native transcript; SRT captions         |
| [DaVinci Resolve](https://documents.blackmagicdesign.com/SupportNotes/DaVinci_Resolve_19_New_Features_Guide.pdf)                                  | Local engine; on-demand transcription; offline model installation documented                                | Speaker detection/renaming; exact channel/mic-system routing U                                                   | Text-based editing and speaker management; exact seek/search/filler behavior U       | Transcript/timeline workflow exists; detailed cut/retime guarantees U                                | Subtitle tracks; Studio animated word-highlight templates             | Exact current transcript/subtitle export matrix U |
| [MacWhisper](https://apps.apple.com/us/app/whisper-transcription/id1668083311?platform=mac)                                                       | Local **or optional cloud**; import, recording, watched-folder automation                                   | Separate podcast files; local supported speaker identification; app/system audio recording                       | Search, corrections, text cleanup; video cutting U                                   | Transcript workspace rather than established multitrack video timeline; external-edit resync U       | Subtitle files and inline video playback; burned-in styling U         | SRT, VTT, TXT, DOCX, JSON, CSV, MD, PDF, HTML     |
| [Kapwing](https://www.kapwing.com/help/add-captions/)                                                                                             | Cloud web workflow; on-demand Generate                                                                      | Select timeline assets; speaker labels; overlapping-track handling U                                             | Transcript correction; text-driven trimming/filler removal advertised                | Smart subtitles follow moved/deleted video; converting to ordinary text loses this behavior; speed U | Burned-in, active-word animation, characters-per-subtitle control     | SRT, VTT, TXT                                     |

**Language and paywalls:** Screen Studio and Cap offer automatic detection or explicit language selection; their caption-specific paywalls are U. Descript meters transcription/media usage, but exact current allowances are U. Loom provides transcription across plans, while SRT downloads and stylized captions require eligible paid plans. Tella documents 99 languages, SRT/burn-in across plans, and paid translations. CapCut requires language selection; current region-specific limits/paywalls are U. Camtasia supports multiple languages; Audiate entitlement is separate and U here. Riverside supports 100+ languages, but full-recording transcript downloads require eligible paid plans. Final Cut’s automatic generation is documented as **U.S. English, Apple silicon**. Premiere includes text editing in its subscription. Resolve’s AI animated subtitles require Studio. MacWhisper offers free/paid capabilities and optional provider costs; Kapwing meters transcription and gates SRT export. Sources below support these distinctions.

**3. Findings worth carrying forward**

1. Screen Studio explicitly excludes system-audio-only recordings from caption generation, making its microphone restriction an especially relevant competitive gap for Kaipu ([caption guide](https://screen.studio/guide/captions)).
2. Cap already offers local Parakeet/Whisper transcription, active-word styling, explicit video cuts and edited-timeline SRT/VTT export, so local processing alone is not a unique proposition ([Studio documentation](https://cap.so/docs/recording/studio-mode)).
3. Tella separates a verbatim editing transcript from subtitles that filter fillers, despite deriving both from the same underlying transcript ([transcription and captions](https://www.tella.com/features/automated-subtitles)).
4. Descript distinguishes correction from media editing and reanalyzes alignment after text corrections ([correct your transcript](https://help.descript.com/hc/en-us/articles/23054692507661-Unable-to-toggle-capitalization-or-punctuation-on-Windows)).
5. Descript exposes maximum characters per line when exporting subtitles rather than assuming the on-video caption layout should determine the sidecar layout ([subtitle export](https://help.descript.com/export-and-share/subtitles)).
6. Loom makes transcript correction update CC automatically, while charging for eligible SRT downloads and stylized captions ([Loom transcription](https://support.atlassian.com/loom/docs/loom-video-transcription-and-closed-captions/)).
7. Riverside distinguishes the full recording transcript from the edited transcript and explicitly excludes screen-share audio from the former ([full transcript download](https://support.riverside.com/hc/en-us/articles/5262262435485-Download-transcript-of-full-recording)).
8. Riverside lets SRT exports control characters per line, lines per card and filler inclusion, while excluding visual styling from SRT ([transcription formats](https://support.riverside.com/hc/en-us/articles/7748677293981-About-Transcription-formats)).
9. Camtasia stores dynamic-caption corrections against source media so repeated timeline instances reuse them, but displays only the topmost transcribed media ([dynamic-caption behavior](https://support.techsmith.com/hc/en-us/articles/26713588518413-Dynamic-Captions-Best-Practices)).
10. Final Cut connects captions to source clips yet still recommends finishing dialogue edits before captioning because later changes can break synchronization ([caption creation](https://support.apple.com/en-gb/guide/final-cut-pro/vere399dab5e/mac)).
11. Premiere dynamically synchronizes sequence transcripts but explicitly separates caption generation from Text-Based Editing ([editing overview](https://helpx.adobe.com/in/premiere/desktop/edit-projects/edit-video-using-text-based-editing/overview-of-text-based-editing.html)).
12. Resolve’s animated subtitle templates use transcription timing to highlight spoken words and require Studio ([Resolve 20 guide](https://documents.blackmagicdesign.com/SupportNotes/DaVinci_Resolve_20_New_Features_Guide.pdf)).
13. MacWhisper explicitly distinguishes local transcription/speaker identification from user-selected cloud services and exports structured JSON ([official App Store listing](https://apps.apple.com/us/app/whisper-transcription/id1668083311?platform=mac)).
14. Kapwing warns that converting smart subtitles into ordinary text removes their ability to follow video deletions and moves ([caption help](https://www.kapwing.com/help/add-captions/)).

**4. MVP implications — judgment based on this comparison**

**Table stakes:** editable transcript; seek from text; playback-follow indication; search; clear separation between “correct text” and “cut footage”; language selection; readable styled captions; SRT export; reliable synchronization through ordinary trims/cuts; undo.

**Strong Kaipu differentiators:** explicit **microphone / system / both** selection; separate source labels without pretending they are speaker identities; accurate handling of overlapping sources; local processing with visible progress; preservation of corrections across repeated clips; documented synchronization through speed changes.

**Defer unless central to the launch:** diarization, translation, bulk filler removal, text-driven rearrangement, elaborate karaoke animations, DOCX and public JSON export.

The largest unresolved research gap is **retiming**: the reviewed documentation rarely guarantees word timestamps, transcript selection and caption timing after speed changes; verify that behavior directly before using competitors as a specification.
