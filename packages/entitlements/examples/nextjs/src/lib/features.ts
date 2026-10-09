import { Feature } from "@chargebee/entitlements";

// Shared by server and browser code. Defaults apply when Chargebee has no
// usable value, so they match the lowest tier.
export const advancedReports = new Feature("advanced-reports", false);
export const licensedSeats = new Feature("licensed-seats", 1);
export const apiCalls = new Feature("api-calls", 100);
export const supportTier = new Feature("support-tier", "community");

export const FEATURES = [advancedReports, licensedSeats, apiCalls, supportTier];
