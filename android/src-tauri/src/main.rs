// Punto de entrada de escritorio (solo para `cargo tauri dev` en la PC); en Android entra por lib.rs.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    dictaflow_lib::run()
}
