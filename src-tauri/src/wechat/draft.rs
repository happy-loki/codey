use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize)]
pub struct DraftArticlePayload {
    pub title: String,
    pub content: String,
    pub thumb_media_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    pub show_cover_pic: i32,
}

#[derive(Serialize)]
pub struct DraftAddRequest {
    pub articles: Vec<DraftArticlePayload>,
}

#[derive(Serialize)]
pub struct DraftUpdateRequest {
    pub media_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub index: Option<u32>,
    pub articles: DraftArticlePayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DraftResponse {
    pub media_id: Option<String>,
    pub item_id: Option<i64>,
    pub errcode: Option<i32>,
    pub errmsg: Option<String>,
}
