import type { ExecutionContext, ServiceContext, WorkflowNode } from "../types";
import { requestDecision, requestDecisions, type DecisionResult } from "../decision";
import { decisionThreshold, getDecisionNodeDefinition, getDecisionNodeQuestions, isBatchDecision, parseDecisionBranches, validateChoiceBranches } from "../decision-options";
import { replaceVariables } from "./utils";

export interface DecisionOutcome {
  result: DecisionResult;
  branch?: boolean | string;
  input: Record<string, unknown>;
}

/** Decision models use their own API keys, independently of the chat model. */
export async function handleDecisionNode(
  node: WorkflowNode, context: ExecutionContext, services: ServiceContext,
): Promise<DecisionOutcome> {
  const signal = services.abortSignal;
  signal?.throwIfAborted();
  const input = replaceVariables(node.properties.input || "", context);
  const prompt = replaceVariables(node.properties.prompt || "", context);
  const batch = isBatchDecision(node);
  const saveTo = node.properties.saveTo?.trim();
  if (batch && !saveTo) throw new Error("Batch decisions require saveTo");
  if (!batch && !prompt.trim()) throw new Error("Decision instructions are required");
  const questions = batch ? getDecisionNodeQuestions(node, context) : undefined;
  const definition = batch ? undefined : getDecisionNodeDefinition(node, context);
  const threshold = definition?.type === "score" || definition?.type === "noul"
    ? decisionThreshold(node, context, definition.type === "score" ? definition.criteria.length - 1 : 1) : undefined;
  if (definition?.type === "choice") validateChoiceBranches(parseDecisionBranches(node.properties.branches || ""), definition.criteria);

  const model = replaceVariables(node.properties.model || "gemini-decision-1", context).trim();
  let provider: "gemini" | "jev" | "openrouter";
  let apiKey: string | undefined;
  if (model === "gemini" || model === "gemini-decision-1") {
    provider = "gemini";
    apiKey = services.geminiApiKey;
  } else if (model === "jev" || model === "jev-latest") {
    provider = services.settings?.jev?.useOpenRouter ? "openrouter" : "jev";
    apiKey = provider === "openrouter" ? services.compatibleApiKeys?.openrouter : services.jevApiKey;
  } else if (model === "openrouter" || model === "~typesafe/jev-latest") {
    provider = "openrouter";
    apiKey = services.compatibleApiKeys?.openrouter;
  } else {
    throw new Error(`Unsupported decision model: ${model}`);
  }
  if (!apiKey) throw new Error(`${provider} decision API key is not configured or unlocked`);
  const config = { provider, apiKey, fetchImpl: fetch };
  const result = questions ? await requestDecisions(input, questions, config, signal)
    : await requestDecision(prompt, input, config, definition, signal);
  signal?.throwIfAborted();
  // The workflow variable store uses strings/numbers; objects remain available
  // through the existing lazy JSON property lookup (e.g. {{answers.urgency}}).
  if (saveTo) context.variables.set(saveTo, typeof result === "number" || typeof result === "string" ? result
    : typeof result === "boolean" ? String(result) : JSON.stringify(result));
  const branch = batch ? undefined : threshold !== undefined ? (result as number) >= threshold : result as boolean | string;
  return { result, branch, input: { input, model, ...(questions ? { questions } : { prompt, ...definition, threshold }) } };
}
