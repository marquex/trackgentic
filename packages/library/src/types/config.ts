/**
 * Configuration file stored at `.trackgentic/config.json`.
 */
export interface ConfigFile {
  auth: {
    mode: "open" | "read-only" | "strict";
    defaultUser: string;
  };
}
