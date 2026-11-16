/**
 * Speech model catalog (ADR 0062, decision 4).
 *
 * Each entry pins a source revision and the size and SHA-256 of every file, so the download
 * service can verify the exact bytes and the engine loads only a complete directory. URLs, sizes
 * and hashes were taken from the bytes already shipped in another app and confirmed against the
 * Hugging Face headers (content-length and the LFS sha256 etag) on 2026-11-15; tokens.txt is not
 * an LFS file, so its hash comes from the local bytes only. A bump is a deliberate change here.
 */

export interface ModelFile {
  name: string;
  url: string;
  /** Lowercase hex SHA-256 of the file. */
  sha256: string;
  sizeBytes: number;
}

export interface ModelLicense {
  name: string;
  /** The credit shown in the download prompt and the third-party notices. */
  attribution: string;
  url: string;
}

export interface ModelCatalogEntry {
  id: string;
  label: string;
  /** ISO 639-1 codes the model recognises. */
  languages: readonly string[];
  /** Sum of every file's size: what the download prompt shows. */
  sizeBytes: number;
  files: readonly ModelFile[];
  /** The source revision (commit) every URL points at. */
  revision: string;
  license: ModelLicense;
  capabilities: { wordTimestamps: boolean };
  engine: "sherpa-onnx-transducer";
}

const CC_BY_4_URL = "https://creativecommons.org/licenses/by/4.0/";

function huggingFaceUrl(repository: string, revision: string, name: string): string {
  return `https://huggingface.co/${repository}/resolve/${revision}/${name}`;
}

const V3_REPOSITORY = "csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8";
const V3_REVISION = "2bda32ec70b097a55adaa07d9a7173915b43cc78";

const V2_REPOSITORY = "csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8";
const V2_REVISION = "1ab9323565ddb038682214b292f588070a538ce2";

const PARAKEET_V3: ModelCatalogEntry = {
  id: "parakeet-tdt-0.6b-v3-int8",
  label: "Parakeet TDT 0.6B v3 (int8, 25 European languages)",
  languages: [
    "bg",
    "hr",
    "cs",
    "da",
    "nl",
    "en",
    "et",
    "fi",
    "fr",
    "de",
    "el",
    "hu",
    "it",
    "lv",
    "lt",
    "mt",
    "pl",
    "pt",
    "ro",
    "sk",
    "sl",
    "es",
    "sv",
    "ru",
    "uk",
  ],
  sizeBytes: 670_478_772,
  revision: V3_REVISION,
  files: [
    {
      name: "encoder.int8.onnx",
      url: huggingFaceUrl(V3_REPOSITORY, V3_REVISION, "encoder.int8.onnx"),
      sha256: "acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247",
      sizeBytes: 652_184_281,
    },
    {
      name: "decoder.int8.onnx",
      url: huggingFaceUrl(V3_REPOSITORY, V3_REVISION, "decoder.int8.onnx"),
      sha256: "179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e",
      sizeBytes: 11_845_275,
    },
    {
      name: "joiner.int8.onnx",
      url: huggingFaceUrl(V3_REPOSITORY, V3_REVISION, "joiner.int8.onnx"),
      sha256: "3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3",
      sizeBytes: 6_355_277,
    },
    {
      name: "tokens.txt",
      url: huggingFaceUrl(V3_REPOSITORY, V3_REVISION, "tokens.txt"),
      sha256: "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d",
      sizeBytes: 93_939,
    },
  ],
  license: {
    name: "CC-BY-4.0",
    attribution:
      "Speech recognition: NVIDIA Parakeet TDT 0.6B v3 (CC-BY-4.0). Weights by NVIDIA, int8 ONNX conversion by the sherpa-onnx community.",
    url: CC_BY_4_URL,
  },
  capabilities: { wordTimestamps: true },
  engine: "sherpa-onnx-transducer",
};

const PARAKEET_V2: ModelCatalogEntry = {
  id: "parakeet-tdt-0.6b-v2-int8",
  label: "Parakeet TDT 0.6B v2 (int8, English)",
  languages: ["en"],
  sizeBytes: 661_190_513,
  revision: V2_REVISION,
  files: [
    {
      name: "encoder.int8.onnx",
      url: huggingFaceUrl(V2_REPOSITORY, V2_REVISION, "encoder.int8.onnx"),
      sha256: "a32b12d17bbbc309d0686fbbcc2987b5e9b8333a7da83fa6b089f0a2acd651ab",
      sizeBytes: 652_184_296,
    },
    {
      name: "decoder.int8.onnx",
      url: huggingFaceUrl(V2_REPOSITORY, V2_REVISION, "decoder.int8.onnx"),
      sha256: "b6bb64963457237b900e496ee9994b59294526439fbcc1fecf705b31a15c6b4e",
      sizeBytes: 7_257_753,
    },
    {
      name: "joiner.int8.onnx",
      url: huggingFaceUrl(V2_REPOSITORY, V2_REVISION, "joiner.int8.onnx"),
      sha256: "7946164367946e7f9f29a122407c3252b680dbae9a51343eb2488d057c3c43d2",
      sizeBytes: 1_739_080,
    },
    {
      name: "tokens.txt",
      url: huggingFaceUrl(V2_REPOSITORY, V2_REVISION, "tokens.txt"),
      sha256: "ec182b70dd42113aff6c5372c75cac58c952443eb22322f57bbd7f53977d497d",
      sizeBytes: 9_384,
    },
  ],
  license: {
    name: "CC-BY-4.0",
    attribution:
      "Speech recognition: NVIDIA Parakeet TDT 0.6B v2 (CC-BY-4.0). Weights by NVIDIA, int8 ONNX conversion by the sherpa-onnx community.",
    url: CC_BY_4_URL,
  },
  capabilities: { wordTimestamps: true },
  engine: "sherpa-onnx-transducer",
};

const CATALOG: readonly ModelCatalogEntry[] = [PARAKEET_V3, PARAKEET_V2];

export const DEFAULT_MODEL_ID = PARAKEET_V3.id;

export function listModels(): readonly ModelCatalogEntry[] {
  return CATALOG;
}

export function getModel(id: string): ModelCatalogEntry | undefined {
  return CATALOG.find((model) => model.id === id);
}
