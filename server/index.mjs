import { createServer } from 'node:http'
import { runtimeConfig } from './config.mjs'
import { handleChatRoute } from './routes/chat.mjs'
import { handleLogsRoute } from './routes/logs.mjs'

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host}`)

  if (requestUrl.pathname === '/api/chat') {
    await handleChatRoute(request, response)
    return
  }

  if (requestUrl.pathname === '/api/logs') {
    await handleLogsRoute(request, response)
    return
  }

  response.writeHead(404, {
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify({ error: 'Not found' }))
})

server.listen(runtimeConfig.port, () => {
  console.log(`API server listening on http://localhost:${runtimeConfig.port}`)
})
