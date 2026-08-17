/**
 * 模型层：把 Kimi K2.6 接入 LangChain。
 *
 * 核心洞察：LangChain 的 `ChatOpenAI` 说的是 "OpenAI 协议"，
 * Moonshot 的端点同样是 OpenAI 兼容协议，所以只需覆盖 `baseURL`
 * 就能把"调用 OpenAI"变成"调用 Kimi"，中间不需要任何翻译层。
 */
import { ChatOpenAI } from "@langchain/openai";

/** Moonshot（Kimi）的 OpenAI 兼容端点。 */
export const MOONSHOT_BASE_URL = "https://api.moonshot.cn/v1";

/** 默认模型名。 */
export const DEFAULT_MODEL = "kimi-k2.6";

/**
 * 创建一个指向 Kimi 的聊天模型。
 *
 * 缺少 `MOONSHOT_API_KEY` 时抛出清晰错误，而不是让底层 SDK
 * 报一个难懂的鉴权异常。
 */
export function createModel(model: string = DEFAULT_MODEL): ChatOpenAI {
  const apiKey = process.env.MOONSHOT_API_KEY;
  if (!apiKey) {
    throw new Error(
      "未找到 MOONSHOT_API_KEY。请复制 .env.example 为 .env 并填入你的 Kimi 密钥" +
        "（获取地址：https://platform.moonshot.cn/）。",
    );
  }

  return new ChatOpenAI({
    model,
    apiKey,
    // Kimi K2.6 只接受 temperature=1（传 0 会报 400 invalid temperature）。
    temperature: 1,
    configuration: {
      baseURL: MOONSHOT_BASE_URL,
    },
  });
}
