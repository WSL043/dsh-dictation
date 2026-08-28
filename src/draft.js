export const appendTranscript = (current, transcript) => {
  const left = String(current ?? '').replace(/\s+$/u, '')
  const right = String(transcript ?? '').trim()
  if (left === '') return right
  if (right === '') return left
  const noSpace = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(left)
    || /^[，。！？、；：）】》」』]/u.test(right)
  return `${left}${noSpace ? '' : ' '}${right}`
}
