interface StartupOptions {
  timeoutMs?: number;
  onTimeout?: () => void;
}

async function startAfterReady<T>(
  initialWork: Promise<unknown>,
  start: () => Promise<T>,
  { timeoutMs, onTimeout }: StartupOptions = {},
): Promise<T> {
  if (timeoutMs !== undefined && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const ready = await Promise.race([
        initialWork.then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), timeoutMs);
        }),
      ]);
      if (!ready) onTimeout?.();
    } finally {
      if (timer) clearTimeout(timer);
    }
  } else {
    await initialWork;
  }

  return start();
}

export = { startAfterReady };
