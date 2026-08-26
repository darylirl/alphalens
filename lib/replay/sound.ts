/**
 * NOTICE: Portions adapted from trickshot (https://github.com/nathanliow/trickshot)
 * Copyright (c) 2026 Nathan Liow — MIT License.
 * The live-context / offline-render split and the cue-scheduling approach come
 * from their src/lib/sound.ts; the cues themselves are synthesized here rather
 * than decoded from audio files.
 *
 * Sound for the replay.
 *
 * Through Web Audio rather than <audio> elements for two reasons. Several
 * fills can land in the same second and each needs its own voice, which one
 * element cannot give — it would cut itself off. And an export needs the same
 * cues rendered offline onto its own timeline, which only an audio graph can do.
 *
 * Three cues, all synthesized (no assets, identical on every install):
 * - entry: a short neutral blip — a position opened or grew.
 * - win:   a two-note rise — a close that realized a profit.
 * - loss:  a low falling tone — a close that realized a loss.
 *
 * Deliberately restrained: this is a research product. Everything here fails
 * quietly — a browser that refuses to start audio costs the sound and nothing
 * else. Playback defaults to muted; `prepare()` is called on the unmute
 * gesture because browsers will not start an AudioContext without one.
 */

export type Cue = 'entry' | 'win' | 'loss'

let ctx: AudioContext | null = null
let master: GainNode | null = null

const MASTER_GAIN = 0.5

function context(): AudioContext | null {
  if (ctx) return ctx
  try {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.gain.value = MASTER_GAIN
    master.connect(ctx.destination)
    return ctx
  } catch {
    return null
  }
}

/** Start (or resume) the live context. Call from a user gesture. */
export function prepare(): void {
  const audio = context()
  if (audio && audio.state === 'suspended') void audio.resume()
}

/**
 * Schedule one cue's oscillators into any context at time `t`.
 *
 * One function serves the live context and the offline one, so an exported
 * clip cannot sound different from the page — it is the same instruction.
 */
function schedule(audio: BaseAudioContext, out: AudioNode, cue: Cue, t: number): void {
  const voice = (
    freqFrom: number,
    freqTo: number,
    start: number,
    dur: number,
    peak: number,
    type: OscillatorType
  ) => {
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freqFrom, start)
    if (freqTo !== freqFrom) osc.frequency.exponentialRampToValueAtTime(freqTo, start + dur)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur)
    osc.connect(gain)
    gain.connect(out)
    osc.start(start)
    osc.stop(start + dur + 0.02)
  }

  if (cue === 'entry') {
    // One short neutral blip.
    voice(660, 660, t, 0.09, 0.18, 'sine')
  } else if (cue === 'win') {
    // Two notes, rising a fifth.
    voice(523.25, 523.25, t, 0.1, 0.22, 'sine')
    voice(784, 784, t + 0.09, 0.16, 0.22, 'sine')
  } else {
    // One low tone, falling. Quieter than the win — a loss is not a fanfare.
    voice(220, 138, t, 0.22, 0.16, 'triangle')
  }
}

/** Fire a cue now. Overlapping calls each get their own voices. */
export function play(cue: Cue): void {
  const audio = ctx
  if (!audio || !master) return
  if (audio.state === 'suspended') void audio.resume()
  try {
    schedule(audio, master, cue, audio.currentTime)
  } catch {
    // Nothing to do; the replay carries on silently.
  }
}

/** One cue at one moment in a clip, in seconds of clip time. */
export interface Cued {
  t: number
  cue: Cue
}

/**
 * Render a clip's whole soundtrack ahead of time.
 *
 * The exported video no longer runs on the wall clock, so recording the page's
 * live output would be recording a different timeline — the cues would land
 * wherever the export happened to be when they fired. Scheduling them into an
 * offline context puts every cue on the frame it belongs to, however long the
 * export actually takes.
 *
 * Returns null when there is nothing to play, so the caller can leave the
 * audio track out of the file entirely rather than muxing silence.
 */
export async function renderCues(cues: Cued[], seconds: number): Promise<AudioBuffer | null> {
  if (cues.length === 0 || seconds <= 0) return null
  if (typeof OfflineAudioContext === 'undefined') return null
  try {
    const rate = 48_000
    // The length is a frame COUNT, and a duration in seconds rarely lands on one.
    const offline = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate)
    const gain = offline.createGain()
    gain.gain.value = MASTER_GAIN // the same master level the page plays at
    gain.connect(offline.destination)
    for (const { t, cue } of cues) {
      if (t < 0 || t >= seconds) continue
      schedule(offline, gain, cue, t)
    }
    return await offline.startRendering()
  } catch {
    // A clip with no sound is worth more than a failed export.
    return null
  }
}
