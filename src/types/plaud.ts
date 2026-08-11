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

/**
 * A Plaud directory ("filetag"). `id` may come back numeric from some
 * servers — normalize with `String()` at every boundary. `icon` may be a
 * canonical `iconfont_folder_*` name or a legacy codepoint (`e627`, ...).
 */
export interface PlaudFileTag {
    id: string | number;
    name: string;
    icon?: string;
    color?: string;
}

export interface PlaudFiletagListResponse {
    status: number;
    msg?: string;
    data_filetag_list?: PlaudFileTag[];
}

export interface PlaudFiletagMutationResponse {
    status: number;
    msg?: string;
    data_filetag?: PlaudFileTag;
}

export interface PlaudUpdateFileTagsResponse {
    status: number;
    msg?: string;
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
