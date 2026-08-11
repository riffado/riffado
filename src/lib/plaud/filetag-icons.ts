import {
    Activity,
    AudioLines,
    AudioWaveform,
    Award,
    Book,
    BookOpen,
    Briefcase,
    Calendar,
    CalendarClock,
    Camera,
    Captions,
    Car,
    ChartColumn,
    CircleUserRound,
    ClipboardList,
    ClipboardPlus,
    Cloud,
    Contact,
    Database,
    FilePen,
    Flower,
    Folder,
    FolderUp,
    Gamepad2,
    Gavel,
    Globe,
    Heart,
    HeartPulse,
    House,
    Image,
    Inbox,
    Languages,
    Lightbulb,
    List,
    ListTodo,
    type LucideIcon,
    MapPin,
    MessageSquare,
    Mic,
    Mountain,
    Music,
    PencilRuler,
    Phone,
    Receipt,
    Scale,
    Shapes,
    SlidersHorizontal,
    Smile,
    Sparkles,
    Speech,
    Star,
    Stethoscope,
    StickyNote,
    Tag,
    User,
    Users,
    UsersRound,
    Video,
    Webcam,
} from "lucide-react";

/** Fixed 7-color palette used by the official Plaud app for directories. */
export const PLAUD_FILETAG_COLORS = [
    "#191919",
    "#4c8eff",
    "#46cf6c",
    "#f9a251",
    "#3dc8c8",
    "#fb5c5c",
    "#c149eb",
] as const;

export const DEFAULT_FILETAG_COLOR = "#191919";
export const DEFAULT_FILETAG_ICON = "iconfont_folder_foler_1";

/**
 * Canonical Plaud directory icon names -> closest lucide equivalents.
 * Names (including the `foler_1` typo) are reverse-engineered from the
 * web.plaud.ai bundle; the DB stores only these canonical names.
 */
export const PLAUD_FILETAG_ICON_MAP: Record<string, LucideIcon> = {
    iconfont_folder_foler_1: Folder,
    iconfont_folder_booknote: BookOpen,
    iconfont_folder_gamepad: Gamepad2,
    iconfont_folder_meeting: UsersRound,
    iconfont_folder_call: Phone,
    iconfont_folder_favourite: Heart,
    iconfont_folder_reward: Award,
    iconfont_folder_comment: MessageSquare,
    iconfont_folder_note: StickyNote,
    iconfont_folder_cloud: Cloud,
    iconfont_folder_home: House,
    iconfont_folder_global: Globe,
    iconfont_folder_record: Mic,
    iconfont_folder_contact: Contact,
    iconfont_folder_camera: Camera,
    iconfont_folder_camcorder: Video,
    iconfont_folder_music: Music,
    iconfont_folder_starred: Star,
    iconfont_folder_user: User,
    iconfont_folder_tag: Tag,
    iconfont_folder_database: Database,
    iconfont_folder_contact_1: CircleUserRound,
    iconfont_a_folder_uploadfile: FolderUp,
    iconfont_a_foldericon_list: List,
    iconfont_a_folder_assignment: ClipboardList,
    iconfont_a_folder_tasklist: ListTodo,
    iconfont_folder_pacemaker: Activity,
    iconfont_folder_ecg: HeartPulse,
    iconfont_folder_stethoscope: Stethoscope,
    iconfont_a_foldericon_location: MapPin,
    iconfont_a_foldericon_image: Image,
    iconfont_folder_view: Mountain,
    iconfont_folder_flower: Flower,
    iconfont_folder_handbag: Briefcase,
    iconfont_folder_car: Car,
    iconfont_folder_calendar: Calendar,
    iconfont_a_folder_calendarclock: CalendarClock,
    iconfont_folder_ai_prompt: Sparkles,
    iconfont_folder_analysis: ChartColumn,
    iconfont_a_folder_balance: Scale,
    iconfont_a_foldericon_interests: Shapes,
    iconfont_a_foldericon_mood: Smile,
    iconfont_a_folder_voicechat: AudioLines,
    iconfont_a_folder_videomeeting: Webcam,
    iconfont_folder_speech: Speech,
    iconfont_folder_clinical_notes: ClipboardPlus,
    iconfont_a_foldericon_interpreter_mode: Languages,
    iconfont_folder_adaptive_audio_mic: AudioWaveform,
    iconfont_folder_ground: UsersRound,
    iconfont_a_foldericon_idea: Lightbulb,
    iconfont_folder_communication: Users,
    iconfont_folder_speech_to_text: Captions,
    iconfont_a_foldericon_invoicedollar: Receipt,
    iconfont_folder_file: FilePen,
    iconfont_a_folder_movetoinbox: Inbox,
    iconfont_folder_display_settings: SlidersHorizontal,
    iconfont_folder_finalize: Gavel,
    iconfont_folder_book: Book,
    iconfont_folder_pencil_ruler: PencilRuler,
};

export const PLAUD_FILETAG_ICON_NAMES = Object.keys(PLAUD_FILETAG_ICON_MAP);

/**
 * Legacy iconfont codepoints -> canonical names. Older Plaud servers return
 * a raw codepoint instead of the semantic name. Reverse-engineered from the
 * name/codepoint arrays in the web.plaud.ai bundle; codepoints reused across
 * font generations keep their first-generation meaning.
 */
export const LEGACY_CODEPOINT_MAP: Record<string, string> = {
    e627: "iconfont_folder_foler_1",
    e711: "iconfont_folder_booknote",
    e708: "iconfont_folder_gamepad",
    e607: "iconfont_folder_meeting",
    e69c: "iconfont_folder_call",
    e743: "iconfont_folder_favourite",
    e60f: "iconfont_folder_reward",
    e72d: "iconfont_folder_comment",
    e717: "iconfont_folder_note",
    e733: "iconfont_folder_cloud",
    e619: "iconfont_folder_home",
    e60c: "iconfont_folder_global",
    e61c: "iconfont_folder_record",
    e70e: "iconfont_folder_contact",
    e634: "iconfont_folder_camera",
    e73a: "iconfont_folder_camcorder",
    e745: "iconfont_folder_music",
    e625: "iconfont_folder_starred",
    e741: "iconfont_folder_user",
    e742: "iconfont_folder_tag",
    e744: "iconfont_folder_database",
    e62a: "iconfont_folder_contact_1",
    e631: "iconfont_a_folder_uploadfile",
    e623: "iconfont_a_foldericon_list",
    e620: "iconfont_a_folder_assignment",
    e62b: "iconfont_a_folder_tasklist",
    e61f: "iconfont_folder_pacemaker",
    e603: "iconfont_folder_ecg",
    e60d: "iconfont_folder_stethoscope",
    e61e: "iconfont_a_foldericon_location",
    e628: "iconfont_a_foldericon_image",
    e616: "iconfont_folder_view",
    e62e: "iconfont_folder_flower",
    e604: "iconfont_folder_handbag",
    e606: "iconfont_folder_car",
    e618: "iconfont_folder_calendar",
    e635: "iconfont_a_folder_calendarclock",
    e632: "iconfont_folder_ai_prompt",
    e637: "iconfont_folder_analysis",
    e605: "iconfont_a_folder_balance",
    e746: "iconfont_a_foldericon_interests",
    e622: "iconfont_a_foldericon_mood",
    e639: "iconfont_a_folder_voicechat",
    e626: "iconfont_a_folder_videomeeting",
    e609: "iconfont_folder_speech",
    e636: "iconfont_folder_clinical_notes",
    e638: "iconfont_a_foldericon_interpreter_mode",
    e61d: "iconfont_folder_adaptive_audio_mic",
    e60b: "iconfont_folder_ground",
    e60a: "iconfont_a_foldericon_idea",
    e62f: "iconfont_folder_communication",
    e615: "iconfont_folder_speech_to_text",
    e624: "iconfont_a_foldericon_invoicedollar",
    e630: "iconfont_folder_file",
    e612: "iconfont_a_folder_movetoinbox",
    e613: "iconfont_folder_display_settings",
    e621: "iconfont_folder_finalize",
    e73d: "iconfont_folder_book",
    e610: "iconfont_folder_pencil_ruler",
    e611: "iconfont_folder_booknote",
    e608: "iconfont_folder_gamepad",
    e63b: "iconfont_folder_call",
    e63c: "iconfont_folder_favourite",
    e62d: "iconfont_folder_comment",
    e617: "iconfont_folder_note",
    e633: "iconfont_folder_cloud",
    e60e: "iconfont_folder_contact",
    e63a: "iconfont_folder_camcorder",
    e62c: "iconfont_folder_music",
    e640: "iconfont_folder_user",
    e63e: "iconfont_folder_tag",
    e629: "iconfont_folder_database",
    e63f: "iconfont_a_foldericon_interests",
    e63d: "iconfont_folder_book",
    e64a: "iconfont_folder_foler_1",
    e646: "iconfont_folder_gamepad",
    e649: "iconfont_folder_meeting",
    e64c: "iconfont_folder_call",
    e64d: "iconfont_folder_favourite",
    e64e: "iconfont_folder_reward",
    e642: "iconfont_folder_comment",
    e643: "iconfont_folder_note",
    e644: "iconfont_folder_cloud",
    e647: "iconfont_folder_home",
    e648: "iconfont_folder_global",
    e641: "iconfont_folder_contact",
    e64b: "iconfont_folder_camera",
    e645: "iconfont_folder_camcorder",
    e660: "iconfont_folder_starred",
    e684: "iconfont_folder_contact_1",
    e669: "iconfont_a_folder_uploadfile",
    e676: "iconfont_a_foldericon_list",
    e664: "iconfont_a_folder_assignment",
    e68c: "iconfont_a_folder_tasklist",
    e668: "iconfont_folder_pacemaker",
    e675: "iconfont_folder_ecg",
    e66a: "iconfont_folder_stethoscope",
    e679: "iconfont_a_foldericon_location",
    e67e: "iconfont_a_foldericon_image",
    e665: "iconfont_folder_view",
    e66c: "iconfont_folder_flower",
    e672: "iconfont_folder_handbag",
    e689: "iconfont_folder_car",
    e682: "iconfont_folder_calendar",
    e688: "iconfont_a_folder_calendarclock",
    e681: "iconfont_folder_ai_prompt",
    e68b: "iconfont_folder_analysis",
    e686: "iconfont_a_folder_balance",
    e67a: "iconfont_a_foldericon_interests",
    e66d: "iconfont_a_foldericon_mood",
    e667: "iconfont_a_folder_voicechat",
    e666: "iconfont_a_folder_videomeeting",
    e671: "iconfont_folder_speech",
    e685: "iconfont_folder_clinical_notes",
    e67b: "iconfont_a_foldericon_interpreter_mode",
    e68a: "iconfont_folder_adaptive_audio_mic",
    e674: "iconfont_folder_ground",
    e677: "iconfont_a_foldericon_idea",
    e680: "iconfont_folder_communication",
    e66b: "iconfont_folder_speech_to_text",
    e67f: "iconfont_a_foldericon_invoicedollar",
    e67d: "iconfont_folder_file",
    e670: "iconfont_a_folder_movetoinbox",
    e673: "iconfont_folder_display_settings",
    e67c: "iconfont_folder_finalize",
    e683: "iconfont_folder_book",
    e66e: "iconfont_folder_pencil_ruler",
};

/**
 * Canonical name -> the codepoint the official apps expect on the wire.
 * The official mobile app resolves `icon` as an iconfont codepoint, so a
 * semantic name renders as the default folder there. The wire codepoint is
 * the first occurrence of each name in LEGACY_CODEPOINT_MAP (first font
 * generation).
 */
export const FILETAG_ICON_WIRE_MAP: Record<string, string> = {};
for (const [codepoint, name] of Object.entries(LEGACY_CODEPOINT_MAP)) {
    if (!(name in FILETAG_ICON_WIRE_MAP)) {
        FILETAG_ICON_WIRE_MAP[name] = codepoint;
    }
}

/**
 * Convert a canonical icon name to the codepoint to send to Plaud.
 * Unknown values fall back to the default folder codepoint.
 */
export function denormalizeFiletagIcon(
    name: string | null | undefined,
): string {
    return (
        FILETAG_ICON_WIRE_MAP[name ?? ""] ??
        FILETAG_ICON_WIRE_MAP[DEFAULT_FILETAG_ICON]
    );
}

/**
 * Normalize a Plaud-provided icon value to a canonical icon name for
 * persistence. Accepts canonical names, legacy codepoints, and garbage
 * (falls back to the default folder icon). The DB only ever contains
 * canonical names.
 */
export function normalizeFiletagIcon(raw: string | null | undefined): string {
    if (!raw) return DEFAULT_FILETAG_ICON;
    const value = raw.trim();
    if (value in PLAUD_FILETAG_ICON_MAP) return value;
    const fromCodepoint = LEGACY_CODEPOINT_MAP[value.toLowerCase()];
    if (fromCodepoint) return fromCodepoint;
    return DEFAULT_FILETAG_ICON;
}

/** Resolve an icon name to its lucide component for rendering. */
export function getFiletagIcon(name: string | null | undefined): LucideIcon {
    if (!name) return Folder;
    return PLAUD_FILETAG_ICON_MAP[name] ?? Folder;
}
