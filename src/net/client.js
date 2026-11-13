export class NetClient {
  constructor() {
    this.ws = null
    this.listeners = new Map()
    this.closedByUser = false
    this.ready = null
  }

  on(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type).add(handler)
    return () => this.listeners.get(type)?.delete(handler)
  }

  emit(type, payload) {
    for (const handler of this.listeners.get(type) || []) {
      try {
        handler(payload)
      } catch (error) {
        console.error(error)
      }
    }
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING))
      return this.ready
    this.closedByUser = false
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${protocol}://${location.host}/ws`
    let socket
    try {
      socket = new WebSocket(url)
    } catch (error) {
      this.emit('error', { message: '无法连接联机服务器。' })
      return Promise.reject(error)
    }
    this.ws = socket
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('timeout'))
        try {
          socket.close()
        } catch (_) {}
      }, 8000)
      socket.addEventListener('open', () => {
        clearTimeout(timer)
        this.emit('open')
        resolve()
      })
      socket.addEventListener('message', (event) => {
        let message
        try {
          message = JSON.parse(event.data)
        } catch (_) {
          return
        }
        if (message && typeof message.type === 'string')
          this.emit(message.type, message)
      })
      socket.addEventListener('close', () => {
        clearTimeout(timer)
        this.ws = null
        const wasUser = this.closedByUser
        this.closedByUser = false
        if (!wasUser) this.emit('disconnect')
      })
      socket.addEventListener('error', () => {
        clearTimeout(timer)
        reject(new Error('network'))
      })
    }).catch((error) => {
      this.emit('error', {
        message:
          error?.message === 'timeout'
            ? '连接服务器超时，请确认联机服务已启动。'
            : '无法连接联机服务器。',
      })
      throw error
    })
    return this.ready
  }

  send(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.emit('error', { message: '连接已断开，请重新进入联机大厅。' })
      return false
    }
    this.ws.send(JSON.stringify(message))
    return true
  }

  close() {
    this.closedByUser = true
    try {
      this.ws?.close()
    } catch (_) {}
    this.ws = null
  }
}
