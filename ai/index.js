// 模型 → 工具 → 模型，直到模型不再调用工具。
import { request } from './responses.js';
import { runTools } from './runner.js';
import { EVENTS } from './events.js';

export { complete } from './complete.js';

export async function runAgent({
    runId,
    responsesUrl,
    apiKey,
    model,
    instructions = '',
    input,
    tools = [],
    executors = new Map(),
    maxRounds,
    errorMaxChars,
    workdir,
    env,
    signal,
    emit = () => {},
}) {
    if (!runId || !Array.isArray(input)) throw new Error('runId 和 input 必填');
    if (!Number.isInteger(maxRounds) || maxRounds <= 0) throw new Error('maxRounds 必须是正整数');

    try {
        const generated = [];
        for (let round = 0; round < maxRounds; round += 1) {
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

            const result = await request({
                url: responsesUrl,
                apiKey,
                model,
                input: [...input, ...generated],
                instructions: String(instructions),
                tools,
                signal,
                onEvent: emit,
                errorMaxChars,
            });

            const calls = result.items.filter((item) => item.type === 'function_call');
            result.items.forEach((item, index) => {
                generated.push(item);
                const usage = index === result.items.length - 1 ? result.usage : undefined;
                if (item.type === 'message') emit(EVENTS.MESSAGE, { item, usage });
                else if (item.type === 'reasoning') emit(EVENTS.REASONING, { item, usage });
                else if (item.type === 'function_call') emit(EVENTS.FUNCTION_CALL, { phase: 'completed', item, usage });
            });

            if (!calls.length) {
                emit(EVENTS.DONE, { runId, status: 'completed', usage: result.usage });
                return { items: generated, usage: result.usage };
            }

            const outputs = await runTools(calls, executors, {
                signal,
                cwd: workdir,
                env,
            });
            for (const item of outputs) {
                generated.push(item);
                emit(EVENTS.FUNCTION_CALL_OUTPUT, { item });
            }
        }
        throw new Error(`达到工具循环上限(${maxRounds})`);
    } catch (error) {
        if (signal?.aborted) emit(EVENTS.DONE, { runId, status: 'aborted' });
        else emit(EVENTS.ERROR, { runId, terminal: true, error: String(error?.message || error) });
        throw error;
    }
}
