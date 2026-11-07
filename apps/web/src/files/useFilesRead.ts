import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api";

export interface FilesRead<T> {
	value: T | null;
	pending: boolean;
	error: string;
	errorCode: string;
}

// Folder and preview requests have independent lifetimes; refresh keeps accepted content.
export function useFilesRead<T>(
	key: string,
	enabled: boolean,
	read: (signal: AbortSignal) => Promise<T>,
) {
	const [state, setState] = useState<FilesRead<T> & { key: string }>({
		key,
		value: null,
		pending: enabled,
		error: "",
		errorCode: "",
	});
	const [retry, setRetry] = useState(0),
		generation = useRef(0),
		owner = useRef({ key, enabled });
	owner.current = { key, enabled };
	useEffect(() => {
		const captured = ++generation.current,
			controller = new AbortController();
		const current = () =>
			generation.current === captured &&
			!controller.signal.aborted &&
			owner.current.key === key &&
			owner.current.enabled;
		if (enabled) {
			setState((previous) => ({
				key,
				value: previous.key === key ? previous.value : null,
				pending: true,
				error: "",
				errorCode: "",
			}));
			void read(controller.signal)
				.then((value) => {
					if (current())
						setState({ key, value, pending: false, error: "", errorCode: "" });
				})
				.catch((cause) => {
					if (current())
						setState((previous) => ({
							...previous,
							pending: false,
							error:
								cause instanceof Error
									? cause.message
									: "This resource could not be read.",
							errorCode: cause instanceof ApiError ? cause.code : "",
						}));
				});
		}
		return () => {
			generation.current++;
			controller.abort();
		};
	}, [key, enabled, read, retry]);
	const visible =
		state.key === key
			? state
			: { value: null, pending: enabled, error: "", errorCode: "" };
	return {
		...visible,
		pending: enabled && visible.pending,
		refresh: () => setRetry((value) => value + 1),
	};
}
