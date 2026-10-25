// O app desktop é a mesma interface React da web, empacotada com o WebView2.
// Toda a lógica (auth, banco, IA) roda no Supabase; aqui só abrimos a janela.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o EduPDF IA");
}
