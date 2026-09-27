const PREFIX_GZIP = 'GL1G.'
const PREFIX_JSON = 'GL1J.'

function encodeBase64Url(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64url')
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decodeBase64Url(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(base64, 'base64'))
  const binary = atob(base64 + '='.repeat((4 - base64.length % 4) % 4))
  return Uint8Array.from(binary, c => c.charCodeAt(0))
}

async function streamTransform(bytes, Constructor, format) {
  const stream = new Blob([bytes]).stream().pipeThrough(new Constructor(format))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function encodeTrackCode(trackData) {
  const source = new TextEncoder().encode(JSON.stringify(trackData))
  if (typeof CompressionStream !== 'undefined') {
    try {
      const compressed = await streamTransform(source, CompressionStream, 'gzip')
      if (compressed.length < source.length) return PREFIX_GZIP + encodeBase64Url(compressed)
    } catch { /* use the readable JSON fallback */ }
  }
  return PREFIX_JSON + encodeBase64Url(source)
}

export async function decodeTrackCode(code) {
  const value = String(code ?? '').trim()
  const compressed = value.startsWith(PREFIX_GZIP)
  if (!compressed && !value.startsWith(PREFIX_JSON)) throw new Error('Track code should start with GL1G. or GL1J.')
  const bytes = decodeBase64Url(value.slice(5))
  const raw = compressed
    ? await streamTransform(bytes, DecompressionStream, 'gzip')
    : bytes
  return JSON.parse(new TextDecoder().decode(raw))
}
