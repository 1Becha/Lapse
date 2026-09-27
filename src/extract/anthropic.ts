import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.ts';
import { CONTRACT_TERMS_JSON_SCHEMA, ContractTermsSchema, SYSTEM_PROMPT, type ContractTerms } from './schema.ts';

let client: Anthropic | null = null;

// Claude reads the PDF itself (including scanned pages), so no text layer is required.
export async function extractWithClaude(pdf: Uint8Array, today: string): Promise<ContractTerms> {
  client ??= new Anthropic();
  const response = await client.beta.messages.create({
    model: config.anthropicModel,
    max_tokens: 16000,
    // If a safety classifier declines, the API retries on its recommended fallback model.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM_PROMPT,
    output_config: { format: { type: 'json_schema', schema: CONTRACT_TERMS_JSON_SCHEMA } },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(pdf).toString('base64') },
          },
          { type: 'text', text: `Today is ${today}. Extract the renewal and cancellation terms of this document.` },
        ],
      },
    ],
  });

  if (response.stop_reason === 'refusal') throw new Error('Claude declined to process this document');
  if (response.stop_reason === 'max_tokens') throw new Error('Claude response was cut off');

  const json = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  return ContractTermsSchema.parse(JSON.parse(json));
}
