import { defineCommand, runMain } from "citty";
import login from "./commands/login.js";
import logout from "./commands/logout.js";
import recordings from "./commands/recordings/index.js";
import whoami from "./commands/whoami.js";
import { ApiError, NetworkError } from "./lib/client.js";
import { ConfigNotFoundError } from "./lib/config.js";
import { printError } from "./lib/output.js";
import { VERSION } from "./lib/version.js";

const main = defineCommand({
    meta: {
        name: "riffado",
        version: VERSION,
        description: "Command-line interface for Riffado.",
    },
    subCommands: {
        login,
        logout,
        whoami,
        recordings,
    },
});

// Wrap runMain so domain errors land as one-line messages instead of citty's
// stack-trace defaults.
runMain(main).catch((error: unknown) => {
    if (error instanceof ConfigNotFoundError) {
        printError(error.message);
        process.exit(1);
    }
    if (error instanceof ApiError) {
        printError(`${error.message} (HTTP ${error.status})`, error.code);
        process.exit(1);
    }
    if (error instanceof NetworkError) {
        printError(error.message);
        process.exit(1);
    }
    printError(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
