#[cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![login, check_exam_environment])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

/// Cek lingkungan ujian: false bila ada aplikasi lain / floating window terdeteksi.
/// Saat ini pakai fokus jendela sebagai aproksimasi.
/// TODO: ganti dengan API Android (ActivityManager/UsageStats) via JNI/plugin.
#[tauri::command]
fn check_exam_environment(app: tauri::AppHandle) -> bool {
  app
    .get_webview_window("main")
    .and_then(|w| w.is_focused().ok())
    .unwrap_or(false)
}

/// Login siswa ke API CBT dengan header hash SEB. Ditolak bila environment tidak aman.
#[tauri::command]
fn login(
  app: tauri::AppHandle,
  username: String,
  password: String,
  seb_hash: Option<String>,
) -> Result<String, String> {
  if !check_exam_environment(app) {
    return Err("Login diblokir: aplikasi ujian tidak mendapat fokus (aplikasi lain terbuka?)".into());
  }

  let mut headers = reqwest::header::HeaderMap::new();
  if let Some(hash) = seb_hash {
    let value = reqwest::header::HeaderValue::from_str(&hash)
      .map_err(|_| "Hash SEB tidak valid".to_string())?;
    headers.insert("X-SafeExamBrowser-RequestHash", value);
  }

  let client = reqwest::blocking::Client::new();
  let response = client
    .post("https://cbt.sma1gorontalo.sch.id/api/auth/login")
    .headers(headers)
    .json(&serde_json::json!({ "username": username, "password": password }))
    .send()
    .map_err(|e| format!("Gagal terhubung ke server: {e}"))?;

  let status = response.status();
  let body: serde_json::Value = response
    .json()
    .map_err(|e| format!("Respons server tidak terbaca: {e}"))?;
  if !status.is_success() {
    let message = body
      .get("message")
      .and_then(|m| m.as_str())
      .unwrap_or("Login gagal");
    return Err(message.to_string());
  }

  // TODO: simpan accessToken/refreshToken di Android Keystore (bukan localStorage).
  Ok(body.to_string())
}
