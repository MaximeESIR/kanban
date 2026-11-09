const key = (owner: string) => `atelier-assistant-prompt:${owner}`
export function readAssistantPrompt(owner: string) {
  try {
    return (localStorage.getItem(key(owner)) || '').slice(0, 2000)
  } catch {
    return ''
  }
}
export function writeAssistantPrompt(owner: string, prompt: string) {
  if (prompt.length > 2000) throw new Error('Instructions limitées à 2 000 caractères.')
  localStorage.setItem(key(owner), prompt)
}
export function clearAssistantPrompt(owner: string) {
  localStorage.removeItem(key(owner))
}
