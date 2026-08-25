// AI 内核的输出事件契约。
export const EVENTS = Object.freeze({
    MESSAGE: 'message',
    REASONING: 'reasoning',
    FUNCTION_CALL: 'function_call',
    FUNCTION_CALL_OUTPUT: 'function_call_output',
    DONE: 'done',
    ERROR: 'error',
});
