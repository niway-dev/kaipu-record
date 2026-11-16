/**
 * One place a transcribed word plays in the edited timeline (NIW2-818, ADR 0063). The projection
 * module produces these from the stored words and the edit; the panel and the SRT/VTT/TXT
 * exports only ever read them, so both show the same words at the same times.
 */
export interface WordOccurrence {
  /** The stored word's id. A repeated word has the same id on every occurrence. */
  wordId: string;
  text: string;
  /** Timeline position in seconds, the unit `LayoutEntry` uses. */
  start: number;
  end: number;
  /** The word in its recording's own time, integer ms, as stored in the transcript file. */
  sourceStartMs: number;
  sourceEndMs: number;
  /** The layout entry (clip) this occurrence plays in; changes at every cut or repeat. */
  clipId: string;
}
