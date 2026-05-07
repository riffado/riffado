#!/usr/bin/env bun
import { Command } from "commander";
import { authCommand } from "./commands/auth";
import { devicesCommand } from "./commands/devices";
import { recordingsCommand } from "./commands/recordings";
import { downloadCommand } from "./commands/download";
import { transcribeCommand } from "./commands/transcribe";
import { syncCommand } from "./commands/sync";
import { dictionaryCommand } from "./commands/dictionary";

const program = new Command()
    .name("openplaud")
    .description(
        "CLI for syncing and transcribing recordings from Plaud Note devices",
    )
    .version("0.1.0");

program.addCommand(authCommand);
program.addCommand(devicesCommand);
program.addCommand(recordingsCommand);
program.addCommand(downloadCommand);
program.addCommand(transcribeCommand);
program.addCommand(syncCommand);
program.addCommand(dictionaryCommand);

program.parse();
