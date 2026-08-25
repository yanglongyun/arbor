// 工具调用消息专门放在这个文件来执行。
// 接收工具调用数组，返回工具结果数组。
const parse = (value) => {
    if (value && typeof value === 'object') return value;
    try { return JSON.parse(String(value || '{}')); } catch { return {}; }
};

export async function runTools(calls = [], toolHandlers, context = {}) {
    const results = [];
    for (const call of calls) {
        if (context.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const name = String(call.name || '');
        const execute = toolHandlers.get(name);
        let result;
        try {
            result = typeof execute === 'function'
                ? await execute(parse(call.arguments), context)
                : { error: `未知工具:${name}` };
        } catch (error) {
            if (error?.name === 'AbortError' || context.signal?.aborted) throw error;
            result = { error: error?.message || String(error) };
        }
        results.push({
            type: 'function_call_output',
            call_id: String(call.call_id || ''),
            output: typeof result === 'string' ? result : JSON.stringify(result),
        });
    }
    return results;
}
