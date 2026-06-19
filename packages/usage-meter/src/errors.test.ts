import { describe, expect, it, vi } from "vitest";
import { defaultOnError, formatError, safeSync, toError } from "./errors.js";

describe("toError", () => {
	it("returns Error instances unchanged", () => {
		const original = new Error("boom");
		expect(toError(original)).toBe(original);
	});

	it("preserves subclasses of Error", () => {
		class MyErr extends Error {
			code = "X";
		}
		const e = new MyErr("nope");
		const out = toError(e);
		expect(out).toBe(e);
		expect((out as MyErr).code).toBe("X");
	});

	it("coerces a plain object with a string message", () => {
		const raw = {
			message: "rate limited",
			http_status_code: 429,
			api_error_code: "throttled",
		};
		const out = toError(raw);
		expect(out).toBeInstanceOf(Error);
		expect(out.message).toBe("rate limited");
		expect((out as unknown as Record<string, unknown>).http_status_code).toBe(
			429,
		);
		expect((out as unknown as Record<string, unknown>).api_error_code).toBe(
			"throttled",
		);
	});

	it("falls back to error_msg / error / error_description", () => {
		expect(toError({ error_msg: "via error_msg" }).message).toBe(
			"via error_msg",
		);
		expect(toError({ error: "via error" }).message).toBe("via error");
		expect(toError({ error_description: "via desc" }).message).toBe("via desc");
	});

	it("uses (no message) when no usable string field is present", () => {
		expect(toError({ http_status_code: 500 }).message).toBe("(no message)");
	});

	it("ignores [object Object] poisoned messages", () => {
		const out = toError({ message: "[object Object]", api_error_code: "bad" });
		expect(out.message).toBe("(no message)");
		expect((out as unknown as Record<string, unknown>).api_error_code).toBe(
			"bad",
		);
	});

	it("ignores empty-string messages", () => {
		const out = toError({ message: "", error_msg: "fallback" });
		expect(out.message).toBe("fallback");
	});

	it("stringifies primitives", () => {
		expect(toError("plain string").message).toBe("plain string");
		expect(toError(42).message).toBe("42");
		expect(toError(null).message).toBe("null");
		expect(toError(undefined).message).toBe("undefined");
	});

	it("does not crash on a frozen object", () => {
		const raw = Object.freeze({ message: "frozen", code: "X" });
		const out = toError(raw);
		expect(out.message).toBe("frozen");
	});
});

describe("formatError", () => {
	it("returns null/undefined as strings", () => {
		expect(formatError(null)).toBe("null");
		expect(formatError(undefined)).toBe("undefined");
	});

	it("returns primitives via String()", () => {
		expect(formatError(42)).toBe("42");
		expect(formatError("err")).toBe("err");
	});

	it("formats a stock Error as just its message", () => {
		expect(formatError(new Error("oops"))).toBe("oops");
	});

	it("formats a named Error as 'Name: message'", () => {
		class RateLimitError extends Error {
			name = "RateLimitError";
		}
		expect(formatError(new RateLimitError("slow down"))).toBe(
			"RateLimitError: slow down",
		);
	});

	it("appends Chargebee metadata to the message", () => {
		const err = toError({
			message: "Validation failed",
			http_status_code: 400,
			api_error_code: "UBB_BATCH_INGESTION_VALIDATION_ERROR",
			type: "invalid_request",
		});
		const formatted = formatError(err);
		expect(formatted).toContain("Validation failed");
		expect(formatted).toContain("status=400");
		expect(formatted).toContain("code=UBB_BATCH_INGESTION_VALIDATION_ERROR");
		expect(formatted).toContain("type=invalid_request");
	});

	it("never produces literal [object Object]", () => {
		const err = toError({ message: "[object Object]", code: "EBAD" });
		expect(formatError(err)).not.toContain("[object Object]");
	});

	it("falls back to a constructor dump when there is no message or name", () => {
		class Weird {
			foo = 1;
			bar = "two";
		}
		const w = new Weird();
		const out = formatError(w);
		expect(out).toContain("Weird");
		expect(out).toContain("foo");
		expect(out).toContain("bar");
	});

	it("reports (no fields) when fully empty", () => {
		expect(formatError({})).toBe("Object (no fields)");
	});

	it("traverses error.cause", () => {
		const inner = new Error("root cause");
		const outer = new Error("higher up", { cause: inner });
		const out = formatError(outer);
		expect(out).toContain("higher up");
		expect(out).toContain("caused by:");
		expect(out).toContain("root cause");
	});
});

describe("safeSync", () => {
	it("returns the function result when it succeeds", () => {
		const onError = vi.fn();
		expect(safeSync(() => 42, onError, "record", -1)).toBe(42);
		expect(onError).not.toHaveBeenCalled();
	});

	it("returns the fallback and reports on throw", () => {
		const onError = vi.fn();
		const result = safeSync(
			() => {
				throw new Error("nope");
			},
			onError,
			"extractUsage",
			"fallback-value",
		);
		expect(result).toBe("fallback-value");
		expect(onError).toHaveBeenCalledTimes(1);
		expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
		expect((onError.mock.calls[0][0] as Error).message).toBe("nope");
		expect(onError.mock.calls[0][1]).toBe("extractUsage");
	});

	it("coerces non-Error throws via toError", () => {
		const onError = vi.fn();
		safeSync(
			() => {
				throw { message: "plain object", code: "X" };
			},
			onError,
			"record",
			null,
		);
		const err = onError.mock.calls[0][0] as Error;
		expect(err).toBeInstanceOf(Error);
		expect(err.message).toBe("plain object");
		expect((err as unknown as Record<string, unknown>).code).toBe("X");
	});
});

describe("defaultOnError", () => {
	it("writes a one-line warning to stderr without throwing", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			defaultOnError(new Error("boom"), "batchIngest");
			expect(spy).toHaveBeenCalledTimes(1);
			const message = String(spy.mock.calls[0][0]);
			expect(message).toContain("[chargebee/usage-meter]");
			expect(message).toContain("batchIngest");
			expect(message).toContain("boom");
		} finally {
			spy.mockRestore();
		}
	});

	it("dumps via console.dir when CHARGEBEE_USAGE_METER_DEBUG is set", () => {
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const dirSpy = vi.spyOn(console, "dir").mockImplementation(() => {});
		const previous = process.env.CHARGEBEE_USAGE_METER_DEBUG;
		process.env.CHARGEBEE_USAGE_METER_DEBUG = "1";
		try {
			defaultOnError(new Error("boom"), "record");
			expect(dirSpy).toHaveBeenCalledTimes(1);
		} finally {
			if (previous === undefined) {
				delete process.env.CHARGEBEE_USAGE_METER_DEBUG;
			} else {
				process.env.CHARGEBEE_USAGE_METER_DEBUG = previous;
			}
			errSpy.mockRestore();
			dirSpy.mockRestore();
		}
	});

	it("does not dump when CHARGEBEE_USAGE_METER_DEBUG is unset", () => {
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const dirSpy = vi.spyOn(console, "dir").mockImplementation(() => {});
		const previous = process.env.CHARGEBEE_USAGE_METER_DEBUG;
		delete process.env.CHARGEBEE_USAGE_METER_DEBUG;
		try {
			defaultOnError(new Error("boom"), "record");
			expect(dirSpy).not.toHaveBeenCalled();
		} finally {
			if (previous !== undefined) {
				process.env.CHARGEBEE_USAGE_METER_DEBUG = previous;
			}
			errSpy.mockRestore();
			dirSpy.mockRestore();
		}
	});
});
