import { readdir, readFile } from 'fs/promises'
import path from 'path'

export interface CommittedSpec {
  /** File name, e.g. "btc-cohort-flow-flip.json" — the spec's identity in git. */
  file: string
  hypothesis_text: string | null
  /** The file's contents, verbatim. Never rewritten: what you submit is what
   *  is committed, so the spec_hash of the job matches the spec in the repo. */
  json: string
}

export interface CommittedSpecs {
  specs: CommittedSpec[]
  /** Non-null when the directory could not be read — distinct from "no specs
   *  are committed", which is an empty list with no error. */
  error: string | null
}

const SPECS_DIR = 'verify-service/specs'

/**
 * The specs committed to verify-service/specs, read at request time.
 *
 * These are offered as a picker so the common case — re-running a spec that
 * lives in the repo — needs no JSON in a text box and no shell. The file is
 * handed to the browser untouched; the console validates it against grammar v1
 * before it is submitted, exactly as the API will.
 */
export async function loadCommittedSpecs(): Promise<CommittedSpecs> {
  const dir = path.join(process.cwd(), SPECS_DIR)
  try {
    const names = (await readdir(dir)).filter((n) => n.endsWith('.json')).sort()
    const specs = await Promise.all(
      names.map(async (file) => {
        const json = await readFile(path.join(dir, file), 'utf8')
        let hypothesis: string | null = null
        try {
          const parsed = JSON.parse(json)
          if (parsed && typeof parsed.hypothesis_text === 'string') hypothesis = parsed.hypothesis_text
        } catch {
          // A malformed committed spec still shows up in the picker; the
          // console's validator will say exactly what is wrong with it.
        }
        return { file, hypothesis_text: hypothesis, json }
      }),
    )
    return { specs, error: null }
  } catch (e) {
    return { specs: [], error: e instanceof Error ? e.message : `could not read ${SPECS_DIR}` }
  }
}
