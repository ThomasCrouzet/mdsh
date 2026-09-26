/** Stop waiting without letting a late result complete a cancelled operation. */
export function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return promise;
	return new Promise<T>((resolve, reject) => {
		const abort = () => reject(new DOMException('Operation cancelled', 'AbortError'));
		if (signal.aborted) abort();
		else signal.addEventListener('abort', abort, { once: true });
		promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
	});
}

export function checkAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new DOMException('Operation cancelled', 'AbortError');
}
