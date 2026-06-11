# READY FOR EXPO GO

Verified on 2026-06-11: `npx tsc --noEmit` clean, `npx jest` 15/15 passing, and the
Expo dev server boots and serves the manifest + iOS Hermes bundle. Follow the steps
below to test the app end-to-end with Expo Go.

## 1. Start the hermes-agent dashboard on your Mac

Set the basic-auth credentials and bind the dashboard to a **non-loopback** address
(your LAN IP or Tailscale IP). A non-loopback bind is REQUIRED — the phone cannot
reach `localhost`, and binding to a real interface is also what enables basic auth.

```bash
export HERMES_DASHBOARD_BASIC_AUTH_USERNAME=<your-username>
export HERMES_DASHBOARD_BASIC_AUTH_PASSWORD=<your-password>
hermes web --host <LAN-or-tailscale-IP> --port 9119
```

Examples for `<LAN-or-tailscale-IP>`:
- LAN: the Mac's Wi-Fi address, e.g. `192.168.1.42` (find it with `ipconfig getifaddr en0`)
- Tailscale: the Mac's tailnet address, e.g. `100.x.y.z` (find it with `tailscale ip -4`)

## 2. Start the Expo dev server and open the app in Expo Go

```bash
cd ~/hermes-mobile-app
npx expo start
```

Install **Expo Go** on your phone, make sure the phone is on the **same network**
as the Mac (same Wi-Fi, or same tailnet if you use Tailscale), then scan the QR
code printed in the terminal (iOS: Camera app; Android: Expo Go's built-in scanner).

> Tip: if phone and Mac are connected over Tailscale rather than the same Wi-Fi,
> start Expo with `npx expo start --host <tailscale-IP-of-the-Mac>` so the QR code
> points at a reachable address.

## 3. Connect from the app

On the Connect screen, enter:

- **Server URL:** `http://<that-ip>:9119` (the same IP you passed to `hermes web --host`)
- **Username / Password:** the values of `HERMES_DASHBOARD_BASIC_AUTH_USERNAME`
  and `HERMES_DASHBOARD_BASIC_AUTH_PASSWORD`

Tap Connect. You should land on the sessions list; open a session to chat.
Credentials are stored in the device keychain (SecureStore), so the app
reconnects automatically next launch.

## 4. Known limitations (this milestone)

- **No push notifications yet** — push lands in the next milestone.
- **No QR pairing yet** — you must type the URL and credentials manually; QR
  pairing lands in the next milestone.
- **Chat "continue session" starts a fresh agent session** — opening an existing
  session shows its old history, but sending a message starts a new agent session
  rather than resuming the original one.
