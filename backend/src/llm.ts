import type { CompletePrompt } from 'aider-core';

/** Cấu hình bộ gọi LLM, đọc từ biến môi trường. */
export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export const DEFAULT_BASE_URL = 'https://api-cdn.deploy.com/api/v1';
export const DEFAULT_MODEL = 'zai-org/glm-5.3-flash';

/**
 * Đọc cấu hình LLM. `null` nghĩa là server không gọi được mô hình nào.
 */
export function readLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig | null {
  const apiKey = env.AIDER_LLM_API_KEY;
  if (!apiKey) {
    return null;
  }
  return {
    baseUrl: (env.AIDER_LLM_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, ''),
    apiKey,
    model: env.AIDER_LLM_MODEL ?? DEFAULT_MODEL,
  };
}

/**
 * Gọi API tương thích OpenAI (`POST /chat/completions`).
 *
 * Model reasoning có thể tiêu hết ngân sách token vào phần suy luận rồi trả `content`
 * rỗng. Báo lỗi nêu rõ nguyên nhân thay vì để tầng trên nhận chuỗi rỗng.
 */
export function createCompleter(config: LlmConfig, maxTokens = 4096): CompletePrompt {
  return async (prompt: string): Promise<string> => {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`LLM trả về ${response.status}: ${body.slice(0, 500)}`);
    }

    const data: any = await response.json();
    const choice = data?.choices?.[0];
    const text: string | null | undefined = choice?.message?.content;

    if (!text || text.trim() === '') {
      const finish = choice?.finish_reason ?? 'không rõ';
      const hint =
        finish === 'length'
          ? ' Model đã tiêu hết max_tokens vào phần suy luận trước khi trả lời; tăng max_tokens.'
          : '';
      throw new Error(`LLM trả về nội dung rỗng (finish_reason=${finish}).${hint}`);
    }
    return text;
  };
}

/** Bóc JSON khỏi phản hồi, chấp nhận cả khi model bọc trong hàng rào markdown. */
export function parseJsonResponse(raw: string): any {
  const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
  return JSON.parse(cleaned);
}
