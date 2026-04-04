require('dotenv/config')

const net = require('net')
const { execSync } = require('child_process')

function canConnect(host, port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false

    const done = (ok) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(ok)
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    socket.once('timeout', () => done(false))
    socket.connect(port, host)
  })
}

function readDockerIp(name) {
  try {
    return execSync(`docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${name}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

async function resolveDatabaseUrl() {
  const raw = process.env.DATABASE_URL
  if (!raw) {
    throw new Error('DATABASE_URL is required')
  }

  const url = new URL(raw)
  const port = Number(url.port || 5432)

  const primaryHost = url.hostname
  if (await canConnect(primaryHost, port)) {
    return { url: raw, changed: false, from: primaryHost, to: primaryHost }
  }

  const dockerIps = [
    readDockerIp('prediction-db'),
    readDockerIp('prediction-postgres'),
    readDockerIp('predictify-postgres'),
  ]

  const candidates = unique([
    '127.0.0.1',
    'host.docker.internal',
    ...dockerIps,
  ]).filter((h) => h !== primaryHost)

  for (const host of candidates) {
    if (await canConnect(host, port)) {
      const resolved = new URL(raw)
      resolved.hostname = host
      return { url: resolved.toString(), changed: true, from: primaryHost, to: host }
    }
  }

  throw new Error(
    `Unable to reach Postgres on ${primaryHost}:${port} and no fallback host was reachable. ` +
    'Start your DB container (e.g. docker start prediction-db) and retry.'
  )
}

module.exports = {
  resolveDatabaseUrl,
}
