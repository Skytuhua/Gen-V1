/** One-shot request to reveal a referenced file in a live Files panel. */
export interface FileRevealRequest {
	id: number;
	projectId: string;
	threadId: string | null;
	path: string;
	line?: number;
	/** Restricts delivery to a specific panel surface when set. */
	panelId?: string;
}
