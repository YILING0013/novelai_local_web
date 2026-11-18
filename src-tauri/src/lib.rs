mod account;
mod batch;
mod comic;
#[cfg(not(target_os = "android"))]
mod desktop;
#[cfg(not(target_os = "android"))]
mod desktop_windows;
#[cfg(not(target_os = "android"))]
mod files;
mod gallery_files;
mod generation;
mod inference;
mod jobs;
mod library;
mod metadata;
#[cfg(all(test, not(target_os = "android")))]
mod migration_tests;
mod notes;
mod official;
mod search;
mod secrets;
mod service;
#[cfg(not(target_os = "android"))]
mod updater;
#[cfg(not(target_os = "android"))]
mod web;
mod works;

#[cfg(target_os = "android")]
mod android;
#[cfg(not(target_os = "android"))]
mod desktop_inference;
#[cfg(not(target_os = "android"))]
pub use desktop::run;

#[cfg(all(test, not(target_os = "android")))]
mod contracts;
