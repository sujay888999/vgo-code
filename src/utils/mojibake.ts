export function looksLikeMojibake(text: string) {
  const sample = String(text || '')
  if (!sample) return false
  const weirdMatches =
    sample.match(
      /[ÃÂÐÑæçèéêëìíîïðñòóôõöøùúûüýþÿ]|[锛銆鍙鍚鍒姝涓浠鍦杩缁鎵宸妯璇缃粶]|[娴彃寮顏掗顔濂妹婊鎴]/g,
    ) || []
  return weirdMatches.length >= 2
}

export function tryRecoverMojibake(text: string) {
  const source = String(text || '')
  if (!source || !looksLikeMojibake(source)) return source
  try {
    const bytes = Uint8Array.from(Array.from(source).map((char) => char.charCodeAt(0) & 0xff))
    const recovered = new TextDecoder('utf-8').decode(bytes)
    if (recovered && !looksLikeMojibake(recovered)) {
      return recovered
    }
  } catch {
    // noop
  }
  return source
}
