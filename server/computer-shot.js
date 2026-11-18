import { parentPort, workerData } from 'node:worker_threads'
import { chooseAiShot } from '../src/game/ai.js'

const { state, seat } = workerData
parentPort.postMessage(chooseAiShot(state, seat))
