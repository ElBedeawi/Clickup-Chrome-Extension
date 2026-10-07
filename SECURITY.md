# Security Policy

## Supported versions

Only the latest release receives security fixes.

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅        |

## Reporting a vulnerability

Please **do not** report security issues in public GitHub issues.

Instead, report them privately in either of these ways:

- **GitHub:** use [Report a vulnerability](https://github.com/ElBedeawi/Clickup-Chrome-Extension/security/advisories/new) (private vulnerability reporting).
- **Email:** [wagih.elbedeawi+clickupvideo-chrome-ext@gmail.com](mailto:wagih.elbedeawi+clickupvideo-chrome-ext@gmail.com)

Please include:

- what the issue is and what an attacker could do with it
- steps to reproduce, or a proof of concept
- the extension version and Chrome version

You can expect an acknowledgement within a few days. Once the issue is confirmed, a fix will be released as soon as practical, and you'll be credited in the release notes unless you'd rather stay anonymous.

## Scope

Especially relevant areas:

- handling of the ClickUp API token (stored in `chrome.storage.local`, sent only to `api.clickup.com`)
- the `<all_urls>` host permission and the area-selection overlay injected into pages
- anything that could send user data anywhere other than ClickUp's API

Vulnerabilities in ClickUp itself should be reported to ClickUp.
