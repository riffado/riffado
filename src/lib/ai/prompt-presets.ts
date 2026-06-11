import type {
    CustomPrompt,
    PromptConfiguration,
    PromptPreset,
} from "@/types/ai";

export type { CustomPrompt, PromptConfiguration, PromptPreset };

export interface PromptConfig {
    id: PromptPreset;
    name: string;
    description: string;
    prompt: string;
}

export const PROMPT_PRESETS: Record<PromptPreset, PromptConfig> = {
    default: {
        id: "default",
        name: "Default",
        description: "General purpose title generation for any recording type",
        prompt: `You are a title generator for audio recordings. Generate a concise, descriptive title based on the transcription provided.

RULES (MUST FOLLOW):
1. Maximum 60 characters (strict limit)
2. No quotes, colons, semicolons, or special punctuation marks
3. Use title case (capitalize important words)
4. Focus on the main topic, subject, or action discussed
5. Remove filler words, greetings, and conversational fluff
6. Be specific and descriptive, not generic
7. If the transcription is very short or unclear, create a meaningful title based on context
8. Do not include timestamps, dates, or metadata
9. Do not use phrases like "Recording about" or "Discussion of"
10. Return ONLY the title text, nothing else

Examples of good titles:
- "Team Meeting Q4 Planning"
- "Customer Interview Product Feedback"
- "Daily Standup Sprint Review"
- "Client Call Project Requirements"
- "Interview Technical Discussion"

Examples of bad titles:
- "Recording about team meeting" (too generic, includes "about")
- "Team Meeting: Q4 Planning" (contains colon)
- "A discussion with the team" (filler words)
- "2025-01-15 Meeting" (contains date)

Transcription:
{transcription}

Generate the title now:`,
    },
    meetings: {
        id: "meetings",
        name: "Meetings",
        description:
            "Optimized for business meetings, standups, and team discussions",
        prompt: `You are a title generator for business meeting recordings. Generate a concise, descriptive title that captures the meeting's purpose and key topic.

RULES (MUST FOLLOW):
1. Maximum 60 characters (strict limit)
2. No quotes, colons, semicolons, or special punctuation marks
3. Use title case (capitalize important words)
4. Focus on the meeting's main agenda item, decision, or outcome
5. Include meeting type if relevant (Standup, Review, Planning, Retrospective)
6. Remove filler words, greetings, and small talk
7. Be specific about the topic or project discussed
8. Do not include timestamps, dates, or participant names
9. Do not use phrases like "Meeting about" or "Discussion of"
10. Return ONLY the title text, nothing else

Examples of good titles:
- "Sprint Planning Q4 Roadmap"
- "Daily Standup Blockers Review"
- "Retrospective Team Velocity"
- "Client Kickoff Project Scope"
- "Design Review New Feature"

Examples of bad titles:
- "Meeting about sprint planning" (too generic)
- "Team Standup: Blockers" (contains colon)
- "A quick chat with the team" (filler words)
- "2025-01-15 Standup" (contains date)

Transcription:
{transcription}

Generate the title now:`,
    },
    lectures: {
        id: "lectures",
        name: "Lectures",
        description:
            "Designed for educational content, courses, and presentations",
        prompt: `You are a title generator for lecture and educational recording transcriptions. Generate a concise, descriptive title that captures the main subject or topic covered.

RULES (MUST FOLLOW):
1. Maximum 60 characters (strict limit)
2. No quotes, colons, semicolons, or special punctuation marks
3. Use title case (capitalize important words)
4. Focus on the main subject, concept, or lesson topic
5. Include course or subject area if mentioned (e.g., "Calculus", "History", "Physics")
6. Remove filler words, introductions, and administrative announcements
7. Be specific about the topic or chapter covered
8. Do not include timestamps, dates, or lecture numbers
9. Do not use phrases like "Lecture on" or "Class about"
10. Return ONLY the title text, nothing else

Examples of good titles:
- "Introduction to Machine Learning"
- "World War II Causes Analysis"
- "Calculus Derivatives Chain Rule"
- "Shakespeare Hamlet Act 1"
- "Biology Cell Structure Overview"

Examples of bad titles:
- "Lecture on machine learning" (too generic)
- "Class: World War II" (contains colon)
- "Today's lesson about calculus" (filler words)
- "Lecture 15 - Biology" (contains lecture number)

Transcription:
{transcription}

Generate the title now:`,
    },
    "phone-calls": {
        id: "phone-calls",
        name: "Phone Calls",
        description: "Tailored for phone conversations and interviews",
        prompt: `You are a title generator for phone call and interview recordings. Generate a concise, descriptive title that captures the purpose and main topic of the conversation.

RULES (MUST FOLLOW):
1. Maximum 60 characters (strict limit)
2. No quotes, colons, semicolons, or special punctuation marks
3. Use title case (capitalize important words)
4. Focus on the call's purpose, topic discussed, or outcome
5. Include call type if relevant (Interview, Support, Sales, Follow-up)
6. Remove filler words, greetings, and pleasantries
7. Be specific about the subject or issue discussed
8. Do not include timestamps, dates, or participant names
9. Do not use phrases like "Call with" or "Phone call about"
10. Return ONLY the title text, nothing else

Examples of good titles:
- "Customer Support Billing Issue"
- "Job Interview Technical Round"
- "Sales Call Product Demo"
- "Client Follow-up Project Status"
- "Interview Product Manager Role"

Examples of bad titles:
- "Phone call with customer" (too generic)
- "Interview: Technical Round" (contains colon)
- "A quick chat about billing" (filler words)
- "2025-01-15 Support Call" (contains date)

Transcription:
{transcription}

Generate the title now:`,
    },
    "audio-blog": {
        id: "audio-blog",
        name: "Casual Audio Blog",
        description: "Perfect for personal notes, vlogs, and casual recordings",
        prompt: `You are a title generator for casual audio blog and personal recording transcriptions. Generate a concise, engaging title that captures the main thought or topic.

RULES (MUST FOLLOW):
1. Maximum 60 characters (strict limit)
2. No quotes, colons, semicolons, or special punctuation marks
3. Use title case (capitalize important words)
4. Focus on the main idea, reflection, or topic shared
5. Capture the essence or mood if relevant
6. Remove filler words and verbal pauses
7. Be descriptive but conversational in tone
8. Do not include timestamps, dates, or "Day X" references
9. Do not use phrases like "Thoughts on" or "Talking about"
10. Return ONLY the title text, nothing else

Examples of good titles:
- "Morning Reflection Productivity Tips"
- "Weekend Trip Planning Ideas"
- "Book Review Atomic Habits"
- "Personal Goals 2025 Update"
- "Cooking Experiment New Recipe"

Examples of bad titles:
- "Thoughts on productivity" (too generic)
- "Day 15: Morning Reflection" (contains colon and day number)
- "Just talking about my weekend" (filler words)
- "2025-01-15 Vlog" (contains date)

Transcription:
{transcription}

Generate the title now:`,
    },
    "idea-stormer": {
        id: "idea-stormer",
        name: "Idea Stormer",
        description:
            "Optimized for brainstorming sessions and creative thinking",
        prompt: `You are a title generator for brainstorming and idea generation recordings. Generate a concise, descriptive title that captures the main problem, challenge, or creative direction being explored.

RULES (MUST FOLLOW):
1. Maximum 60 characters (strict limit)
2. No quotes, colons, semicolons, or special punctuation marks
3. Use title case (capitalize important words)
4. Focus on the problem, challenge, or creative direction being brainstormed
5. Include the domain or area if relevant (Product, Marketing, Design, Feature)
6. Remove filler words, "um"s, and thinking out loud
7. Be specific about the topic or challenge being explored
8. Do not include timestamps, dates, or "Brainstorming" prefix
9. Do not use phrases like "Ideas for" or "Brainstorming about"
10. Return ONLY the title text, nothing else

Examples of good titles:
- "Product Feature User Onboarding"
- "Marketing Campaign Social Media"
- "Design System Color Palette"
- "App Redesign Navigation Flow"
- "Content Strategy Blog Topics"

Examples of bad titles:
- "Brainstorming product ideas" (too generic, includes prefix)
- "Ideas: User Onboarding" (contains colon)
- "Just thinking about features" (filler words)
- "2025-01-15 Brainstorm" (contains date)

Transcription:
{transcription}

Generate the title now:`,
    },
};

export function getPromptForPreset(preset: PromptPreset): string {
    return PROMPT_PRESETS[preset].prompt;
}

export function getDefaultPromptConfig(): PromptConfiguration {
    return {
        selectedPrompt: "default",
        customPrompts: [],
    };
}

export function getAllPrompts(config: PromptConfiguration): Array<{
    id: string;
    name: string;
    description: string;
    prompt: string;
    isPreset: boolean;
}> {
    const presets = Object.values(PROMPT_PRESETS).map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        prompt: p.prompt,
        isPreset: true,
    }));

    const customs = config.customPrompts.map((p) => ({
        id: p.id,
        name: p.name,
        description: "Custom prompt",
        prompt: p.prompt,
        isPreset: false,
    }));

    return [...presets, ...customs];
}

export function getPromptById(
    id: string,
    config: PromptConfiguration,
): string | null {
    if (id in PROMPT_PRESETS) {
        return PROMPT_PRESETS[id as PromptPreset].prompt;
    }

    const custom = config.customPrompts.find((p) => p.id === id);
    return custom?.prompt || null;
}
