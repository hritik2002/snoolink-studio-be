export type CollectionKind = "media_descriptions" | "entities" | "face_analysis";

export interface MediaDescriptionsSettings {
  enableSpeech: boolean;
  enableVisualSceneDescription: boolean;
  enableSceneText: boolean;
  enableAudioDescription: boolean;
  enableSummary: boolean;
}

export interface EntitySettings {
  prompt: string;
  schema: string;
  enableVideoLevelEntities: boolean;
  enableSegmentLevelEntities: boolean;
  enableTranscriptMode: boolean;
}

export interface FaceAnalysisSettings {
  framesPerSecond: number;
  maxWidth: number;
  enableFrameThumbnails: boolean;
}

export interface SegmentationConfig {
  segmentDurationSeconds: number;
  overlapSeconds: number;
}

export interface CollectionProcessingConfig {
  collectionType: CollectionKind;
  settings: MediaDescriptionsSettings | EntitySettings | FaceAnalysisSettings;
  segmentation: SegmentationConfig | null;
  ingestionPrompt?: string;
}

export const DEFAULT_MEDIA_DESCRIPTIONS_SETTINGS: MediaDescriptionsSettings = {
  enableSpeech: true,
  enableVisualSceneDescription: true,
  enableSceneText: true,
  enableAudioDescription: false,
  enableSummary: true,
};

export const DEFAULT_ENTITY_SETTINGS: EntitySettings = {
  prompt: "",
  schema: "{}",
  enableVideoLevelEntities: false,
  enableSegmentLevelEntities: true,
  enableTranscriptMode: false,
};

export const DEFAULT_FACE_ANALYSIS_SETTINGS: FaceAnalysisSettings = {
  framesPerSecond: 1,
  maxWidth: 1024,
  enableFrameThumbnails: true,
};

export const DEFAULT_SEGMENTATION: SegmentationConfig = {
  segmentDurationSeconds: 30,
  overlapSeconds: 2,
};
