import { vi } from "vitest";
import type {
	CallContext,
	CanonicalUsage,
	ErrorSite,
	WrapContext,
} from "../types.js";

export interface FakeCtx {
	ctx: WrapContext;
	records: Array<{
		usage: Partial<CanonicalUsage>;
		callContext: CallContext | undefined;
	}>;
	errors: Array<{ err: Error; where: ErrorSite }>;
}

export function createFakeCtx(): FakeCtx {
	const records: FakeCtx["records"] = [];
	const errors: FakeCtx["errors"] = [];
	const ctx: WrapContext = {
		record: vi.fn((usage, callContext) => {
			records.push({ usage, callContext });
		}),
		onError: vi.fn((err, where) => {
			errors.push({ err, where });
		}),
	};
	return { ctx, records, errors };
}

export async function* asyncIter<T>(items: T[]): AsyncIterable<T> {
	for (const item of items) yield item;
}

export async function drain<T>(stream: AsyncIterable<T>): Promise<T[]> {
	const out: T[] = [];
	for await (const item of stream) out.push(item);
	return out;
}
