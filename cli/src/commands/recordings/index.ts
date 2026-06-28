import { defineCommand } from "citty";
import download from "./download.js";
import get from "./get.js";
import list from "./list.js";

export default defineCommand({
    meta: {
        name: "recordings",
        description: "List, fetch, and download your Riffado recordings.",
    },
    subCommands: {
        list,
        get,
        download,
    },
});
