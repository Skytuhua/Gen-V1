// Verified against installed direct dependency package manifests on 2026-10-31.
// A distribution must retain the packages' complete license and notice files.
export const DEPENDENCY_NOTICES = [
  ['@earendil-works/pi-coding-agent', '1.4.0', 'MIT'],
  ['@anthropic-ai/claude-agent-sdk', '0.3.316', 'SEE LICENSE IN README.md'],
  ['@cursor/sdk', '1.0.38', 'SEE LICENSE IN LICENSE.md; Cursor Terms of Service'],
  // Native metadata declares LICENSE.md but its published archive omits that file; retain the SDK license and complete stock native payload.
  ['@cursor/sdk-win32-x64', '1.0.38', 'SEE LICENSE IN LICENSE.md (published package license declaration)'],
  ['@google/gemini-cli', '0.66.0', 'Apache-2.0'], ['@modelcontextprotocol/sdk', '1.32.2', 'MIT'],
  ['@fontsource-variable/inter', '5.3.0', 'OFL-1.1'],
  ['@fontsource/caveat', '5.3.0', 'OFL-1.1'], ['@fontsource/dancing-script', '5.3.0', 'OFL-1.1'],
  ['@json-render/core', '0.21.3', 'Apache-2.0'], ['@json-render/react', '0.21.3', 'Apache-2.0'],
  ['@remote-dom/polyfill', '1.6.0', 'MIT'], ['@sinclair/typebox', '0.34.41', 'MIT'],
  ['ajv', '8.18.0', 'MIT'], ['fastify', '5.12.7', 'MIT'], ['lucide-react', '0.468.0', 'ISC'],
  ['pdf-lib', '1.17.1', 'MIT'], ['pdfjs-dist', '6.4.299', 'Apache-2.0'],
  ['react', '19.2.3', 'MIT'], ['react-dom', '19.2.3', 'MIT'], ['zod', '4.6.6', 'MIT'],
] as const;
