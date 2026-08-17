import {
  GROK_MAX_TOOL_ARGUMENT_BYTES,
  GROK_MAX_TOOL_OUTPUT_BYTES,
  GROK_TOOL_TIMEOUT_MS,
} from "../../../shared/grok-chat-contract.mjs";

const ENCODER = new TextEncoder();
const TOOL_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export const GROK_TOOL_DEFINITIONS = Object.freeze([
  Object.freeze({
    type: "function",
    function: Object.freeze({
      name: "calculator",
      description: "Perform one bounded arithmetic operation on two finite numbers.",
      strict: true,
      parameters: Object.freeze({
        type: "object",
        additionalProperties: false,
        properties: Object.freeze({
          operation: Object.freeze({
            type: "string",
            enum: Object.freeze(["add", "subtract", "multiply", "divide"]),
          }),
          a: Object.freeze({ type: "number" }),
          b: Object.freeze({ type: "number" }),
        }),
        required: Object.freeze(["operation", "a", "b"]),
      }),
    }),
  }),
]);

export class GrokToolError extends Error {
  constructor(message, code = "provider_tool_invalid") {
    super(message);
    this.name = "GrokToolError";
    this.code = code;
    this.definitive = true;
  }
}

function byteLength(value) {
  return ENCODER.encode(String(value || "")).byteLength;
}

function parseArguments(raw) {
  if (typeof raw !== "string" || byteLength(raw) > GROK_MAX_TOOL_ARGUMENT_BYTES) {
    throw new GrokToolError("Tool arguments are invalid.", "provider_tool_arguments_invalid");
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new GrokToolError("Tool arguments are malformed.", "provider_tool_arguments_invalid");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new GrokToolError("Tool arguments are invalid.", "provider_tool_arguments_invalid");
  }
  return parsed;
}

function validateCalculatorArguments(value) {
  const keys = Object.keys(value);
  if (keys.length !== 3 || !keys.includes("operation") || !keys.includes("a") || !keys.includes("b")) {
    throw new GrokToolError("Calculator arguments are invalid.", "provider_tool_arguments_invalid");
  }
  if (!["add", "subtract", "multiply", "divide"].includes(value.operation)
    || typeof value.a !== "number" || !Number.isFinite(value.a)
    || typeof value.b !== "number" || !Number.isFinite(value.b)
    || Math.abs(value.a) > 1e15 || Math.abs(value.b) > 1e15) {
    throw new GrokToolError("Calculator arguments are invalid.", "provider_tool_arguments_invalid");
  }
  if (value.operation === "divide" && value.b === 0) {
    throw new GrokToolError("Division by zero is not allowed.", "provider_tool_execution_failed");
  }
  return { operation: value.operation, a: value.a, b: value.b };
}

function calculate({ operation, a, b }) {
  let result;
  if (operation === "add") result = a + b;
  else if (operation === "subtract") result = a - b;
  else if (operation === "multiply") result = a * b;
  else result = a / b;
  if (!Number.isFinite(result) || Math.abs(result) > Number.MAX_SAFE_INTEGER) {
    throw new GrokToolError("Calculator result is outside the supported range.", "provider_tool_execution_failed");
  }
  return { operation, a, b, result };
}

export async function executeGrokToolCall(toolCall) {
  if (!toolCall || typeof toolCall !== "object" || Array.isArray(toolCall)) {
    throw new GrokToolError("Tool call is invalid.");
  }
  const id = String(toolCall.id || "").trim();
  const name = String(toolCall.function?.name || "").trim();
  if (!/^call-[A-Za-z0-9_-]{1,180}$/.test(id) && !/^call_[A-Za-z0-9_-]{1,180}$/.test(id)) {
    throw new GrokToolError("Tool call id is invalid.");
  }
  if (!TOOL_NAME_PATTERN.test(name) || name !== "calculator") {
    throw new GrokToolError("Unknown tool requested.", "provider_tool_unknown");
  }
  const args = validateCalculatorArguments(parseArguments(toolCall.function?.arguments));
  let timeoutId;
  try {
    const output = await Promise.race([
      Promise.resolve().then(() => calculate(args)),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new GrokToolError(
          "Tool execution timed out.",
          "provider_tool_timeout"
        )), GROK_TOOL_TIMEOUT_MS);
      }),
    ]);
    const content = JSON.stringify(output);
    if (byteLength(content) > GROK_MAX_TOOL_OUTPUT_BYTES) {
      throw new GrokToolError("Tool output is too large.", "provider_tool_output_invalid");
    }
    return {
      id,
      name,
      arguments: args,
      content,
    };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
