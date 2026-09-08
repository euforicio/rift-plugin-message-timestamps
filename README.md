# Message Timestamps for BB

Shows the time you sent each message next to your bubbles in BB chat windows.

- Today: `12:43 PM`
- Yesterday: `Yesterday 12:43 PM`
- Older: `Aug 12, 12:43 PM`

Hover the time for the full date. Times come from the thread timeline and are
painted onto the existing chat UI.

## Install

From the BB Community marketplace once the listing is approved, or directly:

```sh
rift plugin install git:https://github.com/euforicio/rift-plugin-message-timestamps.git@v0.1.0
```

From a local checkout:

```sh
npm ci
rift plugin build
rift plugin install .
```

## Rift fork

Maintained by Rift Labs for [Rift](https://riftlabs.app). Original source: [bighitbiker3/bb-plugin-message-timestamps](https://github.com/bighitbiker3/bb-plugin-message-timestamps). Original license and attribution are preserved.

Use `npm ci` for the pinned SDK artifact; its provenance is in [vendor/README.md](vendor/README.md).
