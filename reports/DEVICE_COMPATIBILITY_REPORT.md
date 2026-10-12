# Device and printer compatibility report

> **Historical snapshot.** This report predates the barcode-scanning and receipt-name implementation. It does not test any physical barcode scanner, and its older Supabase references describe the previous backend architecture.

**Date:** 2026-10-10 · **Status:** Source/configuration review and local Worker smoke test only. No Android tablet, Android phone, iPad, iPhone, physical printer, Bluetooth pairing, USB session, or offline browser test was performed.

## Summary

The UI is built as a responsive Next.js PWA and includes browser print/PDF/share fallbacks plus optional ESC/POS Bluetooth and USB transports. A successful build and local Cloudflare Worker preview do not prove compatibility with any device or printer model. Compatibility is **not certified**; a hardware pilot remains a release blocker.

| Target | Evidence from this review | Status | Required next test |
|---|---|---|---|
| Android tablet | Responsive app/build and local Worker preview; no device/browser exercised | **Unverified** | Record exact tablet model, Android version and Chrome/Samsung Internet version; test landscape/portrait, touch target sizes, install, offline cash, sign-in, sync and long-shift use |
| Android phone | Responsive layout source only; no physical phone or viewport automation | **Unverified** | Test small screen, numeric keypad, scroll/zoom, interrupted connectivity, app switching and receipt viewing |
| iPad/iPhone Safari | No device test. App offers PDF/browser print fallback; direct browser device APIs are not assumed | **Unverified; direct printer APIs likely unavailable/limited** | Test exact iPadOS/iOS/Safari version, Add to Home Screen, session persistence, print/share and offline behavior |
| Desktop Chrome/Edge | Build only; no physical/browser session | **Unverified** | Test desktop sign-in, touch/mouse workflows, printing and device API permission recovery |
| ESC/POS Bluetooth printer | Encoder/transport code present; no printer was paired | **Not tested** | Test model, firmware, 58/80 mm paper, ESC/POS code page, cut/drawer commands, disconnect/reconnect and duplicate-print prevention |
| ESC/POS USB printer | Transport code present; no USB device was connected | **Not tested** | Test exact model/USB interface, browser pairing prompt, permissions after restart, paper width and failure fallback |
| Browser/native print, PDF, email | Source paths and production bundle built; no OS print dialog or real email tested | **Not tested end-to-end** | Validate printer selection, PDF scale/margins, customer consent, verified sender, delivery/bounce and privacy treatment |

## Browser API constraints

- Web Bluetooth is marked limited availability and requires a secure context; support is browser/OS/device dependent. Check the exact compatibility table before choosing hardware: [MDN Web Bluetooth API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API) and [Navigator.bluetooth](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/bluetooth).
- WebUSB is also limited availability/experimental in mainstream browser support and requires a secure context: [MDN Navigator.usb](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/usb). A USB port on the tablet does not guarantee that its browser exposes WebUSB.
- PWA installation varies by OS/browser. MDN notes Android WebAPK installation is browser/device dependent and iOS 16.4+ supports adding from the browser share menu; installation UI must be tested on the target OS: [MDN PWA installation guidance](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).
- The app adds a `Permissions-Policy` header that allows same-origin Bluetooth/USB APIs and disables camera, microphone and geolocation. This header does not grant device support or user permission.

## Local smoke test recorded

A Cloudflare Worker **local preview** was run using Node 22, demo configuration and no Supabase/payment credentials. HTTP checks returned 200 for `/`, `/privacy`, `/offline`, `/manifest.webmanifest` and `/api/health`. `/api/health` reported demo mode, `cloudConfigured:false` and `paymentsConfigured:false`. The three security headers checked were present. Four unauthenticated POST route checks returned 401.

This was a server-side HTTP smoke test, not a real browser, responsive layout, keyboard/touch, PWA install, offline service-worker, screen-reader, OS print, Bluetooth or USB test. No external/production deployment occurred.

## Pilot acceptance checklist

For each model, record serial/model, OS/build, browser/version, display size/scaling, network type, date, operator and results:

1. Install/uninstall/reopen; verify secure origin, login, offline PIN setup/unlock and logout behavior.
2. Exercise checkout with a training account; verify taps, screen rotation, scroll, keypad, receipt layout and accessibility at typical display scaling.
3. After initial sync, enable airplane mode. Confirm catalog/history remain usable, cash sale/refund queue locally, digital tender stays pending, then reconnect and check acknowledgements/conflicts without duplicate stock or payment.
4. Suspend/resume the device, switch applications, lock/unlock, restart the browser and restart the device. Confirm no abandoned modal, duplicate request or inaccessible outbox.
5. Print a test receipt with a clearly synthetic sale. Check paper width, line wraps, Ghana cedi symbol/encoding, tax breakdown, cutting and repeat behavior. A “sent to printer” UI message is not proof that paper printed correctly.
6. Test native print/PDF and share fallback on every platform where direct printer APIs fail. Use only a test recipient for email; verify customer consent and sender configuration.
7. Test USB/Bluetooth permissions after browser restart, printer power cycle, range loss, denied permission and reconnection. Confirm the cashier can switch to PDF/print without resubmitting a sale/refund.
8. Keep all test data synthetic; no real payment or refund; sign off jointly by store owner and device/printer operator.
