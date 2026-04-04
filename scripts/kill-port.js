#!/usr/bin/env node

const { execSync } = require('child_process')

function getPidsForPort(port) {
  const parse = (text) => {
    if (!text) return []
    return String(text)
      .trim()
      .split('\n')
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isInteger(v) && v > 0 && v !== process.pid)
  }

  try {
    const out = execSync(`lsof -ti -iTCP:${port} -sTCP:LISTEN`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return parse(out)
  } catch (err) {
    // lsof may exit non-zero while still returning useful stdout.
    return parse(err && err.stdout)
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const port = Number(process.argv[2] || 3001)
  if (!Number.isInteger(port) || port <= 0) {
    console.error('Invalid port')
    process.exit(1)
  }

  const initial = getPidsForPort(port)
  if (initial.length === 0) {
    console.log(`No process found on port ${port}`)
    return
  }

  console.log(`Stopping process(es) on port ${port}: ${initial.join(', ')}`)
  for (const pid of initial) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
    }
  }

  await sleep(800)

  const remaining = getPidsForPort(port)
  if (remaining.length > 0) {
    console.log(`Force killing remaining process(es): ${remaining.join(', ')}`)
    for (const pid of remaining) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
      }
    }
  }

  const final = getPidsForPort(port)
  if (final.length > 0) {
    console.error(`Could not free port ${port}. Still in use by: ${final.join(', ')}`)
    process.exit(1)
  }

  console.log(`Port ${port} is free`)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
