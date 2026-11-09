export class RequestDeadline extends Error {
  constructor() {
    super(
      'La réponse du serveur tarde. Le résultat n’est pas confirmé. Vérifiez l’état du ticket, puis réessayez si nécessaire.',
    )
    this.name = 'RequestDeadline'
  }
}
// The deadline also covers time spent waiting for the client's authentication lock.
// An aborted signal prevents a delayed fetch from being sent after that wait.
export async function boundedRequest<T>(
  run: (signal: AbortSignal) => PromiseLike<T>,
  milliseconds = 15000,
): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new RequestDeadline())
      controller.abort()
    }, milliseconds)
  })
  try {
    return await Promise.race([Promise.resolve().then(() => run(controller.signal)), deadline])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
