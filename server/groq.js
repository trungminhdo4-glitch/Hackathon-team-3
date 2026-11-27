import { getGroqKey, META_MODEL } from './models.js';

export async function assessWithLlama({ instructions, input, schema, maxTokens, signal }) {
  const key = getGroqKey();
  if (!key) {
    throw new Error('A separate Groq API key is required for Meta assessments.');
  }
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    redirect: 'error',
    signal,
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: META_MODEL,
      messages: [
        { role: 'system', content: instructions + '\nReturn one JSON object matching this exact JSON Schema:\n' + JSON.stringify(schema) },
        { role: 'user', content: input },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_completion_tokens: maxTokens,
    }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    const error = new Error('Meta assessment request failed (HTTP ' + response.status + ').');
    error.status = response.status;
    throw error;
  }
  try {
    const result = await response.json();
    const choice = result.choices?.[0];
    if (choice?.finish_reason === 'stop' && typeof choice.message?.content === 'string') {
      return JSON.parse(choice.message.content);
    }
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (!(error instanceof SyntaxError)) throw error;
  }
  throw new Error('Meta returned an incomplete or invalid JSON assessment.');
}
