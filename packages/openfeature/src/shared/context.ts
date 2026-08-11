import {
	CHARGEBEE_CONTEXT_KEYS,
	type ChargebeeEvaluationMode,
	type ChargebeeTarget,
	type EvaluationContextLike,
} from "./types";

export function getTargetFromContext(
	context: EvaluationContextLike,
	defaultMode: ChargebeeEvaluationMode = "customer",
): ChargebeeTarget {
	const explicitMode = context[CHARGEBEE_CONTEXT_KEYS.evaluationMode];
	const mode =
		explicitMode === "customer" || explicitMode === "subscription"
			? explicitMode
			: defaultMode;
	const key =
		mode === "customer"
			? CHARGEBEE_CONTEXT_KEYS.customerId
			: CHARGEBEE_CONTEXT_KEYS.subscriptionId;
	const id = context[key];

	if (typeof id !== "string" || id.length === 0) {
		throw new Error(`Evaluation context requires a non-empty ${key}`);
	}

	return mode === "customer"
		? { mode, customerId: id }
		: { mode, subscriptionId: id };
}
