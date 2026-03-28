use std::{
    collections::hash_map::DefaultHasher,
    env,
    hash::{Hash, Hasher},
    net::SocketAddr,
};

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};

const SALT: &str = "OPENCLAW-SECRET-SALT";

#[derive(Clone)]
struct AppState {
    admin_token: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateLicenseRequest {
    fingerprint: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GenerateLicenseResponse {
    fingerprint: String,
    license_key: String,
    issued_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorResponse {
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    status: String,
    now: String,
}

#[tokio::main]
async fn main() {
    let host = env::var("LICENSE_SERVER_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let port = env::var("LICENSE_SERVER_PORT")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(8099);
    let admin_token = env::var("LICENSE_ADMIN_TOKEN").ok().filter(|v| !v.trim().is_empty());

    let state = AppState { admin_token };

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/license/generate", post(generate_license))
        .with_state(state);

    let addr: SocketAddr = format!("{host}:{port}").parse().expect("invalid bind address");
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("bind failed");

    println!("license backend listening on http://{addr}");
    axum::serve(listener, app).await.expect("server crashed");
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
        now: Utc::now().to_rfc3339(),
    })
}

async fn generate_license(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<GenerateLicenseRequest>,
) -> Result<Json<GenerateLicenseResponse>, (StatusCode, Json<ErrorResponse>)> {
    if let Some(expected_token) = &state.admin_token {
        let got = headers
            .get("x-admin-token")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        if got != expected_token {
            return Err((
                StatusCode::UNAUTHORIZED,
                Json(ErrorResponse {
                    message: "invalid admin token".to_string(),
                }),
            ));
        }
    }

    let fingerprint = payload.fingerprint.trim().to_uppercase();
    if !is_valid_fingerprint(&fingerprint) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: "fingerprint format invalid, expected CLAW-XXXX-XXXX".to_string(),
            }),
        ));
    }

    let license_key = build_license_key(&fingerprint);
    Ok(Json(GenerateLicenseResponse {
        fingerprint,
        license_key,
        issued_at: Utc::now().to_rfc3339(),
    }))
}

fn build_license_key(fingerprint: &str) -> String {
    let combined = format!("{fingerprint}-{SALT}");
    let mut hasher = DefaultHasher::new();
    combined.hash(&mut hasher);
    let value = hasher.finish();
    format!("{value:08X}")
}

fn is_valid_fingerprint(value: &str) -> bool {
    let parts: Vec<&str> = value.split('-').collect();
    if parts.len() != 3 {
        return false;
    }
    if parts[0] != "CLAW" {
        return false;
    }
    if parts[1].len() != 4 || parts[2].len() != 4 {
        return false;
    }
    parts[1].chars().all(|c| c.is_ascii_hexdigit()) && parts[2].chars().all(|c| c.is_ascii_hexdigit())
}
