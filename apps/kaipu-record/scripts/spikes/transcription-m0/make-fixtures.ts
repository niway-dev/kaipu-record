/**
 * Builds the synthetic fixtures M0 uses where the true words must be known exactly (a real
 * recording has no answer key). macOS only: it needs `say` and `ffmpeg`.
 *
 *   bun make-fixtures.ts <outDir> <proseFile...>
 *
 * Writes into <outDir>:
 *   passage-en.wav / passage-en.truth.json   English prose read by Samantha, as one continuous
 *                                            take (the segmenter's worst case: few pauses).
 *   passage-es.wav / passage-es.truth.json   A Spanish passage read by Paulina.
 *   timing-en.wav / timing-es.wav            Single words separated by 350 ms of silence, with
 *                                            `*.marks.json` holding each word's true start and
 *                                            end (the spec said hand-marked words; marks by
 *                                            construction are exact and need no ear).
 *
 * The prose files are cleaned first: anything with a digit, a slash or an underscore is dropped,
 * because the voice would read it differently from how it is written.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SAMPLE_RATE, readWav, writeWav } from "./audio";

const [outDir, ...proseFiles] = process.argv.slice(2);
if (!outDir || proseFiles.length === 0) {
  console.error("usage: bun make-fixtures.ts <outDir> <proseFile...>");
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

function sh(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}: ${r.stderr}`);
}

function cleanProse(raw: string): string {
  return raw
    .replace(/^---[\s\S]*?---/m, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[|#*`>_~-]+/g, " ")
    .split(/\s+/)
    .filter((w) => /^[A-Za-z][A-Za-z']*[.,;:!?]?$/.test(w))
    .join(" ");
}

function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

const spanish = `Hoy vamos a revisar cómo funciona la transcripción local de una grabación. \
Primero, el programa convierte el audio a un formato sencillo. Después, lo divide en trozos \
pequeños, y cada trozo se reconoce por separado. Al final, las palabras se juntan en el orden \
correcto, sin repetir ninguna y sin perder las que quedan en el borde de dos trozos. \
Cuando alguien corta un pedazo del video, esas palabras desaparecen del texto. \
Si un fragmento se repite, sus palabras aparecen una vez por cada repetición. \
El modelo se descarga una sola vez, y después todo funciona sin conexión a internet. \
Esto es importante para quienes graban reuniones privadas y no quieren enviar su voz a ningún servidor. \
La grabación más larga que probamos dura casi una hora, y el editor sigue respondiendo mientras tanto. \
Si algo falla, el panel lo dice con claridad y no se cierra la aplicación. \
Los subtítulos se exportan en tres formatos, y cada uno respeta los cortes que hizo la persona. \
Eso es todo por hoy, gracias por escuchar hasta el final.`;

const englishWords = wordsOf(cleanProse(proseFiles.map((f) => readFileSync(f, "utf8")).join("\n")));
const english = englishWords.slice(0, 900).join(" ");

const scratch = mkdtempSync(join(tmpdir(), "niw2-818-fixtures-"));
try {
  function speak(voice: string, text: string, wav: string, rate = 175): void {
    const aiff = join(scratch, "t.aiff");
    const textFile = join(scratch, "t.txt");
    writeFileSync(textFile, text);
    sh("say", ["-v", voice, "-r", String(rate), "-f", textFile, "-o", aiff]);
    sh("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-i",
      aiff,
      "-ac",
      "1",
      "-ar",
      String(SAMPLE_RATE),
      "-c:a",
      "pcm_s16le",
      wav,
    ]);
  }

  speak("Samantha", english, join(outDir, "passage-en.wav"));
  writeFileSync(join(outDir, "passage-en.truth.json"), JSON.stringify(wordsOf(english)));
  speak("Paulina", spanish, join(outDir, "passage-es.wav"));
  writeFileSync(join(outDir, "passage-es.truth.json"), JSON.stringify(wordsOf(spanish)));

  // Timing fixtures: one word per `say` call, voiced span measured from the samples.
  const timingWords: Record<string, { voice: string; words: string[] }> = {
    en: {
      voice: "Samantha",
      words:
        "recording transcript today meeting editor microphone export subtitle speaker library screen window cursor camera playback timeline project button folder search model download network private audio video minute second sentence paragraph caption".split(
          " ",
        ),
    },
    es: {
      voice: "Paulina",
      words:
        "grabación transcripción hoy reunión editor micrófono exportar subtítulo hablante biblioteca pantalla ventana cursor cámara reproducción línea proyecto botón carpeta búsqueda modelo descarga conexión privado audio video minuto segundo oración párrafo".split(
          " ",
        ),
    },
  };
  for (const [lang, { voice, words }] of Object.entries(timingWords)) {
    const gap = new Int16Array(Math.round(SAMPLE_RATE * 0.35));
    const parts: Int16Array[] = [gap];
    const marks: { text: string; startMs: number; endMs: number }[] = [];
    let cursor = gap.length;
    for (const word of words) {
      const wav = join(scratch, "w.wav");
      speak(voice, word, wav, 150);
      const pcm = readWav(wav);
      // Trim leading and trailing near-silence so the marks are the voiced span.
      const threshold = 300;
      let a = 0;
      let b = pcm.length - 1;
      while (a < b && Math.abs(pcm[a]!) < threshold) a++;
      while (b > a && Math.abs(pcm[b]!) < threshold) b--;
      const voiced = pcm.subarray(a, b + 1);
      marks.push({
        text: word,
        startMs: Math.round((cursor / SAMPLE_RATE) * 1000),
        endMs: Math.round(((cursor + voiced.length) / SAMPLE_RATE) * 1000),
      });
      parts.push(voiced, gap);
      cursor += voiced.length + gap.length;
    }
    const all = new Int16Array(cursor);
    let at = 0;
    for (const p of parts) {
      all.set(p, at);
      at += p.length;
    }
    writeWav(join(outDir, `timing-${lang}.wav`), all);
    writeFileSync(join(outDir, `timing-${lang}.marks.json`), JSON.stringify(marks));
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log(`fixtures written to ${outDir}`);
