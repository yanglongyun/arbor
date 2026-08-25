// Responses API 请求。
import { EVENTS } from './events.js';
const readError = async (response) => {
    const body = await response.text().catch(() => '');
    try { return JSON.parse(body)?.error?.message || body; } catch { return body; }
};

export async function request({ url, apiKey, model, input, instructions = '', tools = [], signal, onEvent = () => {}, errorMaxChars }) {
    if (!url || !apiKey || !model) throw new Error('缺少 Responses URL、API Key 或模型名');
    if (!Number.isInteger(errorMaxChars) || errorMaxChars <= 0) throw new Error('errorMaxChars 必须是正整数');
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, input, instructions, tools, stream: true }),
        signal,
    });
    if (!response.ok) throw new Error(`Responses API ${response.status}: ${(await readError(response)).slice(0, errorMaxChars)}`);
    if (!response.body) throw new Error('Responses API 返回空响应');

    const items = [];
    let usage = {};
    let buffer = '';
    const decoder = new TextDecoder();
    for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
            const raw = line.trim();
            if (!raw.startsWith('data:')) continue;
            const payload = raw.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            let event;
            try { event = JSON.parse(payload); } catch { continue; }
            if (event.type === 'response.output_text.delta') onEvent(EVENTS.MESSAGE, { delta: String(event.delta || '') });
            else if (event.type === 'response.reasoning_text.delta' || event.type === 'response.reasoning_summary_text.delta') {
                onEvent(EVENTS.REASONING, { delta: String(event.delta || '') });
            } else if (event.type === 'response.output_item.added' && event.item?.type === 'function_call') {
                onEvent(EVENTS.FUNCTION_CALL, { phase: 'started' });
            } else if (event.type === 'response.output_item.done' && event.item) {
                items.push(event.item);
            } else if (event.type === 'response.completed' || event.type === 'response.incomplete') {
                usage = event.response?.usage || {};
            } else if (event.type === 'response.failed') {
                throw new Error(event.response?.error?.message || '模型响应失败');
            }
        }
    }
    return { items, usage };
}
