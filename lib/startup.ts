async function startAfterReady<T>(initialWork: Promise<unknown>, start: () => Promise<T>): Promise<T> {
  await initialWork;
  return start();
}

export = { startAfterReady };
