import { Command } from "commander";
import { requireConfig } from "../config";
import { createClient } from "../client";

export const devicesCommand = new Command("devices")
    .description("List Plaud devices connected to your account")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
        const config = requireConfig();
        const client = createClient(config);

        try {
            const response = await client.listDevices();
            const devices = response.data_devices;

            if (opts.json) {
                console.log(JSON.stringify(devices, null, 2));
                return;
            }

            if (devices.length === 0) {
                console.log("No devices found on this account.");
                return;
            }

            console.log(`Found ${devices.length} device(s):\n`);
            for (const device of devices) {
                console.log(`  ${device.name || "(unnamed)"}`);
                console.log(`    Serial:  ${device.sn}`);
                console.log(`    Model:   ${device.model}`);
                console.log(`    Version: ${device.version_number}`);
                console.log("");
            }
        } catch (err) {
            console.error(
                `Failed to list devices: ${err instanceof Error ? err.message : String(err)}`,
            );
            process.exit(1);
        }
    });
