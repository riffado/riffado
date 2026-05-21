export type PromptPreset =
    | "default"
    | "meetings"
    | "lectures"
    | "phone-calls"
    | "audio-blog"
    | "idea-stormer";

export interface PromptConfig {
    id: PromptPreset;
    name: string;
    description: string;
    prompt: string;
}

export interface CustomPrompt {
    id: string;
    name: string;
    prompt: string;
    createdAt: string;
}

export interface PromptConfiguration {
    selectedPrompt: string; // preset ID or custom prompt ID
    customPrompts: CustomPrompt[];
}
