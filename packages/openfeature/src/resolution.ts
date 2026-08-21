import type { EntitlementResolution } from "@chargebee/entitlements";

/**
 * Adapts an SDK-agnostic {@link EntitlementResolution} into the
 * `ResolutionDetails` shape both OpenFeature SDKs expect. The server and web
 * SDKs declare structurally identical but nominally distinct `ErrorCode`
 * enums, so the target error code type is a generic parameter instead of a
 * hard dependency on either SDK package.
 */
export function toResolutionDetails<T, TErrorCode>(
	resolution: EntitlementResolution<T>,
): Omit<EntitlementResolution<T>, "errorCode"> & { errorCode?: TErrorCode } {
	return {
		...resolution,
		errorCode: resolution.errorCode as unknown as TErrorCode | undefined,
	};
}
