export interface PlaudDevice {
    sn: string;
    name: string;
    model: string;
    version_number: number;
}

export interface PlaudDeviceListResponse {
    status: number;
    msg: string;
    data_devices: PlaudDevice[];
}

export interface PlaudRecording {
    id: string;
    filename: string;
    keywords: string[];
    filesize: number;
    filetype: string;
    fullname: string;
    file_md5: string;
    ori_ready: boolean;
    version: number;
    version_ms: number;
    edit_time: number;
    edit_from: string;
    is_trash: boolean;
    start_time: number; // Unix timestamp in milliseconds
    end_time: number; // Unix timestamp in milliseconds
    duration: number; // Duration in milliseconds
    timezone: number;
    zonemins: number;
    scene: number;
    filetag_id_list: string[];
    serial_number: string;
    is_trans: boolean;
    is_summary: boolean;
    source?: "v4"; // listed via /file-app/v4, see PlaudClient.hydrateRecording
}

// --- Plaud 4.0 file API (`/file-app/v4/...`), see src/lib/plaud/v4.ts ---

export interface PlaudV4RecordingItem {
    node_id?: string;
    parent_id?: string;
    file_id: string;
    name?: string;
    duration_ms?: number;
    created_at_show_ms?: number;
    updated_at_show_ms?: number;
    status?: number;
    version_ms?: number;
}

export interface PlaudV4RecordingsResponse {
    status: number;
    msg?: string;
    data?: {
        items?: PlaudV4RecordingItem[];
        next_cursor?: string | null;
    };
}

export interface PlaudV4FileObject {
    object_id?: string;
    object_type?: string; // 'AUDIO' | 'AUDIO_TRANSCODED' | 'TRANSCRIPT' | 'SUMMARY' | ...
    content_id?: string;
    content_url?: string | null; // presigned
    mime_type?: string;
    object_size?: number;
    task_status?: number | null; // 1 = ready
}

export interface PlaudV4FileMeta {
    file_id?: string;
    file_type?: string;
    duration?: number; // ms
    size_bytes?: number;
    timezone_iana?: string | null;
    start_time?: number; // ms
    serial_number?: string | null;
    version_ms?: number;
}

export interface PlaudV4Node {
    node_id?: string;
    parent_id?: string;
    name?: string;
    version_ms?: number;
    folder?: { folder_id?: string; name?: string } | null; // per-recording folder
    breadcrumbs?: { node_id?: string; name?: string }[];
}

export interface PlaudV4RenameResponse {
    status: number;
    msg?: string;
    data?: {
        items?: PlaudV4Node[];
        parent_items?: PlaudV4Node[];
    };
}

export interface PlaudV4FolderChildrenResponse {
    status: number;
    msg?: string;
    data?: { items?: PlaudV4Node[]; next_cursor?: string | null };
}

export interface PlaudV4FileDetailResponse {
    status: number;
    msg?: string;
    data?: {
        node?: PlaudV4Node;
        meta?: PlaudV4FileMeta;
        objects?: PlaudV4FileObject[];
    };
}

export interface PlaudV4ContentUrlResponse {
    status: number;
    msg?: string;
    data?: { url_map?: Record<string, string> };
}

export interface PlaudRecordingsResponse {
    status: number;
    msg: string;
    data_file_total: number;
    data_file_list: PlaudRecording[];
}

export interface PlaudTempUrlResponse {
    status: number;
    temp_url: string;
    temp_url_opus?: string;
}

export interface PlaudApiError {
    status: number;
    msg: string;
}

export interface PlaudWorkspace {
    workspace_id: string;
    member_id: string;
    name: string;
    role: string;
    status: string;
    workspace_type: string;
    region?: string;
    api_domain?: string;
    created_at?: string;
    creator_user_id?: string;
}

export interface PlaudWorkspaceListResponse {
    status: number;
    msg?: string;
    data: {
        workspaces: PlaudWorkspace[];
    };
    type?: string;
}

export interface PlaudWorkspaceTokenResponse {
    status: number;
    msg?: string;
    data: {
        status: number;
        workspace_token: string;
        expires_in: number;
        wt_expires_at: number;
        refresh_token: string;
        refresh_expires_in: number;
        refresh_expires_at: number;
        workspace_id: string;
        member_id: string;
        role: string;
    };
}

// --- Plaud-native content (transcript / summary / notes) — feature #204 ---
// Shape of GET /file/detail/{fileId}. Item selection + the summary/envelope
// shape are validated against a real captured response; the transcript segment
// body is still unverified. Kept permissive (all fields optional) so parsers
// defensively pick what they need.
export interface PlaudContentItem {
    // Stable-ish per-item id, e.g. 'source_transaction:<...>',
    // 'auto_sum:<...>', 'sum_multi:<...>'. Used for selection when the
    // free-text `data_type` strings drift.
    data_id?: string;
    data_type?: string; // 'transaction' | 'auto_sum_note' | 'sum_multi_note' | 'outline' | ...
    data_title?: string;
    data_tab_name?: string;
    task_status?: number; // 1 = ready
    data_link?: string; // presigned URL; body may be gzip-compressed JSON
}

// Inline content delivered with the detail response (no S3 round-trip).
// `data_content` is a JSON string keyed by the matching item's `data_id`.
export interface PlaudPreDownloadContent {
    data_id?: string;
    data_content?: string;
}

export interface PlaudFileDetail {
    file_id?: string;
    file_name?: string;
    duration?: number;
    start_time?: number;
    scene?: number;
    content_list?: PlaudContentItem[];
    pre_download_content_list?: PlaudPreDownloadContent[];
}

export interface PlaudFileDetailResponse {
    status: number; // 0 = success on this endpoint
    msg?: string;
    data?: PlaudFileDetail;
}

// A single diarized transcript segment from a 'transaction' content link.
export interface PlaudTranscriptSegment {
    start_time?: number;
    end_time?: number;
    speaker?: string | number;
    content?: string;
}
