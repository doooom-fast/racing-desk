// The Chromium flags that keep a headless browser off the graphics card. This machine is the sim rig, and its
// NVIDIA driver stopped responding three times on 2026-09-29 (event 4101, nvlddmkm, at 20:38, 23:00 and 23:01) while
// headless pages of the WebGL HUD were being screenshotted; once it left the screen in a mode the monitor could not
// show. With these flags Chromium draws in SwiftShader, on the CPU, and never opens the driver.
//
// Anything here that starts Chromium, whether through Playwright's test runner (playwright.config.mjs) or by calling
// `chromium.launch` itself in a script, takes these: a script that launches with no flags does not go through the
// config, and was how the driver was reached. tests/unit/software-browser.spec.mjs fails for a file that does not.
export const SOFTWARE_GL_ARGS = ['--disable-gpu', '--use-angle=swiftshader', '--use-gl=angle'];
