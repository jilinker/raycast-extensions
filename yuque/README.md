# Yuque Search for Raycast

Search private team or public Yuque documents in Raycast and open the selected result in your browser.

## Install

```bash
npm install
npm run dev
```

Load [`browser-extension`](./browser-extension) as an unpacked extension in Chrome or Edge then pin it to the toolbar.

## Connect

1. Run **Search Yuque** in Raycast
2. Choose **Connect Yuque**
3. Click **Yuque Local Bridge** in the browser toolbar

If automatic connection does not provide enough session fields use **Import Fetch or cURL** and paste a request copied from browser DevTools. The original text is parsed in memory and is never saved.

## Security

- Credentials are stored in the encrypted Raycast local database
- The browser bridge reads only an allowlist of Yuque session cookies
- The callback listens only on `127.0.0.1` and requires a one time nonce
- Search responses and pasted requests are not persisted
- Disconnect removes the saved session

This extension uses Yuque's undocumented `/api/zsearch` endpoint. When it stops working use the built in browser search action.
