import { describe, expect, it, vi } from "vitest";
import { dispatchAlertWebhook, parseAlertWebhook } from "./alerts.js";
import type { ErrorSite } from "./types.js";

const SAMPLE_TRIGGERED = {
	id: "ev_in_alarm_1",
	event_type: "alert_status_changed",
	occurred_at: 1_700_000_000,
	content: {
		alert: {
			id: "alert_42",
			name: "100% of monthly quota",
			metered_feature_id: "feat_llm_tokens",
			subscription_id: "sub_acme",
			alarm_triggered_at: 1_699_999_900,
		},
		alert_status: {
			alert_id: "alert_42",
			subscription_id: "sub_acme",
			alert_status: "in_alarm",
			alarm_triggered_at: 1_699_999_950,
		},
	},
};

const SAMPLE_CLEARED = {
	id: "ev_within_limit_1",
	event_type: "alert_status_changed",
	occurred_at: 1_700_000_500,
	content: {
		alert: {
			id: "alert_42",
			metered_feature_id: "feat_llm_tokens",
		},
		alert_status: {
			alert_id: "alert_42",
			subscription_id: "sub_acme",
			alert_status: "within_limit",
		},
	},
};

describe("parseAlertWebhook", () => {
	it("returns a normalized event for alert_status_changed payloads", () => {
		const event = parseAlertWebhook(SAMPLE_TRIGGERED);
		expect(event).not.toBeNull();
		expect(event).toMatchObject({
			eventId: "ev_in_alarm_1",
			occurredAt: 1_700_000_000,
			alertId: "alert_42",
			alertName: "100% of monthly quota",
			meteredFeatureId: "feat_llm_tokens",
			subscriptionId: "sub_acme",
			status: "in_alarm",
			alarmTriggeredAt: 1_699_999_950,
		});
		expect(event?.raw).toBe(SAMPLE_TRIGGERED);
	});

	it("returns null for non-alert event types", () => {
		expect(
			parseAlertWebhook({
				id: "x",
				event_type: "subscription_created",
				content: {},
			}),
		).toBeNull();
	});

	it("returns null for non-object inputs", () => {
		expect(parseAlertWebhook(null)).toBeNull();
		expect(parseAlertWebhook("not-an-object")).toBeNull();
		expect(parseAlertWebhook(42)).toBeNull();
	});

	it("returns null when content.alert or content.alert_status is missing", () => {
		expect(
			parseAlertWebhook({
				event_type: "alert_status_changed",
				content: { alert: { id: "a" } },
			}),
		).toBeNull();
		expect(
			parseAlertWebhook({
				event_type: "alert_status_changed",
				content: { alert_status: { alert_id: "a" } },
			}),
		).toBeNull();
	});

	it("falls back to alert.alarm_triggered_at when status.alarm_triggered_at is absent", () => {
		const event = parseAlertWebhook({
			id: "x",
			event_type: "alert_status_changed",
			occurred_at: 1,
			content: {
				alert: {
					id: "a",
					metered_feature_id: "f",
					alarm_triggered_at: 12345,
				},
				alert_status: { alert_id: "a", alert_status: "in_alarm" },
			},
		});
		expect(event?.alarmTriggeredAt).toBe(12345);
	});

	it("uses safe defaults for missing optional fields", () => {
		const event = parseAlertWebhook({
			event_type: "alert_status_changed",
			content: {
				alert: {},
				alert_status: {},
			},
		});
		expect(event).toMatchObject({
			eventId: "",
			occurredAt: 0,
			alertId: "",
			alertName: undefined,
			meteredFeatureId: "",
			subscriptionId: undefined,
			status: "",
		});
	});
});

describe("dispatchAlertWebhook", () => {
	const noopOnError: (err: Error, where: ErrorSite) => void = () => {};

	it("returns null and invokes nothing for non-alert payloads", async () => {
		const handlers = {
			onAny: vi.fn(),
			onAlarmTriggered: vi.fn(),
			onAlarmCleared: vi.fn(),
		};
		const result = await dispatchAlertWebhook(
			{ event_type: "subscription_created" },
			handlers,
			noopOnError,
		);
		expect(result).toBeNull();
		expect(handlers.onAny).not.toHaveBeenCalled();
	});

	it("invokes onAlarmTriggered for in_alarm events", async () => {
		const handlers = {
			onAlarmTriggered: vi.fn(),
			onAlarmCleared: vi.fn(),
		};
		const result = await dispatchAlertWebhook(
			SAMPLE_TRIGGERED,
			handlers,
			noopOnError,
		);
		expect(handlers.onAlarmTriggered).toHaveBeenCalledTimes(1);
		expect(handlers.onAlarmCleared).not.toHaveBeenCalled();
		expect(result?.status).toBe("in_alarm");
	});

	it("invokes onAlarmCleared for within_limit events", async () => {
		const handlers = {
			onAlarmTriggered: vi.fn(),
			onAlarmCleared: vi.fn(),
		};
		await dispatchAlertWebhook(SAMPLE_CLEARED, handlers, noopOnError);
		expect(handlers.onAlarmCleared).toHaveBeenCalledTimes(1);
		expect(handlers.onAlarmTriggered).not.toHaveBeenCalled();
	});

	it("invokes onAny for every alert event regardless of status", async () => {
		const handlers = { onAny: vi.fn() };
		await dispatchAlertWebhook(SAMPLE_TRIGGERED, handlers, noopOnError);
		await dispatchAlertWebhook(SAMPLE_CLEARED, handlers, noopOnError);
		expect(handlers.onAny).toHaveBeenCalledTimes(2);
	});

	it("invokes onAny + status-specific handler for the same event", async () => {
		const handlers = {
			onAny: vi.fn(),
			onAlarmTriggered: vi.fn(),
		};
		await dispatchAlertWebhook(SAMPLE_TRIGGERED, handlers, noopOnError);
		expect(handlers.onAny).toHaveBeenCalledTimes(1);
		expect(handlers.onAlarmTriggered).toHaveBeenCalledTimes(1);
	});

	it("rethrows handler errors and reports via onError (so Chargebee retries)", async () => {
		const errors: Array<{ err: Error; where: ErrorSite }> = [];
		const onError = (err: Error, where: ErrorSite) => {
			errors.push({ err, where });
		};
		await expect(
			dispatchAlertWebhook(
				SAMPLE_TRIGGERED,
				{
					onAlarmTriggered: async () => {
						throw new Error("downstream failed");
					},
				},
				onError,
			),
		).rejects.toThrow("downstream failed");
		expect(errors).toHaveLength(1);
		expect(errors[0].where).toBe("alertHandler");
	});

	it("coerces non-Error throws to Error before reporting", async () => {
		const errors: Array<{ err: Error; where: ErrorSite }> = [];
		const onError = (err: Error, where: ErrorSite) => {
			errors.push({ err, where });
		};
		await expect(
			dispatchAlertWebhook(
				SAMPLE_TRIGGERED,
				{
					onAlarmTriggered: () => {
						throw { message: "plain object", code: "XYZ" };
					},
				},
				onError,
			),
		).rejects.toBeInstanceOf(Error);
		expect(errors[0].err.message).toBe("plain object");
	});

	it("stops invoking handlers after the first one throws", async () => {
		const second = vi.fn();
		const errors: Array<{ err: Error; where: ErrorSite }> = [];
		const onError = (err: Error, where: ErrorSite) => {
			errors.push({ err, where });
		};
		await expect(
			dispatchAlertWebhook(
				SAMPLE_TRIGGERED,
				{
					onAny: () => {
						throw new Error("first");
					},
					onAlarmTriggered: second,
				},
				onError,
			),
		).rejects.toThrow("first");
		expect(second).not.toHaveBeenCalled();
	});

	it("does nothing when no handler matches the event status", async () => {
		const result = await dispatchAlertWebhook(
			SAMPLE_TRIGGERED,
			{ onAlarmCleared: vi.fn() },
			noopOnError,
		);
		expect(result?.status).toBe("in_alarm");
	});
});
