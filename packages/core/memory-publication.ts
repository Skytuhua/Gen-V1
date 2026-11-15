/** A shared publication guard, never a claim that arbitrary prose is secret-free. */
export function memoryContainsSecret(text: string): boolean {
  return /\b(?:sk-(?:proj-|ant-)?[a-zA-Z0-9_-]{16,}|gh[pousr]_[a-zA-Z0-9]{16,}|github_pat_[a-zA-Z0-9_]{16,}|AIza[a-zA-Z0-9_-]{25,}|AKIA[A-Z0-9]{16})\b|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|passwd|secret|authorization)\s*[:=]\s*["']?[^\s"']{8,}|\bBearer\s+[a-zA-Z0-9._~+/-]{16,}|\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/i.test(text);
}
