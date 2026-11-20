import { CompletePrompt } from 'aider-core';

/** Cấu hình bộ gọi LLM. Đọc từ biến môi trường để không hardcode endpoint. */
export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export const DEFAULT_BASE_URL = 'http://127.0.0.1:8317/v1';
export const DEFAULT_MODEL = 'glm-flash';

/**
 * Đọc cấu hình từ môi trường. `null` nghĩa là không có key, không gọi được.
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
 * Gọi một API tương thích OpenAI (`POST /chat/completions`). Không dùng SDK: CLI chỉ
 * cần một POST, và giữ phụ thuộc nhỏ.
 *
 * Model reasoning có thể tiêu hết ngân sách token vào phần suy luận rồi trả `content`
 * rỗng. Vì vậy khi `content` trống nhưng `finish_reason` là `length`, báo lỗi nêu rõ
 * nguyên nhân thay vì trả chuỗi rỗng cho tầng trên.
 */
export function createOpenAiCompatibleCompleter(
  config: LlmConfig,
  maxTokens = 4096
): CompletePrompt {
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
      const reasoning = choice?.message?.reasoning;
      const hint =
        finish === 'length'
          ? ' Model đã tiêu hết max_tokens vào phần suy luận trước khi trả lời; tăng max_tokens.'
          : '';
      throw new Error(
        `LLM trả về nội dung rỗng (finish_reason=${finish}, có reasoning=${Boolean(reasoning)}).${hint}`
      );
    }
    return text;
  };
}
