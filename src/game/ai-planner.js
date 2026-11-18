export class AiPlanner {
  constructor(factory = () => new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' })) {
    this.factory = factory
    this.generation = 0
  }

  cancel() {
    this.generation++
    this.worker?.terminate()
    this.worker = null
    this.finish?.(null)
    this.finish = null
  }

  async plan(state, seat, difficulty) {
    this.cancel()
    const generation = this.generation
    try {
      return await new Promise((resolve, reject) => {
        this.finish = resolve
        const worker = this.factory()
        this.worker = worker
        const cleanup = () => {
          worker.terminate()
          this.worker = null
          this.finish = null
        }
        worker.onmessage = ({ data }) => {
          if (generation !== this.generation) return
          cleanup()
          if (data.error) reject(new Error(data.error))
          else resolve(data.shot)
        }
        worker.onerror = () => {
          if (generation !== this.generation) return
          cleanup()
          reject(new Error('AI worker failed'))
        }
        worker.postMessage({ state, seat, difficulty })
      })
    } catch {
      if (generation !== this.generation) return null
      this.worker?.terminate()
      this.worker = null
      this.finish = null
      // 不支持 Worker 的浏览器仍能继续人机对局。
      const { chooseAiShot } = await import('./ai.js')
      return generation === this.generation ? chooseAiShot(state, seat, difficulty) : null
    }
  }
}
