import { runtimeConfig } from '../config.mjs'
import { readChatLogs } from './log.mjs'

const maxLogResults = 20
const maxToolTextLength = 1200
const openMeteoGeocodingUrl = 'https://geocoding-api.open-meteo.com/v1/search'
const openMeteoForecastUrl = 'https://api.open-meteo.com/v1/forecast'
const weatherRequestTimeoutMs = 8000
const weatherRequestRetries = 2
const qweatherLocationLimit = 1

const toolDefinitions = [
  {
    name: 'get_current_time',
    description: 'Get the current time in a specific timezone or UTC offset.',
    parameters: {
      type: 'object',
      properties: {
        timezone: {
          type: 'string',
          description: 'IANA timezone like Asia/Shanghai or UTC offset like +08:00.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'calculator',
    description: 'Evaluate a safe arithmetic expression.',
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'Arithmetic expression using numbers and + - * / ( ).',
        },
      },
      required: ['expression'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_logs',
    description: 'Search recent chat logs by keyword. Sensitive-looking values are redacted.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Keyword or phrase to search in logs.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: maxLogResults,
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_chat_logs',
    description: 'Get recent chat logs, optionally filtered by keyword. Sensitive-looking values are redacted.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional keyword or phrase to filter recent logs.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: maxLogResults,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_weather',
    description: 'Get current real weather for a city or location name.',
    parameters: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'City or location name to query.',
        },
      },
      required: ['location'],
      additionalProperties: false,
    },
  },
]

const allowedToolNames = new Set(toolDefinitions.map((tool) => tool.name))

export function getToolDefinitions() {
  return getChatCompletionToolDefinitions()
}

export function getChatCompletionToolDefinitions() {
  return toolDefinitions.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
}

export function getResponseToolDefinitions() {
  return toolDefinitions.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }))
}

export async function runToolCall(name, rawArguments) {
  if (!allowedToolNames.has(name)) {
    throw new Error(`Tool "${name}" is not allowed`)
  }

  const args = parseToolArguments(rawArguments)

  switch (name) {
    case 'get_current_time':
      return getCurrentTime(args)
    case 'calculator':
      return calculateExpression(args)
    case 'search_logs':
      return searchChatLogs(args)
    case 'get_chat_logs':
      return getRecentChatLogs(args)
    case 'get_weather':
      return getWeather(args)
    default:
      throw new Error(`Tool "${name}" is not implemented`)
  }
}

function parseToolArguments(rawArguments) {
  if (!rawArguments) {
    return {}
  }

  if (typeof rawArguments === 'string') {
    try {
      return JSON.parse(rawArguments)
    } catch {
      throw new Error('Tool arguments must be valid JSON')
    }
  }

  if (typeof rawArguments === 'object') {
    return rawArguments
  }

  throw new Error('Tool arguments must be an object or JSON string')
}

function getCurrentTime(args) {
  const timezone = typeof args.timezone === 'string' ? args.timezone : 'Asia/Shanghai'
  const now = new Date()

  if (/^[+-]\d{2}:\d{2}$/.test(timezone)) {
    const minutes = parseUtcOffsetMinutes(timezone)
    const localTime = new Date(now.getTime() + minutes * 60_000)

    return {
      timezone,
      current_time: formatUtcOffsetDate(localTime, timezone),
      utc_time: now.toISOString(),
    }
  }

  try {
    return {
      timezone,
      current_time: new Intl.DateTimeFormat('zh-CN', {
        timeZone: timezone,
        dateStyle: 'full',
        timeStyle: 'medium',
      }).format(now),
      utc_time: now.toISOString(),
    }
  } catch {
    throw new Error('get_current_time received an invalid timezone')
  }
}

function parseUtcOffsetMinutes(offset) {
  const sign = offset.startsWith('-') ? -1 : 1
  const hours = Number(offset.slice(1, 3))
  const minutes = Number(offset.slice(4, 6))

  return sign * (hours * 60 + minutes)
}

function formatUtcOffsetDate(date, offset) {
  const year = date.getUTCFullYear()
  const month = padDatePart(date.getUTCMonth() + 1)
  const day = padDatePart(date.getUTCDate())
  const hour = padDatePart(date.getUTCHours())
  const minute = padDatePart(date.getUTCMinutes())
  const second = padDatePart(date.getUTCSeconds())

  return `${year}-${month}-${day} ${hour}:${minute}:${second} UTC${offset}`
}

function padDatePart(value) {
  return String(value).padStart(2, '0')
}

function calculateExpression(args) {
  const expression = typeof args.expression === 'string' ? args.expression : ''

  if (!expression.trim()) {
    throw new Error('calculator requires an expression')
  }

  if (expression.length > 200) {
    throw new Error('calculator expression is too long')
  }

  const parser = new ArithmeticParser(expression)
  const result = parser.parse()

  if (!Number.isFinite(result)) {
    throw new Error('calculator result is not a finite number')
  }

  return {
    expression,
    result,
  }
}

async function searchChatLogs(args) {
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  const limit = normalizeLogLimit(args.limit)

  if (!query) {
    throw new Error('search_logs requires a query')
  }

  const logs = await readChatLogs(maxLogResults)
  const lowerQuery = query.toLowerCase()

  return {
    query: redactSensitiveText(query),
    results: logs
      .map(sanitizeLog)
      .filter((log) => {
        const haystack = [
          log.user_input,
          log.assistant_output,
          log.model,
          log.created_at,
        ]
          .join(' ')
          .toLowerCase()

        return haystack.includes(lowerQuery)
      })
      .slice(0, limit),
  }
}

async function getRecentChatLogs(args) {
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  const limit = normalizeLogLimit(args.limit)
  const logs = (await readChatLogs(limit)).map(sanitizeLog)

  if (!query) {
    return {
      logs,
    }
  }

  const lowerQuery = query.toLowerCase()

  return {
    query: redactSensitiveText(query),
    logs: logs.filter((log) => {
      const haystack = [log.user_input, log.assistant_output, log.model, log.created_at]
        .join(' ')
        .toLowerCase()

      return haystack.includes(lowerQuery)
    }),
  }
}

function normalizeLogLimit(value) {
  const limit = Number.isFinite(Number(value)) ? Number(value) : 5

  return Math.max(1, Math.min(maxLogResults, Math.trunc(limit)))
}

function sanitizeLog(log) {
  return {
    id: log.id,
    user_input: truncateToolText(redactSensitiveText(log.user_input ?? '')),
    assistant_output: truncateToolText(redactSensitiveText(log.assistant_output ?? '')),
    prompt_tokens: log.prompt_tokens,
    completion_tokens: log.completion_tokens,
    total_tokens: log.total_tokens,
    latency_ms: log.latency_ms,
    model: log.model,
    created_at: log.created_at,
  }
}

function redactSensitiveText(text) {
  return String(text)
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, '[redacted_api_key]')
    .replace(
      /(OPENAI_API_KEY\s*[:=]\s*)("[^"]+"|'[^']+'|[^\s,}]+)/gi,
      '$1[redacted]',
    )
    .replace(/(api[_-]?key\s*[:=]\s*)("[^"]+"|'[^']+'|[^\s,}]+)/gi, '$1[redacted]')
    .replace(/([A-Za-z0-9_-]{48,})/g, '[redacted_token]')
}

function truncateToolText(text) {
  if (text.length <= maxToolTextLength) {
    return text
  }

  return `${text.slice(0, maxToolTextLength)}...`
}

async function getWeather(args) {
  const location =
    typeof args.location === 'string'
      ? args.location.trim()
      : typeof args.city === 'string'
        ? args.city.trim()
        : ''

  if (!location) {
    throw new Error('get_weather requires a location')
  }

  if (location.length > 120) {
    throw new Error('get_weather location is too long')
  }

  if (runtimeConfig.weatherProvider === 'qweather') {
    return getQWeather(location)
  }

  if (runtimeConfig.weatherProvider !== 'open_meteo') {
    throw new Error(
      `Unsupported WEATHER_PROVIDER "${runtimeConfig.weatherProvider}". Use "open_meteo" or "qweather".`,
    )
  }

  return getOpenMeteoWeather(location)
}

async function getOpenMeteoWeather(location) {
  const place = await geocodeOpenMeteoLocation(location)
  const weather = await fetchOpenMeteoCurrentWeather(place)
  const current = weather.current ?? {}

  return {
    location,
    resolved_location: {
      name: place.name,
      admin1: place.admin1 ?? null,
      country: place.country ?? null,
      country_code: place.country_code ?? null,
      latitude: place.latitude,
      longitude: place.longitude,
      timezone: place.timezone ?? weather.timezone ?? null,
    },
    current: {
      time: current.time ?? null,
      temperature_c: current.temperature_2m ?? null,
      apparent_temperature_c: current.apparent_temperature ?? null,
      relative_humidity_percent: current.relative_humidity_2m ?? null,
      precipitation_mm: current.precipitation ?? null,
      rain_mm: current.rain ?? null,
      showers_mm: current.showers ?? null,
      snowfall_cm: current.snowfall ?? null,
      weather_code: current.weather_code ?? null,
      weather_description: describeWeatherCode(current.weather_code),
      cloud_cover_percent: current.cloud_cover ?? null,
      pressure_msl_hpa: current.pressure_msl ?? null,
      wind_speed_kmh: current.wind_speed_10m ?? null,
      wind_direction_degrees: current.wind_direction_10m ?? null,
      wind_gusts_kmh: current.wind_gusts_10m ?? null,
    },
    units: weather.current_units ?? {},
    source: 'open-meteo',
    note: 'Weather data from Open-Meteo. Location is resolved by Open-Meteo Geocoding API.',
  }
}

async function getQWeather(location) {
  if (!runtimeConfig.qweatherApiKey) {
    throw new Error('QWEATHER_API_KEY is not configured')
  }

  const place = await geocodeQWeatherLocation(location)
  const weather = await fetchQWeatherNow(place.id)
  const now = weather.now ?? {}

  return {
    location,
    resolved_location: {
      id: place.id,
      name: place.name,
      adm1: place.adm1 ?? null,
      adm2: place.adm2 ?? null,
      country: place.country ?? null,
      latitude: parseCoordinate(place.lat),
      longitude: parseCoordinate(place.lon),
      timezone: place.tz ?? null,
      utc_offset: place.utcOffset ?? null,
      is_dst: place.isDst ?? null,
    },
    current: {
      obs_time: now.obsTime ?? null,
      temperature_c: parseNumberOrNull(now.temp),
      feels_like_c: parseNumberOrNull(now.feelsLike),
      condition: now.text ?? null,
      icon: now.icon ?? null,
      wind_360_degrees: parseNumberOrNull(now.wind360),
      wind_direction: now.windDir ?? null,
      wind_scale: now.windScale ?? null,
      wind_speed_kmh: parseNumberOrNull(now.windSpeed),
      humidity_percent: parseNumberOrNull(now.humidity),
      precipitation_mm: parseNumberOrNull(now.precip),
      pressure_hpa: parseNumberOrNull(now.pressure),
      visibility_km: parseNumberOrNull(now.vis),
      cloud_cover_percent: parseNumberOrNull(now.cloud),
      dew_point_c: parseNumberOrNull(now.dew),
    },
    source: 'qweather',
    source_update_time: weather.updateTime ?? null,
    source_link: weather.fxLink ?? null,
    note: 'Weather data from QWeather.',
  }
}

async function geocodeQWeatherLocation(location) {
  const url = buildQWeatherUrl('/geo/v2/city/lookup')
  url.searchParams.set('location', location)
  url.searchParams.set('number', String(qweatherLocationLimit))
  url.searchParams.set('lang', 'zh')

  const data = await fetchJson(url, 'QWeather city lookup', getQWeatherHeaders())

  assertQWeatherSuccess(data, 'QWeather city lookup')

  const place = Array.isArray(data.location) ? data.location[0] : null

  if (!place?.id) {
    throw new Error(`QWeather could not resolve location "${location}"`)
  }

  return place
}

async function fetchQWeatherNow(locationId) {
  const url = buildQWeatherUrl('/v7/weather/now')
  url.searchParams.set('location', locationId)
  url.searchParams.set('lang', 'zh')
  url.searchParams.set('unit', 'm')

  const data = await fetchJson(url, 'QWeather weather now', getQWeatherHeaders())

  assertQWeatherSuccess(data, 'QWeather weather now')

  return data
}

function buildQWeatherUrl(path) {
  return new URL(path.replace(/^\/+/, ''), normalizeBaseUrl(runtimeConfig.qweatherApiHost))
}

function getQWeatherHeaders() {
  return {
    'X-QW-Api-Key': runtimeConfig.qweatherApiKey,
  }
}

function assertQWeatherSuccess(data, label) {
  if (data.code === '200') {
    return
  }

  throw new Error(`${label} error ${data.code ?? 'unknown'}`)
}

async function geocodeOpenMeteoLocation(location) {
  const url = new URL(openMeteoGeocodingUrl)
  url.searchParams.set('name', location)
  url.searchParams.set('count', '1')
  url.searchParams.set('language', 'zh')
  url.searchParams.set('format', 'json')

  const data = await fetchJson(url, 'Open-Meteo geocoding')
  const place = Array.isArray(data.results) ? data.results[0] : null

  if (!place || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) {
    throw new Error(`Open-Meteo could not resolve location "${location}"`)
  }

  return place
}

async function fetchOpenMeteoCurrentWeather(place) {
  const url = new URL(openMeteoForecastUrl)
  url.searchParams.set('latitude', String(place.latitude))
  url.searchParams.set('longitude', String(place.longitude))
  url.searchParams.set(
    'current',
    [
      'temperature_2m',
      'relative_humidity_2m',
      'apparent_temperature',
      'precipitation',
      'rain',
      'showers',
      'snowfall',
      'weather_code',
      'cloud_cover',
      'pressure_msl',
      'wind_speed_10m',
      'wind_direction_10m',
      'wind_gusts_10m',
    ].join(','),
  )
  url.searchParams.set('timezone', 'auto')

  return fetchJson(url, 'Open-Meteo forecast')
}

async function fetchJson(url, label, headers = {}) {
  let lastError

  for (let attempt = 0; attempt <= weatherRequestRetries; attempt += 1) {
    let response

    try {
      response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(weatherRequestTimeoutMs),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'fetch failed'
      lastError = new Error(`${label} request failed: ${message}`)

      if (attempt < weatherRequestRetries) {
        await sleep(250 * (attempt + 1))
        continue
      }

      throw lastError
    }

    const data = await response.json().catch(() => null)

    if (!response.ok) {
      const reason =
        typeof data?.reason === 'string'
          ? data.reason
          : typeof data?.error === 'string'
            ? data.error
            : response.statusText
      lastError = new Error(`${label} error ${response.status}: ${reason}`)

      if (attempt < weatherRequestRetries && shouldRetryHttpStatus(response.status)) {
        await sleep(250 * (attempt + 1))
        continue
      }

      throw lastError
    }

    if (!data || typeof data !== 'object') {
      throw new Error(`${label} returned invalid JSON`)
    }

    return data
  }

  throw lastError ?? new Error(`${label} request failed`)
}

function shouldRetryHttpStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function normalizeBaseUrl(baseUrl) {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
}

function parseNumberOrNull(value) {
  const number = Number(value)

  return Number.isFinite(number) ? number : null
}

function parseCoordinate(value) {
  return parseNumberOrNull(value)
}

function describeWeatherCode(code) {
  const descriptions = {
    0: 'clear sky',
    1: 'mainly clear',
    2: 'partly cloudy',
    3: 'overcast',
    45: 'fog',
    48: 'depositing rime fog',
    51: 'light drizzle',
    53: 'moderate drizzle',
    55: 'dense drizzle',
    56: 'light freezing drizzle',
    57: 'dense freezing drizzle',
    61: 'slight rain',
    63: 'moderate rain',
    65: 'heavy rain',
    66: 'light freezing rain',
    67: 'heavy freezing rain',
    71: 'slight snow fall',
    73: 'moderate snow fall',
    75: 'heavy snow fall',
    77: 'snow grains',
    80: 'slight rain showers',
    81: 'moderate rain showers',
    82: 'violent rain showers',
    85: 'slight snow showers',
    86: 'heavy snow showers',
    95: 'thunderstorm',
    96: 'thunderstorm with slight hail',
    99: 'thunderstorm with heavy hail',
  }

  return descriptions[code] ?? null
}

class ArithmeticParser {
  constructor(expression) {
    this.expression = expression
    this.index = 0
  }

  parse() {
    const value = this.parseExpression()
    this.skipWhitespace()

    if (this.index < this.expression.length) {
      throw new Error('calculator expression contains invalid syntax')
    }

    return value
  }

  parseExpression() {
    let value = this.parseTerm()

    while (true) {
      this.skipWhitespace()

      if (this.match('+')) {
        value += this.parseTerm()
        continue
      }

      if (this.match('-')) {
        value -= this.parseTerm()
        continue
      }

      return value
    }
  }

  parseTerm() {
    let value = this.parseFactor()

    while (true) {
      this.skipWhitespace()

      if (this.match('*')) {
        value *= this.parseFactor()
        continue
      }

      if (this.match('/')) {
        const divisor = this.parseFactor()

        if (divisor === 0) {
          throw new Error('calculator cannot divide by zero')
        }

        value /= divisor
        continue
      }

      return value
    }
  }

  parseFactor() {
    this.skipWhitespace()

    if (this.match('+')) {
      return this.parseFactor()
    }

    if (this.match('-')) {
      return -this.parseFactor()
    }

    if (this.match('(')) {
      const value = this.parseExpression()
      this.skipWhitespace()

      if (!this.match(')')) {
        throw new Error('calculator expression is missing a closing parenthesis')
      }

      return value
    }

    return this.parseNumber()
  }

  parseNumber() {
    this.skipWhitespace()

    const start = this.index

    while (/[0-9.]/.test(this.peek())) {
      this.index += 1
    }

    const rawNumber = this.expression.slice(start, this.index)

    if (!/^(?:\d+\.?\d*|\.\d+)$/.test(rawNumber)) {
      throw new Error('calculator expression contains an invalid number')
    }

    return Number(rawNumber)
  }

  match(char) {
    if (this.expression[this.index] !== char) {
      return false
    }

    this.index += 1
    return true
  }

  peek() {
    return this.expression[this.index] ?? ''
  }

  skipWhitespace() {
    while (/\s/.test(this.peek())) {
      this.index += 1
    }
  }
}
