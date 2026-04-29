/**
 * Internal — the React context handle. Lives in its own file so the
 * provider component and the hooks can both import it without
 * triggering `react-refresh/only-export-components`.
 */

import { createContext } from "react";
import type { AnalyticsProvider } from "./types";
import { nullAnalytics } from "./null";

export const AnalyticsContext = createContext<AnalyticsProvider>(nullAnalytics);
