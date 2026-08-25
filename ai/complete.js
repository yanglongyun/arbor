// 一次性无工具补全，适用于摘要和标题。
import { request } from './responses.js';

export async function complete({
    responsesUrl,
    apiKey,
    model,
    instructions = '',
    input,
    errorMaxChars,
    signal,
}) {
    if (!Array.isArray(input)) throw new Error('input 必须是数组');

    const result = await request({
        url: responsesUrl,
        apiKey,
        model,
        input,
        instructions: String(instructions),
        tools: [],
        signal,
        errorMaxChars,
    });
    const text = result.items
        .filter((item) => item.type === 'message')
        .flatMap((item) => Array.isArray(item.content) ? item.content : [])
        .map((part) => part.text || '')
        .join('');

    return { text, usage: result.usage };
}
