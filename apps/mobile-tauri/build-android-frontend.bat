@echo off
rem Build the bundle the TABLET embeds: `build:mobile` writes ui/dist-mobile, which is what
rem apps/mobile-tauri/tauri.conf.json's build.frontendDist names. It used to run the desktop
rem `npm run build` (ui/dist) — an artifact no Android build ever reads — so a name that
rem promises the frontend is ready for Android prepared the wrong one. Corrected 2026-09-20
rem by the Android audit; see .agents/skills/android-apk-build/SKILL.md.
cd /d "%~dp0..\..\ui"
call npm run build:mobile
exit /b %errorlevel%
