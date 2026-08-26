// Clip export constants, dependency-free so the player and the frame painter
// can import them without pulling the encoder (mediabunny) into the initial
// page bundle — the encoder itself is dynamically imported on export.

export const CLIP_W = 1920
export const CLIP_H = 1080
export const FPS = 30
/** The episode title card that opens a clip, in seconds. */
export const INTRO_SECONDS = 2
/** The end card, in seconds. */
export const OUTRO_SECONDS = 3
/**
 * How long a clip may run. Not a preference — a limit: the whole file is
 * muxed in memory (fastStart moves the index to the front), so the ceiling
 * is roughly bitrate × duration in one ArrayBuffer.
 */
export const MAX_CLIP_SECONDS = 90
