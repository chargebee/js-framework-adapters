import type { ErrorSite } from "./types.js";

/** Chargebee's documented `alert_status` values. */
export type AlertStatus = "in_alarm" | "within_limit" | (string & {});

/**
 * Normalized view of a Chargebee `alert_status_changed` webhook payload.
 * `raw` is the untouched event so callers can reach for fields we don't surface.
 */
export interface AlertWebhookEvent {
	eventId: string;
	occurredAt: number;
	alertId: string;
	alertName?: string;
	meteredFeatureId: string;
	subscriptionId?: string;
	status: AlertStatus;
	alarmTriggeredAt?: number;
	raw: unknown;
}

/** Handlers for each transition. All are optional; missing ones are no-ops. */
export interface AlertHandlers {
	/** Status transitioned to `in_alarm` (e.g. customer crossed a hard cap). */
	onAlarmTriggered?: (event: AlertWebhookEvent) => void | Promise<void>;
	/** Status transitioned to `within_limit` (e.g. cap was raised or cycle reset). */
	onAlarmCleared?: (event: AlertWebhookEvent) => void | Promise<void>;
	/** Fires for every alert event regardless of status. Useful for logging. */
	onAny?: (event: AlertWebhookEvent) => void | Promise<void>;
}

/**
 * Parse a Chargebee webhook payload. Returns `null` if the payload isn't an
 * `alert_status_changed` event (so it's safe to call on every webhook).
 */
export function parseAlertWebhook(payload: unknown): AlertWebhookEvent | null {
	if (!isObject(payload)) return null;
	if (payload.event_type !== "alert_status_changed") return null;

	const content = isObject(payload.content) ? payload.content : undefined;
	const alert = isObject(content?.alert) ? content.alert : undefined;
	const status = isObject(content?.alert_status)
		? content.alert_status
		: undefined;
	if (!alert || !status) return null;

	return {
		eventId: typeof payload.id === "string" ? payload.id : "",
		occurredAt:
			typeof payload.occurred_at === "number" ? payload.occurred_at : 0,
		alertId: str(status.alert_id) ?? str(alert.id) ?? "",
		alertName: str(alert.name),
		meteredFeatureId: str(alert.metered_feature_id) ?? "",
		subscriptionId: str(status.subscription_id) ?? str(alert.subscription_id),
		status: (str(status.alert_status) ?? "") as AlertStatus,
		alarmTriggeredAt:
			typeof status.alarm_triggered_at === "number"
				? status.alarm_triggered_at
				: typeof alert.alarm_triggered_at === "number"
					? alert.alarm_triggered_at
					: undefined,
		raw: payload,
	};
}

/**
 * Dispatch a parsed alert event to the matching handler(s). Errors thrown
 * from a handler are routed to `onError` and **rethrown** — webhook handlers
 * should surface failures so Chargebee can retry the delivery.
 */
export async function dispatchAlertWebhook(
	payload: unknown,
	handlers: AlertHandlers,
	onError: (err: Error, where: ErrorSite) => void,
): Promise<AlertWebhookEvent | null> {
	const event = parseAlertWebhook(payload);
	if (!event) return null;

	const callers: Array<() => Promise<void> | void> = [];
	if (handlers.onAny) callers.push(() => handlers.onAny?.(event));
	if (event.status === "in_alarm" && handlers.onAlarmTriggered) {
		callers.push(() => handlers.onAlarmTriggered?.(event));
	}
	if (event.status === "within_limit" && handlers.onAlarmCleared) {
		callers.push(() => handlers.onAlarmCleared?.(event));
	}

	for (const call of callers) {
		try {
			await call();
		} catch (err) {
			const wrapped = err instanceof Error ? err : new Error(String(err));
			onError(wrapped, "alertHandler");
			throw wrapped;
		}
	}
	return event;
}

function isObject(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === "object";
}

function str(v: unknown): string | undefined {
	return typeof v === "string" && v.length > 0 ? v : undefined;
}
