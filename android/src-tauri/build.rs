fn main() {
    // Los plugins propios de Android usan `addPluginListener` para recibir eventos (parciales,
    // audio…). Esa llamada pasa por el ACL de Tauri, así que hay que declarar sus comandos.
    let attributes = tauri_build::Attributes::new()
        .plugin(
            "captura",
            tauri_build::InlinedPlugin::new()
                .commands(&["register_listener", "remove_listener"])
                .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands)
        )
        .plugin(
            "reconocimiento",
            tauri_build::InlinedPlugin::new()
                .commands(&["register_listener", "remove_listener"])
                .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands)
        );
    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
