#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![login, check_exam_environment])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

// TODO: deteksi nyata aplikasi lain/floating via API Android (ActivityManager/UsageStats).
#[tauri::command]
fn check_exam_environment() -> bool { true }

#[tauri::command]
fn login(username: String, password: String, seb_hash: Option<String>) -> Result<String, String> {
  if !check_exam_environment() {
    return Err("Login diblokir: aplikasi lain terdeteksi".into());
  }
  let mut headers = reqwest::header::HeaderMap::new();
  if let Some(hash) = seb_hash {
    headers.insert("X-SafeExamBrowser-RequestHash",
      reqwest::header::HeaderValue::from_str(&hash).map_err(|_| "Hash SEB tidak valid".to_string())?);
  }
  let res = reqwest::blocking::Client::new()
    .post("https://cbt.sma1gorontalo.sch.id/api/auth/login")
    .headers(headers)
    .json(&serde_json::json!({ "username": username, "password": password }))
    .send().map_err(|e| format!("Gagal terhubung: {e}"))?;
  let status = res.status();
  let body: serde_json::Value = res.json().map_err(|e| format!("Respons tidak terbaca: {e}"))?;
  if !status.is_success() {
    return Err(body.get("message").and_then(|m| m.as_str()).unwrap_or("Login gagal").to_string());
  }
  Ok(body.to_string())
}
