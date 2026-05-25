import { readChatLogs } from '../services/log.mjs'

export async function handleLogsRoute(request, response) {
  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'Method not allowed' })
    return
  }

  try {
    const requestUrl = new URL(request.url ?? '/api/logs', `http://${request.headers.host}`)
    const limit = Number(requestUrl.searchParams.get('limit') ?? 20)
    const logs = await readChatLogs(limit)

    sendJson(response, 200, { logs })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'

    sendJson(response, 500, { error: message })
  }
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(data))
}
