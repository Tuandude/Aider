import { CompletePrompt } from 'aider-core';

/**
 * Gọi Gemini qua REST. Không thêm SDK: CLI chỉ cần một POST, và giữ phụ thuộc nhỏ.
 */
export function createGeminiCompleter(apiKey: string, model = 'gemini-2.0-flash'): CompletePrompt {
  return async (prompt: string): Promise<string> => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2 },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Gemini trả về ${response.status}: ${body.slice(0, 500)}`);
    }

    const data: any = await response.json();
    const text = data?.candidates?.[0]?.content?.parts
      ?.map((part: any) => part.text ?? '')
      .join('');
    if (!text) {
      throw new Error('Gemini trả về phản hồi rỗng.');
    }
    return text;
  };
}
