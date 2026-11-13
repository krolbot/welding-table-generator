import { nestParts } from '../nesting'
import { projectNestingOptions, projectParts, type ToolProject } from './project'

type Request = { type: 'nest'; key: string; project: ToolProject }
type Reply = { type: 'result'; key: string; result: ReturnType<typeof nestParts> } | { type: 'error'; key: string; message: string }

self.onmessage = ({ data }: MessageEvent<Request>) => {
  if (data.type !== 'nest') return
  try {
    const result = nestParts(projectParts(data.project), projectNestingOptions(data.project))
    self.postMessage({ type: 'result', key: data.key, result } satisfies Reply)
  } catch (error) {
    self.postMessage({ type: 'error', key: data.key, message: error instanceof Error ? error.message : 'Nesting failed' } satisfies Reply)
  }
}
