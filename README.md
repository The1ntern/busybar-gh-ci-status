# GitHub CI Status

**Made entirely with `claudecode`. Validated basic functionality locally with the physical hardware.**

Query the CI status of a GitHub repository live on the BUSY Bar

A JavaScript app for the BUSY Bar, generated from the BUSY JS app template.

## What it shows

The bar watches the latest GitHub Actions workflow run of one repository:

| Line 1 | Meaning |
| --- | --- |
| `PASS` (green) | the run succeeded |
| `FAIL` (red) | failure, timed out or startup failure |
| `RUNNING` / `QUEUED` (amber) | the run is in progress or waiting |
| `ACTION` (amber) | the run needs approval |
| `CANCEL` / `SKIP` / `NO RUNS` (grey) | cancelled, skipped, or no runs yet |

Line 2 shows `<repo> #<run number>`. When something goes wrong, line 2 turns amber with `Set repo`, `Bad token`, `Not found`, `Rate limit`, `Offline` or `Error`, and line 1 keeps the last known state.

A small dot in the top-right corner blinks each time the bar checks GitHub.

Press `ok` to refresh now and `back` to quit.

## Setup

Set these in the app's settings on the bar:

- **Repository**: `owner/name`, for example `octocat/hello-world`. A pasted URL also works (`https://github.com/owner/name`, `github.com/owner/name`, a `.git` clone URL or a link to a page inside the repo). The bar picks up a changed setting within 30 s, or at once when you press `ok`. `Bad repo` means the value couldn't be read as `owner/name`.
- **Branch** (optional): only show runs on this branch, for example `main`. Leave it empty to show the latest run on any branch.
- **GitHub token** (optional): needed for private repositories, and it raises GitHub's limit from 60 to 5000 requests an hour. Create a fine-grained token at GitHub → Settings → Developer settings → Fine-grained tokens, limit it to this repository only, and grant **Actions: Read-only**.

Polling:

- while a run is active: every 30 s with a token, 90 s without
- once it has finished: every 2 min with a token, 5 min without
- after an error: back off from 1 min, doubling up to 60 min
- when rate-limited: wait until GitHub's reset time
- after a `401` (bad token): stop until `ok` is pressed

Responses are cached with an ETag, so an unchanged result costs no rate limit when a token is set.

## Getting started

```sh
npm install
npm run build         # build the app into dist/app.the1ntern.github-ci-status.tgz
npm run app:install   # install it on the BUSY Bar connected over USB
npm run app:run       # launch the installed app
```

The app's id is `app.the1ntern.github-ci-status`, set in `src/appmeta/manifest.json`. An id is `<namespace>.<app>`, at most 32 characters, made of Latin letters, digits, underscores, dashes, and dots, and not starting with a dot. If yours still says `app.example`, change it to your own namespace before publishing.

## Layout

`src/` is the app — everything in it is yours to edit.

The entry point is `src/main.ts` (or `src/main.js`). The name is fixed: the build turns it into `scripts/main.js`, the file the BUSY Bar starts. Any imported modules are emitted as separate files alongside it in `scripts/`, unless `npm run build -- --bundle` inlines them.

`src/main.ts` is run from top to bottom, not imported: it starts the app by calling `main()` at the end and must not export anything. Imported modules can use standard exports.

```
my-app/
├── src/                          the app
│   ├── main.ts                   the entry point: function main(), called at the end
│   ├── appmeta/
│   │   ├── manifest.json         id, name, version, api_version
│   │   ├── settings.json         the settings screen — optional
│   │   ├── icon_front_8x8.png    front icon, 8×8 color — optional
│   │   └── icon_back_11x11.png   back icon, 11×11 RGBA silhouette — optional
│   ├── images/
│   ├── animations/
│   └── sounds/
├── shared/                       app-level helpers, imported as @shared/*
```

Both icons are optional; without them a default is used.

The back icon is a silhouette: the back screen's menu tints it to one theme color (grey, or black when the item is selected), so only the alpha channel matters. Use a transparent background and opaque glyph pixels. An image without an alpha channel, such as a plain grayscale PNG, is fully opaque and shows as a solid box.

The bar caches decoded images by path, so a reinstalled icon may keep showing the old one until the bar restarts.

## Resources

Anything in `src/` that isn't a source file is copied into the package, sorted by what the BUSY Bar can read:

| Extension | Destination |
| --- | --- |
| `.png` `.image` | `images/` |
| `.anim` | `animations/` |
| `.snd` | `sounds/` |
| anything else | `resources/` |

A file in `src/images`, `src/animations` or `src/sounds` keeps its folder as long as the BUSY Bar reads its format.

`images/`, `animations/` and `sounds/` hold only those formats. An image, animation or sound in another format — `.jpg`, `.gif`, `.svg`, `.wav`, `.mp3` and the like — goes to `resources/`, and the build warns that the device cannot read it.

Everything the app draws goes through the layout helpers in `@busy-app/busy-lib`: build a tree out of `row` / `column` / `stack`, hand it to `render()`, and send the result with `device.DisplayDraw()`. The screen is 72×16 pixels.

## Input

`listen("input", handler)` delivers the device keys: `ok`, `start` and `back` with a `press` / `release` / `short` / `long` / `repeat` action, and `encoder` with a `delta` of `1` or `-1`. It returns an unbind function.

Use `short` as the default action for a button press: it fires once, after a normal press and release. `press` fires immediately on key down and is followed by `short`, so handling `press` as a tap can react twice. Use `long` and `repeat` for hold gestures.

## Commands

| Command | Description |
| --- | --- |
| `npm run build` | empties `dist/` and builds the package into `dist/app.the1ntern.github-ci-status.tgz` |
| `npm run build -- --emit dir` | leaves the `app.the1ntern.github-ci-status/` folder instead of the `.tgz` |
| `npm run build -- --emit both` | leaves the folder and the `.tgz` |
| `npm run build -- --out <path>` | builds into `<path>` instead, replacing only this app's package there |
| `npm run build -- --tgz-name <name>` | names the `.tgz`, e.g. `"{id}-{version}.tgz"` |
| `npm run build -- --no-minify` | readable output, for debugging |
| `npm run build -- --bundle` | inlines every module into one `main.js` |
| `npm run build -- --addr <host>` | sets the BUSY Bar address the app connects to, `localhost` by default |
| `npm run typecheck` | type-checks the app |
| `npm run app:install` | installs `dist/app.the1ntern.github-ci-status.tgz` on the BUSY Bar; build it first with `npm run build` |
| `npm run app:uninstall` | removes the app from the BUSY Bar, keeping its settings |
| `npm run app:run` | launches the installed app |
| `npm run app:stop` | quits the running app |

The four `app:` commands talk to the BUSY Bar connected over USB. For a device connected over Wi-Fi, pass `--addr <host>` with its network IP address or hostname, and `--password <password>` if password protection is enabled:

```sh
npm run app:install -- --addr <host>
npm run app:install -- --addr <host> --password <password>
```

## Build output

The package folder is named after the app id:

```
dist/
└── app.the1ntern.github-ci-status/
    ├── appmeta/manifest.json
    ├── scripts/main.js
    └── images/ animations/ sounds/ resources/
```

By default the build packs that folder into `dist/app.the1ntern.github-ci-status.tgz`, with the folder itself at the root of the archive, and removes the folder; `--emit dir` keeps only the folder, `--emit both` keeps both. `--tgz-name` gives the archive another name; `{id}` and `{version}` in it are replaced with the manifest values.

## Releasing

Pushing a git tag matching the manifest `version` (e.g. `0.1.0`) builds the app and attaches `app.the1ntern.github-ci-status-<version>.tgz` to a GitHub release. The release notes open with the app's name, id, version and API version. The release fails when the tag differs from the manifest `version`.

## Manifest

`src/appmeta/manifest.json` carries the app's identity and a couple of knobs (see the [apps documentation](https://github.com/busy-app/busybar-firmware/blob/dev/documentation/JavaScript%20Applications.dox.md)):

| Field | Description |
| --- | --- |
| `format_version` | manifest format, `1` — required |
| `id` | up to 32 characters — required |
| `name` | display name — required |
| `version` | semver, e.g. `1.0.0` — required |
| `api_version` | minimum BUSY Bar HTTP API version the app needs, e.g. `27.12.0` — required |
| `description`, `author` | free form, default `""` |
| `heap_size_kib` | memory for the app heap, 1–512, default 128 |
| `debug` | when true, shown only in developer mode, default false |

Raise `heap_size_kib` if the app runs out of memory.

## Node version

The app builds on Node 24 — the version in `.nvmrc` and the range `engines` allows. Node 26 breaks the build and is excluded. With `fnm` or `nvm` installed, `fnm use` / `nvm use` picks the right one up from `.nvmrc`.

## Settings

To give the app a settings screen, add `src/appmeta/settings.json` describing the fields, then read the stored values:

```ts
import { loadValues } from "@shared/settings";

const values = await loadValues();
```

`loadValues()` returns `null` when nothing is stored yet — use the defaults.
