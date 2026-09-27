import { config } from '../config.ts';
import { CONTRACT_TERMS_JSON_SCHEMA, ContractTermsSchema, SYSTEM_PROMPT, type ContractTerms } from './schema.ts';

interface OllamaChatResponse {
  message?: { content?: string };
  error?: string;
}

// Local LLM via Ollama: the contract never leaves your machine. Needs the PDF's text layer.
export async function extractWithOllama(text: string, today: string): Promise<ContractTerms> {
  if (!config.ollamaUrl) throw new Error('OLLAMA_URL is not configured');
  const res = await fetch(`${config.ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: config.ollamaModel,
      stream: false,
      format: CONTRACT_TERMS_JSON_SCHEMA,
      options: { temperature: 0, num_ctx: 32768 },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Today is ${today}. Extract the renewal and cancellation terms of this document.\n\n<document>\n${text}\n</document>` },
      ],
    }),
    signal: AbortSignal.timeout(300_000),
  });
  const data = (await res.json()) as OllamaChatResponse;
  if (!res.ok || data.error) throw new Error(`Ollama: ${data.error ?? res.status}`);
  return ContractTermsSchema.parse(JSON.parse(data.message?.content ?? ''));
}
