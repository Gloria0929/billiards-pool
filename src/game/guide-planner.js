// 同时只计算一条线路；连续拖动时用最新输入替换等待中的旧输入。
export class GuidePlanner {
  constructor(factory = () => new Worker(new URL('./guide-worker.js', import.meta.url), { type: 'module' })) {
    this.worker = factory()
    this.worker.onmessage = ({ data }) => {
      if (this.disposed) return
      const job = this.active
      this.active = null
      job?.done(data, job.key)
      const next = this.pending
      this.pending = null
      if (next) this.send(next)
    }
    this.worker.onerror = () => { this.failed = true; this.dispose() }
  }

  request(key, data, done) {
    if (this.disposed || key === this.lastKey) return
    this.lastKey = key
    const job = { key, data, done }
    if (this.active) this.pending = job
    else this.send(job)
  }

  send(job) {
    this.active = job
    this.worker.postMessage(job.data)
  }

  dispose() {
    this.disposed = true
    this.worker.terminate()
    this.active = this.pending = null
  }
}
