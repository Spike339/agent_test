import { readFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { runtimeConfig } from "../config.mjs";
import { readChatLogs } from "./log.mjs";
import { version } from "node:os";

const maxLogResults = 20;
const maxToolTextLength = 1200;
const openMeteoGeocodingUrl = "https://geocoding-api.open-meteo.com/v1/search";
const openMeteoForecastUrl = "https://api.open-meteo.com/v1/forecast";
const weatherRequestTimeoutMs = 8000;
const weatherRequestRetries = 2;
const qweatherLocationLimit = 1;
// 限制只能分析当前工作区的项目
const projectAnalysisRoot = process.cwd();
// 如果没选领，默认分析当前项目
const defaultProjectPath = ".";
// 避免传入特别长的异常路径
const maxProjectPathLength = 240;

const toolDefinitions = [
  {
    name: "get_current_time",
    description: "Get the current time in a specific timezone or UTC offset.",
    parameters: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description:
            "IANA timezone like Asia/Shanghai or UTC offset like +08:00.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "calculator",
    description: "Evaluate a safe arithmetic expression.",
    parameters: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description: "Arithmetic expression using numbers and + - * / ( ).",
        },
      },
      required: ["expression"],
      additionalProperties: false,
    },
  },
  {
    name: "search_logs",
    description:
      "Search recent chat logs by keyword. Sensitive-looking values are redacted.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Keyword or phrase to search in logs.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: maxLogResults,
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_chat_logs",
    description:
      "Get recent chat logs, optionally filtered by keyword. Sensitive-looking values are redacted.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Optional keyword or phrase to filter recent logs.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: maxLogResults,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_weather",
    description: "Get current real weather for a city or location name.",
    parameters: {
      type: "object",
      properties: {
        location: {
          type: "string",
          description: "City or location name to query.",
        },
      },
      required: ["location"],
      additionalProperties: false,
    },
  },
  {
    name: "analyze_react_project",
    description:
      "Analyze a React project package.json and return dependency findings.",
    parameters: {
      type: "object",
      properties: {
        project_path: {
          type: "string",
          description:
            "Relative path to the React project folder inside the workspace.",
        },
      },
      additionalProperties: false,
    },
  },
];

const allowedToolNames = new Set(toolDefinitions.map((tool) => tool.name));

export function getToolDefinitions() {
  return getChatCompletionToolDefinitions();
}

export function getChatCompletionToolDefinitions() {
  return toolDefinitions.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export function getResponseToolDefinitions() {
  return toolDefinitions.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

export async function runToolCall(name, rawArguments) {
  if (!allowedToolNames.has(name)) {
    throw new Error(`Tool "${name}" is not allowed`);
  }

  const args = parseToolArguments(rawArguments);

  switch (name) {
    case "get_current_time":
      return getCurrentTime(args);
    case "calculator":
      return calculateExpression(args);
    case "search_logs":
      return searchChatLogs(args);
    case "get_chat_logs":
      return getRecentChatLogs(args);
    case "get_weather":
      return getWeather(args);
    case "analyze_react_project":
      return analyzeReactProject(args);
    default:
      throw new Error(`Tool "${name}" is not implemented`);
  }
}

// 解析工具函数
function parseToolArguments(rawArguments) {
  if (!rawArguments) {
    return {};
  }

  if (typeof rawArguments === "string") {
    try {
      return JSON.parse(rawArguments);
    } catch {
      throw new Error("Tool arguments must be valid JSON");
    }
  }

  if (typeof rawArguments === "object") {
    return rawArguments;
  }

  throw new Error("Tool arguments must be an object or JSON string");
}

// 解析项目路径
function resolveProjectPath(projectPath) {
  // 把用户的路径解析为绝对路径
  const rawPath =
    typeof projectPath === "string" && projectPath.trim()
      ? projectPath.trim()
      : defaultProjectPath;

  if (rawPath.length > maxProjectPathLength) {
    throw new Error("project_path is too long");
  }

  const resolvedPath = resolve(projectAnalysisRoot, rawPath);
  const relativePath = relative(projectAnalysisRoot, resolvedPath);

  // 禁止 ../../xxx 这种越界的行为
  if (
    relativePath.startsWith(`..${pathSeparator()}`) ||
    relativePath === ".."
  ) {
    throw new Error("project_path must stay inside the current workspace");
  }

  // 返回三个字段
  return {
    input_path: rawPath,
    absolute_path: resolvedPath,
    relative_path: relativePath || ".",
  };
}

async function analyzeReactProject(args) {
  // 把用户传入的项目路径变成安全的项目路径对象
  const project = resolveProjectPath(args.project_path);
  // 读取 package.json
  const packageJson = await readProjectPackageJson(project);
  // 清洗 dependencies
  const dependencies = normalizeDependencyMap(packageJson.dependencies);
  // 清洗 devDependencies
  const devDependencies = normalizeDependencyMap(packageJson.devDependencies);

  const allDependencies = {
    ...dependencies,
    ...devDependencies,
  };
  // react 版本号
  const reactVersion = allDependencies.react ?? null;
  // React Dom 版本号
  const reactDomVersion = allDependencies["react-dom"] ?? null;
  // 构建项目使用的工具
  const buildTool = detectBuildTool(allDependencies);
  // 项目没安装 TypeScript
  const hasTypeScript = Boolean(allDependencies.typescript);
  // 项目没有安装 @types/react
  const hasReactTypes = Boolean(allDependencies["@types/react"]);
  // 项目没有安装 @rtoes/react-dom
  const hasReactDomTypes = Boolean(allDependencies["@types/react-dom"]);
  // 判断项目是否是react项目
  const isReactProject = Boolean(
    reactVersion ||
    reactDomVersion ||
    allDependencies["@vitejs/plugin-react"] ||
    allDependencies["react-scripts"] ||
    allDependencies.next,
  );

  const findings = buildBasicReactFindings({
    isReactProject,
    reactVersion,
    reactDomVersion,
    buildTool,
    hasTypeScript,
    hasReactTypes,
    hasReactDomTypes,
  });

  // 问题 和 建议
  const issues = findings.issues;
  const recommendations = findings.recommendations;

  return {
    project: {
      // 返回基础路径信息
      name: typeof packageJson.name === "string" ? packageJson.name : null,
      version:
        typeof packageJson.version === "string" ? packageJson.version : null,
      path: project.relative_path,
      is_react_project: isReactProject,
    },
    dependencies: {
      react: reactVersion,
      react_dom: reactDomVersion,
      build_tool: buildTool,
      has_typescript: hasTypeScript,
      has_react_types: hasReactTypes,
      has_react_dom_types: hasReactDomTypes,
      dependency_count: Object.keys(dependencies).length,
      dev_dependency_count: Object.keys(devDependencies).length,
    },
    status: "basic_dependency_rules_checked",
    issues,
    recommendations,
    summary: buildAnalysisSummary(issues),
  };
}

async function readProjectPackageJson(project) {
  // 把项目目录和文件名拼接成完整路径
  const packageJsonPath = resolve(project.absolute_path, "package.json");

  let rawPackageJson;

  try {
    // 读取文件内容，得到的是字符串，不是对象
    rawPackageJson = await readFile(packageJsonPath, "utf-8");
  } catch (error) {
    // 如果文件不存在，ENOENT 就说明没找到 package.json，这个时候bao一个友好的错误
    if (error?.code === "ENOENT") {
      throw new Error(`package.json not found in ${project.relative_path}`);
    }
    throw error;
  }

  try {
    // 把字符串变成 JS 对象
    const packageJson = JSON.parse(rawPackageJson);
    // 防止读出来的事奇怪结构，比如数组，空值
    if (
      !packageJson ||
      typeof packageJson !== "object" ||
      Array.isArray(packageJson)
    ) {
      throw new Error("Invalid package.json shape");
    }

    return packageJson;
  } catch {
    throw new Error(
      `package.json in ${project.relative_path} must be valid JSON`,
    );
  }
}

//
function normalizeDependencyMap(value) {
  // 如果传进来的不是正常对象，就返回空对象
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    // 改变输出的格式
    Object.entries(value).filter(([, version]) => typeof version === "string"),
  );
}

// 构建项目使用的工具,以下三个是最常用的
function detectBuildTool(dependencies) {
  if (dependencies.vite) {
    return "vite";
  }

  if (dependencies.next) {
    return "next";
  }

  if (dependencies["react-scripts"]) {
    return "create-react-app";
  }

  return null;
}

function getMajorVersion(version) {
  const match = version.match(/\d+/);

  return match ? Number(match[0]) : null;
}

// 根据 issues 计算风险等级
function getRiskLevel(issues) {
  if (issues.some((issue) => issue.severity === "error")) {
    return "high";
  }

  if (issues.some((issue) => issue.severity === "warning")) {
    return "medium";
  }

  return "low";
}

function buildAnalysisSummary(issues) {
    return {
      issue_count: issues.length,
      risk_level: getRiskLevel(issues),
    }
}

function buildBasicReactFindings({
  isReactProject,
  reactVersion,
  reactDomVersion,
  buildTool,
  hasTypeScript,
  hasReactTypes,
  hasReactDomTypes,
}) {
  const issues = [];
  const recommendations = [];
  // 如果当前不是 React 项目，给一个 info 提示
  if (!isReactProject) {
    issues.push({
      severity: "info",
      code: "NOT_REACT_PROJECT",
      message: "No React dependency was detected in package.json.",
    });

    recommendations.push({
      priority: "low",
      message: "Check whether the selected folder is the React project root.",
    });
  }

  // 如果 react 版本小于 18 则弹出提示
  if (isReactProject && reactVersion) {
    const reactMajor = getMajorVersion(reactVersion);

    if (reactMajor !== null && reactMajor < 18) {
      issues.push({
        severity: "warning",
        code: "OLD_REACT_MAJOR_VERSION",
        message: "React major version is older than 18.",
      });

      recommendations.push({
        priority: "medium",
        message:
          "Consider upgrading React when the project has time for dependency and compatibility testing.",
      });
    }
  }

  // 缺少reactdom 的判断
  if (reactVersion && !reactDomVersion) {
    issues.push({
      severity: "warning",
      code: "MISSING_REACT_DOM",
      message: "react is installed but react-dom is missing.",
    });

    recommendations.push({
      priority: "medium",
      message:
        "Install react-dom if this project renders React in the browser.",
    });
  }

  // 查看包版本是否合理
  if (reactVersion && reactDomVersion) {
    const reactMajor = getMajorVersion(reactVersion);
    const reactDomMajor = getMajorVersion(reactDomVersion);

    if (
      reactMajor !== null &&
      reactDomMajor !== null &&
      reactMajor !== reactDomMajor
    ) {
      issues.push({
        severity: "error",
        code: "REACT_DOM_MAJOR_VERSION_MISMATCH",
        message: "react and react-dom use different major versions.",
      });

      recommendations.push({
        priority: "high",
        message: "Align react and react-dom to the same major version.",
      });
    }
  }
  // 提醒用户确认构建工具
  if (isReactProject && !buildTool) {
    issues.push({
      severity: "warning",
      code: "BUILD_TOOL_NOT_DETECTED",
      message: "No common React build tool was detected.",
    });

    recommendations.push({
      priority: "medium",
      message:
        "Confirm whether the project uses Vite, Next.js, Create React App, or another build tool.",
    });
  }

  if (isReactProject && hasTypeScript && !hasReactTypes) {
    issues.push({
      severity: "warning",
      code: "MISSING_REACT_TYPES",
      message: "TypeScript is installed but @types/react is missing.",
    });

    recommendations.push({
      priority: "medium",
      message:
        "Install @types/react so TypeScript can type-check React APIs and JSX.",
    });
  }

  if (isReactProject && hasTypeScript && reactDomVersion && !hasReactDomTypes) {
    issues.push({
      severity: "warning",
      code: "MISSING_REACT_DOM_TYPES",
      message: "TypeScript is installed but @types/react-dom is missing.",
    });

    recommendations.push({
      priority: "medium",
      message:
        "Install @types/react-dom for type coverage around React DOM APIs.",
    });
  }

  return {
    issues,
    recommendations,
  };
}

function pathSeparator() {
  return process.platform === "win32" ? "\\" : "/";
}

function getCurrentTime(args) {
  const timezone =
    typeof args.timezone === "string" ? args.timezone : "Asia/Shanghai";
  const now = new Date();

  if (/^[+-]\d{2}:\d{2}$/.test(timezone)) {
    const minutes = parseUtcOffsetMinutes(timezone);
    const localTime = new Date(now.getTime() + minutes * 60_000);

    return {
      timezone,
      current_time: formatUtcOffsetDate(localTime, timezone),
      utc_time: now.toISOString(),
    };
  }

  try {
    return {
      timezone,
      current_time: new Intl.DateTimeFormat("zh-CN", {
        timeZone: timezone,
        dateStyle: "full",
        timeStyle: "medium",
      }).format(now),
      utc_time: now.toISOString(),
    };
  } catch {
    throw new Error("get_current_time received an invalid timezone");
  }
}

function parseUtcOffsetMinutes(offset) {
  const sign = offset.startsWith("-") ? -1 : 1;
  const hours = Number(offset.slice(1, 3));
  const minutes = Number(offset.slice(4, 6));

  return sign * (hours * 60 + minutes);
}

function formatUtcOffsetDate(date, offset) {
  const year = date.getUTCFullYear();
  const month = padDatePart(date.getUTCMonth() + 1);
  const day = padDatePart(date.getUTCDate());
  const hour = padDatePart(date.getUTCHours());
  const minute = padDatePart(date.getUTCMinutes());
  const second = padDatePart(date.getUTCSeconds());

  return `${year}-${month}-${day} ${hour}:${minute}:${second} UTC${offset}`;
}

function padDatePart(value) {
  return String(value).padStart(2, "0");
}

function calculateExpression(args) {
  const expression = typeof args.expression === "string" ? args.expression : "";

  if (!expression.trim()) {
    throw new Error("calculator requires an expression");
  }

  if (expression.length > 200) {
    throw new Error("calculator expression is too long");
  }

  const parser = new ArithmeticParser(expression);
  const result = parser.parse();

  if (!Number.isFinite(result)) {
    throw new Error("calculator result is not a finite number");
  }

  return {
    expression,
    result,
  };
}

async function searchChatLogs(args) {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const limit = normalizeLogLimit(args.limit);

  if (!query) {
    throw new Error("search_logs requires a query");
  }

  const logs = await readChatLogs(maxLogResults);
  const lowerQuery = query.toLowerCase();

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
          .join(" ")
          .toLowerCase();

        return haystack.includes(lowerQuery);
      })
      .slice(0, limit),
  };
}

async function getRecentChatLogs(args) {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const limit = normalizeLogLimit(args.limit);
  const logs = (await readChatLogs(limit)).map(sanitizeLog);

  if (!query) {
    return {
      logs,
    };
  }

  const lowerQuery = query.toLowerCase();

  return {
    query: redactSensitiveText(query),
    logs: logs.filter((log) => {
      const haystack = [
        log.user_input,
        log.assistant_output,
        log.model,
        log.created_at,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(lowerQuery);
    }),
  };
}

function normalizeLogLimit(value) {
  const limit = Number.isFinite(Number(value)) ? Number(value) : 5;

  return Math.max(1, Math.min(maxLogResults, Math.trunc(limit)));
}

function sanitizeLog(log) {
  return {
    id: log.id,
    user_input: truncateToolText(redactSensitiveText(log.user_input ?? "")),
    assistant_output: truncateToolText(
      redactSensitiveText(log.assistant_output ?? ""),
    ),
    prompt_tokens: log.prompt_tokens,
    completion_tokens: log.completion_tokens,
    total_tokens: log.total_tokens,
    latency_ms: log.latency_ms,
    model: log.model,
    created_at: log.created_at,
  };
}

function redactSensitiveText(text) {
  return String(text)
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[redacted_api_key]")
    .replace(
      /(OPENAI_API_KEY\s*[:=]\s*)("[^"]+"|'[^']+'|[^\s,}]+)/gi,
      "$1[redacted]",
    )
    .replace(
      /(api[_-]?key\s*[:=]\s*)("[^"]+"|'[^']+'|[^\s,}]+)/gi,
      "$1[redacted]",
    )
    .replace(/([A-Za-z0-9_-]{48,})/g, "[redacted_token]");
}

function truncateToolText(text) {
  if (text.length <= maxToolTextLength) {
    return text;
  }

  return `${text.slice(0, maxToolTextLength)}...`;
}

async function getWeather(args) {
  const location =
    typeof args.location === "string"
      ? args.location.trim()
      : typeof args.city === "string"
        ? args.city.trim()
        : "";

  if (!location) {
    throw new Error("get_weather requires a location");
  }

  if (location.length > 120) {
    throw new Error("get_weather location is too long");
  }

  if (runtimeConfig.weatherProvider === "qweather") {
    return getQWeather(location);
  }

  if (runtimeConfig.weatherProvider !== "open_meteo") {
    throw new Error(
      `Unsupported WEATHER_PROVIDER "${runtimeConfig.weatherProvider}". Use "open_meteo" or "qweather".`,
    );
  }

  return getOpenMeteoWeather(location);
}

async function getOpenMeteoWeather(location) {
  const place = await geocodeOpenMeteoLocation(location);
  const weather = await fetchOpenMeteoCurrentWeather(place);
  const current = weather.current ?? {};

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
    source: "open-meteo",
    note: "Weather data from Open-Meteo. Location is resolved by Open-Meteo Geocoding API.",
  };
}

async function getQWeather(location) {
  if (!runtimeConfig.qweatherApiKey) {
    throw new Error("QWEATHER_API_KEY is not configured");
  }

  const place = await geocodeQWeatherLocation(location);
  const weather = await fetchQWeatherNow(place.id);
  const now = weather.now ?? {};

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
    source: "qweather",
    source_update_time: weather.updateTime ?? null,
    source_link: weather.fxLink ?? null,
    note: "Weather data from QWeather.",
  };
}

async function geocodeQWeatherLocation(location) {
  const url = buildQWeatherUrl("/geo/v2/city/lookup");
  url.searchParams.set("location", location);
  url.searchParams.set("number", String(qweatherLocationLimit));
  url.searchParams.set("lang", "zh");

  const data = await fetchJson(
    url,
    "QWeather city lookup",
    getQWeatherHeaders(),
  );

  assertQWeatherSuccess(data, "QWeather city lookup");

  const place = Array.isArray(data.location) ? data.location[0] : null;

  if (!place?.id) {
    throw new Error(`QWeather could not resolve location "${location}"`);
  }

  return place;
}

async function fetchQWeatherNow(locationId) {
  const url = buildQWeatherUrl("/v7/weather/now");
  url.searchParams.set("location", locationId);
  url.searchParams.set("lang", "zh");
  url.searchParams.set("unit", "m");

  const data = await fetchJson(
    url,
    "QWeather weather now",
    getQWeatherHeaders(),
  );

  assertQWeatherSuccess(data, "QWeather weather now");

  return data;
}

function buildQWeatherUrl(path) {
  return new URL(
    path.replace(/^\/+/, ""),
    normalizeBaseUrl(runtimeConfig.qweatherApiHost),
  );
}

function getQWeatherHeaders() {
  return {
    "X-QW-Api-Key": runtimeConfig.qweatherApiKey,
  };
}

function assertQWeatherSuccess(data, label) {
  if (data.code === "200") {
    return;
  }

  throw new Error(`${label} error ${data.code ?? "unknown"}`);
}

async function geocodeOpenMeteoLocation(location) {
  const url = new URL(openMeteoGeocodingUrl);
  url.searchParams.set("name", location);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "zh");
  url.searchParams.set("format", "json");

  const data = await fetchJson(url, "Open-Meteo geocoding");
  const place = Array.isArray(data.results) ? data.results[0] : null;

  if (
    !place ||
    !Number.isFinite(place.latitude) ||
    !Number.isFinite(place.longitude)
  ) {
    throw new Error(`Open-Meteo could not resolve location "${location}"`);
  }

  return place;
}

async function fetchOpenMeteoCurrentWeather(place) {
  const url = new URL(openMeteoForecastUrl);
  url.searchParams.set("latitude", String(place.latitude));
  url.searchParams.set("longitude", String(place.longitude));
  url.searchParams.set(
    "current",
    [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "precipitation",
      "rain",
      "showers",
      "snowfall",
      "weather_code",
      "cloud_cover",
      "pressure_msl",
      "wind_speed_10m",
      "wind_direction_10m",
      "wind_gusts_10m",
    ].join(","),
  );
  url.searchParams.set("timezone", "auto");

  return fetchJson(url, "Open-Meteo forecast");
}

async function fetchJson(url, label, headers = {}) {
  let lastError;

  for (let attempt = 0; attempt <= weatherRequestRetries; attempt += 1) {
    let response;

    try {
      response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(weatherRequestTimeoutMs),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "fetch failed";
      lastError = new Error(`${label} request failed: ${message}`);

      if (attempt < weatherRequestRetries) {
        await sleep(250 * (attempt + 1));
        continue;
      }

      throw lastError;
    }

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const reason =
        typeof data?.reason === "string"
          ? data.reason
          : typeof data?.error === "string"
            ? data.error
            : response.statusText;
      lastError = new Error(`${label} error ${response.status}: ${reason}`);

      if (
        attempt < weatherRequestRetries &&
        shouldRetryHttpStatus(response.status)
      ) {
        await sleep(250 * (attempt + 1));
        continue;
      }

      throw lastError;
    }

    if (!data || typeof data !== "object") {
      throw new Error(`${label} returned invalid JSON`);
    }

    return data;
  }

  throw lastError ?? new Error(`${label} request failed`);
}

function shouldRetryHttpStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeBaseUrl(baseUrl) {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

function parseNumberOrNull(value) {
  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function parseCoordinate(value) {
  return parseNumberOrNull(value);
}

function describeWeatherCode(code) {
  const descriptions = {
    0: "clear sky",
    1: "mainly clear",
    2: "partly cloudy",
    3: "overcast",
    45: "fog",
    48: "depositing rime fog",
    51: "light drizzle",
    53: "moderate drizzle",
    55: "dense drizzle",
    56: "light freezing drizzle",
    57: "dense freezing drizzle",
    61: "slight rain",
    63: "moderate rain",
    65: "heavy rain",
    66: "light freezing rain",
    67: "heavy freezing rain",
    71: "slight snow fall",
    73: "moderate snow fall",
    75: "heavy snow fall",
    77: "snow grains",
    80: "slight rain showers",
    81: "moderate rain showers",
    82: "violent rain showers",
    85: "slight snow showers",
    86: "heavy snow showers",
    95: "thunderstorm",
    96: "thunderstorm with slight hail",
    99: "thunderstorm with heavy hail",
  };

  return descriptions[code] ?? null;
}

class ArithmeticParser {
  constructor(expression) {
    this.expression = expression;
    this.index = 0;
  }

  parse() {
    const value = this.parseExpression();
    this.skipWhitespace();

    if (this.index < this.expression.length) {
      throw new Error("calculator expression contains invalid syntax");
    }

    return value;
  }

  parseExpression() {
    let value = this.parseTerm();

    while (true) {
      this.skipWhitespace();

      if (this.match("+")) {
        value += this.parseTerm();
        continue;
      }

      if (this.match("-")) {
        value -= this.parseTerm();
        continue;
      }

      return value;
    }
  }

  parseTerm() {
    let value = this.parseFactor();

    while (true) {
      this.skipWhitespace();

      if (this.match("*")) {
        value *= this.parseFactor();
        continue;
      }

      if (this.match("/")) {
        const divisor = this.parseFactor();

        if (divisor === 0) {
          throw new Error("calculator cannot divide by zero");
        }

        value /= divisor;
        continue;
      }

      return value;
    }
  }

  parseFactor() {
    this.skipWhitespace();

    if (this.match("+")) {
      return this.parseFactor();
    }

    if (this.match("-")) {
      return -this.parseFactor();
    }

    if (this.match("(")) {
      const value = this.parseExpression();
      this.skipWhitespace();

      if (!this.match(")")) {
        throw new Error(
          "calculator expression is missing a closing parenthesis",
        );
      }

      return value;
    }

    return this.parseNumber();
  }

  parseNumber() {
    this.skipWhitespace();

    const start = this.index;

    while (/[0-9.]/.test(this.peek())) {
      this.index += 1;
    }

    const rawNumber = this.expression.slice(start, this.index);

    if (!/^(?:\d+\.?\d*|\.\d+)$/.test(rawNumber)) {
      throw new Error("calculator expression contains an invalid number");
    }

    return Number(rawNumber);
  }

  match(char) {
    if (this.expression[this.index] !== char) {
      return false;
    }

    this.index += 1;
    return true;
  }

  peek() {
    return this.expression[this.index] ?? "";
  }

  skipWhitespace() {
    while (/\s/.test(this.peek())) {
      this.index += 1;
    }
  }
}
