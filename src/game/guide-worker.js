import { buildAimGuide } from './guide.js'

self.onmessage = ({ data }) => {
  const { geo, balls, angle, includeObject, shot } = data
  self.postMessage(buildAimGuide(geo, balls, angle, includeObject, shot))
}
