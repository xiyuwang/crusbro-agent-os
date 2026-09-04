/** Generic Promise deadline: returns timedOut without cancelling the underlying work. */
export async function raceDeadline<T>(
  promise: Promise<T>,
  ms: number,
  label = "deadline"
): Promise<{ ok: true; value: T } | { ok: false; timedOut: true; label: string }> {
  const budget = Math.max(1, Math.floor(ms));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}_timeout`)), budget);
      }),
    ]);
    return { ok: true, value };
  } catch (e: unknown) {
    const msg = String((e as { message?: string })?.message || e);
    if (msg === `${label}_timeout`) {
      return { ok: false, timedOut: true, label };
    }
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
