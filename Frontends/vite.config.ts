import { defineConfig, type Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'

function unityCompressionHeaders(): Plugin {
  const applyHeaders = (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ): void => {
    const requestUrl = request.url ?? ''
    const isBrotli = requestUrl.endsWith('.br')
    const isGzip = requestUrl.endsWith('.gz')

    if (isBrotli || isGzip) {
      response.setHeader('Content-Encoding', isBrotli ? 'br' : 'gzip')
      if (/\.wasm\.(?:br|gz)$/.test(requestUrl)) {
        response.setHeader('Content-Type', 'application/wasm')
      } else if (/\.js\.(?:br|gz)$/.test(requestUrl)) {
        response.setHeader('Content-Type', 'application/javascript')
      } else {
        response.setHeader('Content-Type', 'application/octet-stream')
      }
    }
    next()
  }

  return {
    name: 'unity-compression-headers',
    configureServer(server) { server.middlewares.use(applyHeaders) },
    configurePreviewServer(server) { server.middlewares.use(applyHeaders) },
  }
}

export default defineConfig({ plugins: [unityCompressionHeaders()] })
