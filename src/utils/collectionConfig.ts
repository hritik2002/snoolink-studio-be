import {
  CollectionKind,
  CollectionProcessingConfig,
  DEFAULT_ENTITY_SETTINGS,
  DEFAULT_FACE_ANALYSIS_SETTINGS,
  DEFAULT_MEDIA_DESCRIPTIONS_SETTINGS,
  DEFAULT_SEGMENTATION,
  EntitySettings,
  FaceAnalysisSettings,
  MediaDescriptionsSettings,
  SegmentationConfig,
} from "../types/collectionProcessing";

const VALID_TYPES: CollectionKind[] = [
  "media_descriptions",
  "entities",
  "face_analysis",
];

export function normalizeCollectionKind(value?: string | null): CollectionKind {
  if (value && VALID_TYPES.includes(value as CollectionKind)) {
    return value as CollectionKind;
  }
  return "media_descriptions";
}

function normalizeSegmentation(raw: unknown): SegmentationConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const segmentDurationSeconds = Number(obj.segmentDurationSeconds);
  const overlapSeconds = Number(obj.overlapSeconds);
  if (!Number.isFinite(segmentDurationSeconds) || segmentDurationSeconds <= 0) {
    return null;
  }
  return {
    segmentDurationSeconds,
    overlapSeconds: Number.isFinite(overlapSeconds) && overlapSeconds >= 0
      ? overlapSeconds
      : DEFAULT_SEGMENTATION.overlapSeconds,
  };
}

function normalizeMediaSettings(raw: Record<string, unknown>): MediaDescriptionsSettings {
  return {
    enableSpeech: raw.enableSpeech !== false,
    enableVisualSceneDescription: raw.enableVisualSceneDescription !== false,
    enableSceneText: raw.enableSceneText !== false,
    enableAudioDescription: raw.enableAudioDescription === true,
    enableSummary: raw.enableSummary !== false,
  };
}

function normalizeEntitySettings(raw: Record<string, unknown>): EntitySettings {
  return {
    prompt: typeof raw.prompt === "string" ? raw.prompt : DEFAULT_ENTITY_SETTINGS.prompt,
    schema: typeof raw.schema === "string" ? raw.schema : DEFAULT_ENTITY_SETTINGS.schema,
    enableVideoLevelEntities: raw.enableVideoLevelEntities === true,
    enableSegmentLevelEntities: raw.enableSegmentLevelEntities !== false,
    enableTranscriptMode: raw.enableTranscriptMode === true,
  };
}

function normalizeFaceSettings(raw: Record<string, unknown>): FaceAnalysisSettings {
  const fps = Number(raw.framesPerSecond);
  const maxWidth = Number(raw.maxWidth);
  return {
    framesPerSecond: Number.isFinite(fps) && fps > 0 ? fps : DEFAULT_FACE_ANALYSIS_SETTINGS.framesPerSecond,
    maxWidth: Number.isFinite(maxWidth) && maxWidth > 0 ? maxWidth : DEFAULT_FACE_ANALYSIS_SETTINGS.maxWidth,
    enableFrameThumbnails: raw.enableFrameThumbnails !== false,
  };
}

export function buildCollectionProcessingConfig(input: {
  collectionType?: string | null;
  settings?: unknown;
  segmentationConfig?: unknown;
  ingestionPrompt?: string;
}): CollectionProcessingConfig {
  const collectionType = normalizeCollectionKind(input.collectionType);
  const rawSettings =
    input.settings && typeof input.settings === "object"
      ? (input.settings as Record<string, unknown>)
      : {};

  let settings: CollectionProcessingConfig["settings"];
  switch (collectionType) {
    case "entities":
      settings = normalizeEntitySettings(rawSettings);
      break;
    case "face_analysis":
      settings = normalizeFaceSettings(rawSettings);
      break;
    default:
      settings = normalizeMediaSettings(rawSettings);
      break;
  }

  return {
    collectionType,
    settings,
    segmentation: normalizeSegmentation(input.segmentationConfig),
    ingestionPrompt: input.ingestionPrompt,
  };
}

export function getEffectiveSegmentation(
  config: CollectionProcessingConfig
): SegmentationConfig {
  if (config.segmentation) return config.segmentation;
  if (config.collectionType === "face_analysis") {
    const face = config.settings as FaceAnalysisSettings;
    const interval = Math.max(1, Math.round(1 / face.framesPerSecond));
    return { segmentDurationSeconds: interval, overlapSeconds: 0 };
  }
  return DEFAULT_SEGMENTATION;
}
