export class NetClient {
  constructor() {
    this.ws = null
    this.listeners = new Map()
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
        if (this.ws !== socket) return reject(new Error('closed'))
        reject(new Error('timeout'))
        try {
          socket.close()
        } catch (_) {}
      }, 8000)
      socket.addEventListener('open', () => {
        clearTimeout(timer)
        if (this.ws !== socket) return reject(new Error('closed'))
        this.emit('open')
        resolve()
      })
      socket.addEventListener('message', (event) => {
        if (this.ws !== socket) return
        let message
        try {
          message = JSON.parse(event.data)
        } catch (_) {
          return
        }
        if (message && typeof message.type === 'string')
          this.emit(message.type, message)
      })
      socket.addEventListener('close', (event) => {
        clearTimeout(timer)
        if (this.ws !== socket) return reject(new Error('closed'))
        this.ws = null
        reject(new Error('network'))
        this.emit('disconnect', event)
      })
      socket.addEventListener('error', () => {
        clearTimeout(timer)
        reject(new Error(this.ws === socket ? 'network' : 'closed'))
      })
    }).catch((error) => {
      if (error.message !== 'closed' && (!this.ws || this.ws === socket)) {
        this.emit('error', {
          message: error.message === 'timeout'
            ? '连接服务器超时，请确认联机服务已启动。'
            : '无法连接联机服务器。',
        })
      }
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
    const socket = this.ws
    this.ws = null
    try {
      socket?.close()
    } catch (_) {}
  }
}
