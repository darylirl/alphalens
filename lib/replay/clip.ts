/**
 * NOTICE: Portions adapted from trickshot (https://github.com/nathanliow/trickshot)
 * Copyright (c) 2026 Nathan Liow — MIT License. (src/lib/clip.ts)
 * The WebCodecs-over-MediaRecorder choice, the codec negotiation and the
 * frame-by-frame encode loop come from there; the layout is AlphaLens's own.
 *
 * Turning a replay into a file people can post.
 *
 * Encoding is WebCodecs (via mediabunny) rather than MediaRecorder, and the
 * reason is timing: MediaRecorder stamps frames by the wall clock, so a
 * machine that cannot composite 1080p in 33ms produces a slower, jerkier
 * video. Here every frame is handed an explicit timestamp, so the file is the
 * same length and the same smoothness whatever the machine managed — and the
 * soundtrack is rendered offline onto the same timeline.
 */

import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
  type AudioCodec,
  type VideoCodec,
} from 'mediabunny'

import { CLIP_W, CLIP_H } from './clipspec'

export { CLIP_W, CLIP_H, FPS, OUTRO_SECONDS, MAX_CLIP_SECONDS } from './clipspec'

export interface Encoders {
  ext: 'mp4' | 'webm'
  mime: string
  video: VideoCodec
  audio: AudioCodec | null
}

/**
 * What this browser can actually encode. MP4 first because X does not accept
 * WebM. Firefox has VideoEncoder but no AAC, so it lands on WebM/VP9 and the
 * caller says so. Null means WebCodecs is missing entirely (older Safari) —
 * the caller falls back to the OG share image and says why.
 */
export async function negotiate(): Promise<Encoders | null> {
  if (typeof VideoEncoder === 'undefined') return null
  const size = { width: CLIP_W, height: CLIP_H }
  try {
    const avc = await getFirstEncodableVideoCodec(['avc'], size)
    if (avc) {
      const aac = await getFirstEncodableAudioCodec(['aac'], {
        numberOfChannels: 2,
        sampleRate: 48_000,
      })
      return { ext: 'mp4', mime: new Mp4OutputFormat().mimeType, video: avc, audio: aac }
    }
    const vp9 = await getFirstEncodableVideoCodec(['vp9', 'vp8'], size)
    if (!vp9) return null
    const opus = await getFirstEncodableAudioCodec(['opus'], {
      numberOfChannels: 2,
      sampleRate: 48_000,
    })
    return { ext: 'webm', mime: new WebMOutputFormat().mimeType, video: vp9, audio: opus }
  } catch {
    // A browser that throws while being asked cannot encode either.
    return null
  }
}

export interface EncodeOptions {
  encoders: Encoders
  frames: number
  fps: number
  /** The whole soundtrack, rendered ahead of time. Null for a silent clip. */
  audio: AudioBuffer | null
  /** Paint frame `i`. Runs to completion before the frame is encoded. */
  draw: (ctx: CanvasRenderingContext2D, i: number) => void
  /** Stop and keep nothing. */
  cancelled: () => boolean
  onProgress: (fraction: number) => void
}

export async function encode(o: EncodeOptions): Promise<{ blob: Blob; ext: string } | null> {
  const canvas = document.createElement('canvas')
  canvas.width = CLIP_W
  canvas.height = CLIP_H
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) return null

  const format =
    o.encoders.ext === 'mp4'
      ? // Index in front of the data so the clip starts playing before it has
        // finished downloading — X and iOS hold a blank preview otherwise.
        new Mp4OutputFormat({ fastStart: 'in-memory' })
      : new WebMOutputFormat()
  const target = new BufferTarget()
  const output = new Output({ format, target })

  const video = new CanvasSource(canvas, {
    codec: o.encoders.video,
    // Derived from the frame size rather than fixed — generous for the chart,
    // sane for 1080p.
    bitrate: Math.round(CLIP_W * CLIP_H * o.fps * 0.19),
    keyFrameInterval: 2,
  })
  output.addVideoTrack(video, { frameRate: o.fps })

  // No track at all rather than a silent one: a muxed-but-empty stream costs
  // bytes and gives some players a reason to stall on open.
  const audio =
    o.audio && o.encoders.audio
      ? new AudioBufferSource({ codec: o.encoders.audio, bitrate: 128_000 })
      : null
  if (audio) output.addAudioTrack(audio)

  await output.start()

  try {
    if (audio && o.audio) {
      await audio.add(o.audio)
      audio.close()
    }
    const dt = 1 / o.fps
    for (let i = 0; i < o.frames; i += 1) {
      if (o.cancelled()) {
        await output.cancel()
        return null
      }
      o.draw(ctx, i)
      // Awaited so the encoder's backpressure is respected rather than
      // queueing every frame of a 90-second clip at once.
      await video.add(i * dt, dt)
      if (i % o.fps === 0) o.onProgress(i / o.frames)
    }
    video.close()
  } catch (err) {
    if (output.state === 'started') await output.cancel()
    throw err
  }

  await output.finalize()
  const buffer = target.buffer
  if (!buffer) return null
  return { blob: new Blob([buffer], { type: format.mimeType }), ext: o.encoders.ext }
}
