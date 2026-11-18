import { chooseAiShot } from './ai.js'

self.onmessage = ({ data }) => {
  try {
    self.postMessage({ shot: chooseAiShot(data.state, data.seat, data.difficulty) })
  } catch (error) {
    self.postMessage({ error: String(error) })
  }
}
